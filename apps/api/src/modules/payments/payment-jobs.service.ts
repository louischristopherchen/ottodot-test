import type { PaymentJobKind } from '@trial-booking/shared';
import { Op, type Transaction, type WhereOptions } from 'sequelize';

import { sequelize } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ProviderError, paymentProvider } from '../../infra/payment-provider/index.js';
import { Booking, PaymentAttempt, PaymentJob, TrialClass } from '../../models/index.js';
import { nextRunAt } from './booking-rules.js';

/** Longer than the provider timeout, so a lease cannot expire while its call is still running. */
const LEASE_MS = 60_000;

export type JobRunResult = 'done' | 'retry_scheduled' | 'failed' | 'compensated' | 'not_due';

/**
 * Runs the capture and void jobs from the payment_jobs outbox.
 *
 * A job is claimed with SELECT ... FOR UPDATE SKIP LOCKED and a lease, then executed
 * outside any transaction. The request that created the job runs it at once; the
 * worker picks up whatever did not finish. Two runners never execute the same job.
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
			await job.update(
				{ lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: job.attempts + 1 },
				{ transaction },
			);
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

		await sequelize.transaction(async (transaction) => {
			await job.update({ status: 'done', lockedUntil: null, lastError: null }, { transaction });
			await PaymentAttempt.update(
				{ status: job.kind === 'capture' ? 'captured' : 'voided' },
				{ where: { id: job.paymentAttemptId }, transaction },
			);
		});
		return 'done';
	}

	private async handleFailure(job: PaymentJob, error: unknown): Promise<JobRunResult> {
		const transient = error instanceof ProviderError ? error.transient : true;
		const message = error instanceof Error ? error.message : String(error);
		const context = { jobId: job.id, kind: job.kind, attempts: job.attempts, paymentAttemptId: job.paymentAttemptId, error: message };

		if (transient && job.attempts < env.PAYMENT_JOB_MAX_ATTEMPTS) {
			await job.update({ runAfter: nextRunAt(job.attempts, new Date()), lockedUntil: null, lastError: message });
			logger.warn('Payment job failed, retry scheduled', context);
			return 'retry_scheduled';
		}

		await job.update({ status: 'failed', lockedUntil: null, lastError: message });
		if (job.kind === 'capture') {
			logger.error('Capture failed for good, releasing the seat', context);
			await this.releaseSeatAfterFailedCapture(job.paymentAttemptId);
			return 'compensated';
		}
		// Nothing left to do automatically: the hold lapses at the issuer. Alert on this line.
		logger.error('Void failed for good, the card hold stays until it lapses', context);
		return 'failed';
	}

	/**
	 * The seat was claimed but the money could not be taken. Give the seat back so the
	 * roster only lists paid children, then release the hold on the card.
	 */
	private async releaseSeatAfterFailedCapture(paymentAttemptId: string): Promise<void> {
		const voidJobId = await sequelize.transaction(async (transaction) => {
			const attempt = (await PaymentAttempt.findByPk(paymentAttemptId, { transaction }))!;
			const bookingRef = (await Booking.findByPk(attempt.bookingId, { attributes: ['trialClassId'], transaction }))!;
			// Lock order everywhere: class row, then booking row.
			await TrialClass.findByPk(bookingRef.trialClassId, { lock: transaction.LOCK.UPDATE, transaction });
			const booking = (await Booking.findByPk(attempt.bookingId, { lock: transaction.LOCK.UPDATE, transaction }))!;
			if (booking.status === 'confirmed') {
				await booking.update({ status: 'payment_failed', confirmedAt: null }, { transaction });
			}
			await attempt.update({ status: 'capture_failed', failureCode: 'capture_failed' }, { transaction });
			const voidJob = await this.enqueue(attempt.id, 'void', transaction);
			return voidJob.id;
		});
		await this.runJob(voidJobId);
	}
}

export const paymentJobsService = new PaymentJobsService();
