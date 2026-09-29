import type {
	BookingStatus,
	CancelReason,
	PaymentAttemptStatus,
	PaymentOutcome,
} from '@trial-booking/shared';

// Pure decisions behind the payment flow. No database access, so every branch is unit tested.

export interface SeatState {
	startsAt: Date;
	capacity: number;
	confirmedCount: number;
}

export interface BookingState {
	status: BookingStatus;
	cancelReason: CancelReason | null;
}

export function isPayable(status: BookingStatus): boolean {
	return status === 'pending_payment' || status === 'payment_failed';
}

/** Why a booking for this class cannot take a seat right now, or null if it can. */
export function seatRefusal(trialClass: SeatState, now: Date): CancelReason | null {
	if (trialClass.startsAt.getTime() <= now.getTime()) {
		return 'booking_closed';
	}
	if (trialClass.confirmedCount >= trialClass.capacity) {
		return 'class_full';
	}
	return null;
}

export type ClaimDecision =
	| { action: 'confirm' }
	| { action: 'already_confirmed' }
	| { action: 'refuse'; reason: CancelReason; cancelBooking: boolean };

/**
 * The decision taken once the card is authorized, while the class row is locked.
 * Whoever reaches this first with a free seat gets it.
 */
export function decideSeatClaim(booking: BookingState, trialClass: SeatState, now: Date): ClaimDecision {
	if (booking.status === 'confirmed') {
		// A parallel attempt for this same booking (double submit) got here first.
		return { action: 'already_confirmed' };
	}
	if (booking.status === 'cancelled') {
		return { action: 'refuse', reason: booking.cancelReason ?? 'class_full', cancelBooking: false };
	}
	const refusal = seatRefusal(trialClass, now);
	if (refusal) {
		return { action: 'refuse', reason: refusal, cancelBooking: true };
	}
	return { action: 'confirm' };
}

export function outcomeForRefusal(reason: CancelReason): PaymentOutcome {
	return reason === 'class_full' ? 'class_full' : 'booking_closed';
}

/** A decline leaves the booking payable, unless a parallel attempt settled it first. */
export function outcomeAfterDecline(booking: BookingState): PaymentOutcome {
	if (booking.status === 'confirmed') {
		return 'already_confirmed';
	}
	if (booking.status === 'cancelled') {
		return outcomeForRefusal(booking.cancelReason ?? 'class_full');
	}
	return 'payment_declined';
}

const DECLINE_REASONS: Record<string, string> = {
	insufficient_funds: 'insufficient funds',
	invalid_payment_method: 'unsupported payment method',
	provider_unavailable: 'the payment provider did not respond',
	card_declined: 'card declined',
};

export interface OutcomeContext {
	studentName: string;
	classTitle: string;
	cancelReason: CancelReason | null;
}

/** The sentence shown to the parent for each outcome. */
export function describeOutcome(
	outcome: PaymentOutcome,
	context: OutcomeContext,
	attempt: { status: PaymentAttemptStatus; failureCode: string | null } | null,
): string {
	switch (outcome) {
		case 'confirmed':
			return `Payment received. ${context.studentName} has a confirmed seat in "${context.classTitle}".`;
		case 'already_confirmed':
			return 'This booking is already confirmed. You were not charged again.';
		case 'payment_declined': {
			if (attempt?.failureCode === 'capture_failed') {
				return `The payment could not be completed, so ${context.studentName} is not booked. You were not charged; please try again.`;
			}
			if (attempt?.failureCode === 'provider_unavailable') {
				return 'We could not reach the payment provider. You were not charged; please try again.';
			}
			const reason = DECLINE_REASONS[attempt?.failureCode ?? ''] ?? 'card declined';
			return `The payment was declined (${reason}). ${context.studentName} is not booked yet; you can retry with another card.`;
		}
		case 'class_full':
			return attempt
				? 'The last seat was taken while your payment was processing. The hold on your card is released, so you were not charged.'
				: 'This class is now full. You were not charged.';
		case 'booking_closed':
			return context.cancelReason === 'expired'
				? 'This booking expired before it was paid. You were not charged; please book again.'
				: 'This class has already started, so it can no longer be booked. You were not charged.';
	}
}

/** Backoff for payment jobs: 10 s, 20 s, 40 s and so on, capped at 10 minutes. */
export function nextRunAt(attempts: number, now: Date): Date {
	const delayMs = Math.min(10_000 * 2 ** Math.max(0, attempts - 1), 600_000);
	return new Date(now.getTime() + delayMs);
}
