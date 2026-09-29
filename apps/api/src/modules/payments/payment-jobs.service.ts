import type { PaymentJobKind } from '@trial-booking/shared';
import { Op, type Transaction, type WhereOptions } from 'sequelize';

import { sequelize } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ProviderError, paymentProvider, type ProviderAuthorization } from '../../infra/payment-provider/index.js';
import { Booking, PaymentAttempt, PaymentJob, TrialClass } from '../../models/index.js';
import { nextRunAt } from './booking-rules.js';

/** Several provider timeouts long, so a lease cannot expire while its call is still running. */
const LEASE_MS = Math.max(60_000, 3 * env.PAYMENT_PROVIDER_TIMEOUT_MS);

export type JobRunResult = 'done' | 'retry_scheduled' | 'failed' | 'compensated' | 'not_due';

/**
 * Runs the capture and void jobs from the payment_jobs outbox.
 *
 * A job is claimed with SELECT ... FOR UPDATE SKIP LOCKED and a lease, then executed
 * outside any transaction. The request that created the job runs it at once; the
 * worker picks up whatever did not finish. Two runners never execute the same job.
 *
 * A transient failure (timeout, network, 5xx) never gives up: the outcome may have been
 * a success whose response was lost, so the job keeps retrying with capped backoff and
 * is logged as an error once it has failed PAYMENT_JOB_ALERT_AFTER_ATTEMPTS times.
 * Only a definite refusal, confirmed by asking the provider for the authorization's
 * current state, changes the booking.
 */
class PaymentJobsService {
	/** Must be called inside the transaction that took the seat decision. */
	async enqueue(paymentAttemptId: string, kind: PaymentJobKind, transaction: Transaction): Promise<PaymentJob> {
		const existing = await PaymentJob.findOne({ where: { paymentAttemptId, kind }, transaction });
		return existing ?? PaymentJob.create({ paymentAttemptId, kind }, { transaction });
	}

	async runJob(jobId: string): Promise<JobRunResult> {
		const job = await this.lease({ id: jobId });
		return job ? this.execute(job) : 'not_due';
	}

	async runDueJobs(limit = 20): Promise<number> {
		let processed = 0;
		while (processed < limit) {
			const job = await this.lease({});
			if (!job) {
				break;
			}
			await this.execute(job);
			processed += 1;
		}
		return processed;
	}

	private lease(where: WhereOptions<PaymentJob>): Promise<PaymentJob | null> {
		return sequelize.transaction(async (transaction) => {
			const now = new Date();
			const job = await PaymentJob.findOne({
				where: {
					...where,
					status: 'pending',
					runAfter: { [Op.lte]: now },
					[Op.or]: [{ lockedUntil: null }, { lockedUntil: { [Op.lt]: now } }],
				} as WhereOptions<PaymentJob>,
				order: [['runAfter', 'ASC']],
				lock: transaction.LOCK.UPDATE,
				skipLocked: true,
				transaction,
			});
			if (!job) {
				return null;
			}
			await job.update({ lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: job.attempts + 1 }, { transaction });
			return job;
		});
	}

	private async execute(job: PaymentJob): Promise<JobRunResult> {
		const attempt = await PaymentAttempt.findByPk(job.paymentAttemptId);
		try {
			if (!attempt?.providerRef) {
				throw new ProviderError('Payment attempt has no provider reference', {
					transient: false,
					code: 'missing_provider_ref',
				});
			}
			if (job.kind === 'capture') {
				await paymentProvider().capture(attempt.providerRef);
			} else {
				await paymentProvider().voidAuthorization(attempt.providerRef);
			}
		} catch (error) {
			return this.handleFailure(job, error);
		}
		await this.markDone(job);
		return 'done';
	}

	private async markDone(job: PaymentJob): Promise<void> {
		await sequelize.transaction(async (transaction) => {
			await job.update({ status: 'done', lockedUntil: null, lastError: null }, { transaction });
			await PaymentAttempt.update(
				{ status: job.kind === 'capture' ? 'captured' : 'voided' },
				{ where: { id: job.paymentAttemptId }, transaction },
			);
		});
	}

