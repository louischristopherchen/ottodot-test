import {
	PAYABLE_BOOKING_STATUSES,
	type BookingDto,
	type PaymentOutcome,
	type PaymentResultDto,
} from '@trial-booking/shared';

import { sequelize } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import {
	ProviderError,
	paymentProvider,
	type AuthorizeRequest,
	type AuthorizeResult,
} from '../../infra/payment-provider/index.js';
import type { AuthenticatedUser } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/error-handler.js';
import { Booking, PaymentAttempt, Student, TrialClass } from '../../models/index.js';
import { bookingsService } from '../bookings/bookings.service.js';
import {
	decideSeatClaim,
	describeOutcome,
	isPayable,
	outcomeAfterDecline,
	outcomeForRefusal,
	seatRefusal,
} from './booking-rules.js';
import { paymentJobsService } from './payment-jobs.service.js';

type StartResult =
	| { kind: 'done'; outcome: PaymentOutcome }
	| { kind: 'authorize'; attemptId: string; trialClassId: string; request: AuthorizeRequest };

/**
 * Booking lifecycle:
 *   pending_payment --declined-------------------> payment_failed --retry--> (same paths)
 *   pending_payment --authorized, seat claimed---> confirmed
 *   pending_payment --class full or started------> cancelled (class_full | booking_closed)
 *   pending_payment --unpaid too long (worker)---> cancelled (expired)
 *   confirmed       --capture refused (rare)-----> payment_failed (seat released, hold voided)
 *
 * A booking holds a seat only while it is confirmed, and only step 3 below confirms,
 * with the class row locked.
 */
class PaymentsService {
	async pay(user: AuthenticatedUser, bookingId: string, paymentMethod: string): Promise<PaymentResultDto> {
		// Step 1: validate, refuse before touching the card if the class is full or started,
		// and record the attempt so a lost provider response can be reconciled later.
		const start = await sequelize.transaction(async (transaction): Promise<StartResult> => {
			const booking = await Booking.findByPk(bookingId, { lock: transaction.LOCK.UPDATE, transaction });
			if (!booking) {
				throw ApiError.notFound('Booking not found');
			}
			const owner = await Student.findByPk(booking.studentId, { attributes: ['parentId'], transaction });
			// Another family's booking looks the same as a missing one.
			if (owner?.parentId !== user.id) {
				throw ApiError.notFound('Booking not found');
			}
			if (booking.status === 'confirmed') {
				return { kind: 'done', outcome: 'already_confirmed' };
			}
			if (!isPayable(booking.status)) {
				throw ApiError.of('NOT_PAYABLE', 'This booking was cancelled. Please start a new booking.');
			}
			const trialClass = (await TrialClass.findByPk(booking.trialClassId, { transaction }))!;
			const refusal = seatRefusal(trialClass, new Date());
			if (refusal) {
				await booking.update({ status: 'cancelled', cancelReason: refusal }, { transaction });
				return { kind: 'done', outcome: outcomeForRefusal(refusal) };
			}
			const attempt = await PaymentAttempt.create(
				{
					bookingId,
					amountCents: trialClass.priceCents,
					currency: trialClass.currency,
					paymentMethod,
					status: 'processing',
				},
				{ transaction },
			);
			return {
				kind: 'authorize',
				attemptId: attempt.id,
				trialClassId: trialClass.id,
				request: {
					idempotencyKey: attempt.id,
					reference: bookingId,
					amountCents: trialClass.priceCents,
					currency: trialClass.currency,
					paymentMethod,
				},
			};
		});
		if (start.kind === 'done') {
			return this.result(bookingId, start.outcome, null);
		}
		const { attemptId } = start;

		// Step 2: authorize. No transaction is open during this slow external call; this is
		// the window in which another parent can take the last seat, so step 3 re-checks.
		let authorization: AuthorizeResult;
		try {
			authorization = await paymentProvider().authorize(start.request);
		} catch (error) {
			if (!(error instanceof ProviderError)) {
				throw error;
			}
			return this.authorizationFailed(bookingId, attemptId, error);
		}

		if (authorization.status === 'declined') {
			await sequelize.transaction(async (transaction) => {
				await PaymentAttempt.update(
					{ status: 'declined', failureCode: authorization.declineCode },
					{ where: { id: attemptId }, transaction },
				);
				// Guarded: a parallel attempt for this booking may have settled it already.
				await Booking.update(
					{ status: 'payment_failed' },
					{ where: { id: bookingId, status: [...PAYABLE_BOOKING_STATUSES] }, transaction },
				);
			});
			return this.result(bookingId, outcomeAfterDecline, attemptId);
		}

		// Step 3: claim the seat with the class row locked, and queue the capture or void in
		// the same transaction, so the money always follows the seat decision.
		const claim = await sequelize.transaction(async (transaction) => {
			const trialClass = (await TrialClass.findByPk(start.trialClassId, { lock: transaction.LOCK.UPDATE, transaction }))!;
			const booking = (await Booking.findByPk(bookingId, { lock: transaction.LOCK.UPDATE, transaction }))!;
			await PaymentAttempt.update(
				{ status: 'authorized', providerRef: authorization.providerRef },
				{ where: { id: attemptId }, transaction },
			);

			const decision = decideSeatClaim(booking, trialClass, new Date());
			if (decision.action === 'confirm') {
				// The trigger on bookings moves confirmed_count; its CHECK is the backstop.
				await booking.update({ status: 'confirmed', confirmedAt: new Date() }, { transaction });
				const job = await paymentJobsService.enqueue(attemptId, 'capture', transaction);
				return { outcome: 'confirmed' as PaymentOutcome, jobId: job.id };
			}
			if (decision.action === 'refuse' && decision.cancelBooking) {
				await booking.update({ status: 'cancelled', cancelReason: decision.reason }, { transaction });
			}
			const job = await paymentJobsService.enqueue(attemptId, 'void', transaction);
			const outcome: PaymentOutcome =
				decision.action === 'already_confirmed' ? 'already_confirmed' : outcomeForRefusal(decision.reason);
			return { outcome, jobId: job.id };
		});

		// Step 4: move the money now. If this does not finish, the worker retries the job.
		const jobResult = await paymentJobsService.runJob(claim.jobId);
		const outcome = claim.outcome === 'confirmed' && jobResult === 'compensated' ? 'payment_declined' : claim.outcome;
		return this.result(bookingId, outcome, attemptId);
	}

	/**
	 * Transient failure (timeout, network, 5xx): the authorization may or may not exist.
	 * The attempt stays `processing` for the reconciliation job, which asks the provider
	 * and voids any hold it finds. The parent can retry at once with a new attempt.
	 */
	private async authorizationFailed(bookingId: string, attemptId: string, error: ProviderError) {
		await sequelize.transaction(async (transaction) => {
			await PaymentAttempt.update(
				error.transient
					? { failureCode: 'provider_unavailable' }
					: { status: 'declined', failureCode: error.code },
				{ where: { id: attemptId }, transaction },
			);
			await Booking.update(
				{ status: 'payment_failed' },
				{ where: { id: bookingId, status: [...PAYABLE_BOOKING_STATUSES] }, transaction },
			);
		});
		const log = error.transient ? logger.warn : logger.error;
		log('Authorization did not complete', { bookingId, paymentAttemptId: attemptId, code: error.code, transient: error.transient });
		return this.result(bookingId, outcomeAfterDecline, attemptId);
	}

	private async result(
		bookingId: string,
		outcome: PaymentOutcome | ((booking: BookingDto) => PaymentOutcome),
		attemptId: string | null,
	): Promise<PaymentResultDto> {
		const booking = await bookingsService.load(bookingId);
		const resolved = typeof outcome === 'function' ? outcome(booking) : outcome;
		const paymentAttempt = booking.paymentAttempts.find((attempt) => attempt.id === attemptId) ?? null;
		const message = describeOutcome(
			resolved,
			{ studentName: booking.student.name, classTitle: booking.trialClass.title, cancelReason: booking.cancelReason },
			paymentAttempt,
		);
		return { outcome: resolved, message, booking, paymentAttempt };
	}
}

export const paymentsService = new PaymentsService();