	private async retryLater(job: PaymentJob, message: string): Promise<JobRunResult> {
		await job.update({ runAfter: nextRunAt(job.attempts, new Date()), lockedUntil: null, lastError: message });
		const context = { jobId: job.id, kind: job.kind, attempts: job.attempts, paymentAttemptId: job.paymentAttemptId, error: message };
		if (job.attempts >= env.PAYMENT_JOB_ALERT_AFTER_ATTEMPTS) {
			logger.error('Payment job keeps failing, still retrying', context);
		} else {
			logger.warn('Payment job failed, retry scheduled', context);
		}
		return 'retry_scheduled';
	}

	/** The provider's view of the authorization, or null if it cannot be asked right now. */
	private async providerState(paymentAttemptId: string): Promise<ProviderAuthorization['status'] | 'missing' | null> {
		try {
			const found = await paymentProvider().findAuthorization(paymentAttemptId);
			return found ? found.status : 'missing';
		} catch {
			return null;
		}
	}

	private async handleFailure(job: PaymentJob, error: unknown): Promise<JobRunResult> {
		const message = error instanceof Error ? error.message : String(error);
		const transient = error instanceof ProviderError ? error.transient : true;
		if (transient) {
			return this.retryLater(job, message);
		}

		// The provider refused. Before acting, ask it what state the authorization is in:
		// a capture or void that went through while its response was lost looks the same.
		const state = await this.providerState(job.paymentAttemptId);
		if (state === null) {
			return this.retryLater(job, `${message}; provider state unknown`);
		}
		if ((job.kind === 'capture' && state === 'captured') || (job.kind === 'void' && state === 'voided')) {
			await this.markDone(job);
			return 'done';
		}

		if (job.kind === 'capture') {
			return this.releaseSeatAfterRefusedCapture(job, message);
		}

		await job.update({ status: 'failed', lockedUntil: null, lastError: message });
		if (state === 'captured') {
			logger.error('Void refused because the payment was captured without a seat; refund it by hand', {
				jobId: job.id,
				paymentAttemptId: job.paymentAttemptId,
			});
		} else {
			logger.error('Void refused; the card hold stays until it lapses at the issuer', {
				jobId: job.id,
				paymentAttemptId: job.paymentAttemptId,
				state,
			});
		}
		return 'failed';
	}

	/**
	 * The capture was refused for good. In one transaction: mark the job failed, give the
	 * seat back so the roster only lists paid children, and queue the void that releases
	 * the hold. If anything fails, nothing is written and the job is leased again later.
	 */
	private async releaseSeatAfterRefusedCapture(job: PaymentJob, message: string): Promise<JobRunResult> {
		const voidJobId = await sequelize.transaction(async (transaction) => {
			const lockedJob = await PaymentJob.findByPk(job.id, { lock: transaction.LOCK.UPDATE, transaction });
			if (!lockedJob || lockedJob.status !== 'pending') {
				return null;
			}
			const attempt = (await PaymentAttempt.findByPk(job.paymentAttemptId, { transaction }))!;
			const bookingRef = (await Booking.findByPk(attempt.bookingId, { attributes: ['trialClassId'], transaction }))!;
			// Lock order everywhere: class row, then booking row.
			await TrialClass.findByPk(bookingRef.trialClassId, { lock: transaction.LOCK.UPDATE, transaction });
			const booking = (await Booking.findByPk(attempt.bookingId, { lock: transaction.LOCK.UPDATE, transaction }))!;
			if (booking.status === 'confirmed') {
				await booking.update({ status: 'payment_failed', confirmedAt: null }, { transaction });
			}
			await attempt.update({ status: 'capture_failed', failureCode: 'capture_failed' }, { transaction });
			await lockedJob.update({ status: 'failed', lockedUntil: null, lastError: message }, { transaction });
			const voidJob = await this.enqueue(attempt.id, 'void', transaction);
			return voidJob.id;
		});
		if (!voidJobId) {
			return 'not_due';
		}
		logger.error('Capture refused, seat released', { jobId: job.id, paymentAttemptId: job.paymentAttemptId, error: message });
		await this.runJob(voidJobId);
		return 'compensated';
	}
}

export const paymentJobsService = new PaymentJobsService();
