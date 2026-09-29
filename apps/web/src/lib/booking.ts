import type { BookingDto, BookingStatus, PaymentAttemptDto, TrialClassDto } from '@trial-booking/shared';
// The subpath keeps zod (pulled in by the validators) out of chunks that only need constants.
import { PAYABLE_BOOKING_STATUSES } from '@trial-booking/shared/constants';

import { paymentStatusText } from './format';

const payable: ReadonlySet<BookingStatus> = new Set(PAYABLE_BOOKING_STATUSES);

export function isPayable(status: BookingStatus): boolean {
	return payable.has(status);
}

export function isClassBookable(trialClass: TrialClassDto): boolean {
	return trialClass.seatsLeft > 0;
}

/** Attempts arrive oldest first. */
export function lastPaymentAttempt(booking: BookingDto): PaymentAttemptDto | null {
	return booking.paymentAttempts.at(-1) ?? null;
}

export function bookingPaymentText(booking: BookingDto): string {
	const attempt = lastPaymentAttempt(booking);
	return paymentStatusText(attempt?.status ?? null, attempt?.failureCode ?? null);
}

/**
 * A poll that started before a payment finished can land after it, so the copy
 * with the later `updatedAt` wins. Ties go to `b`.
 */
export function newerBooking(a: BookingDto | undefined, b: BookingDto): BookingDto {
	if (!a) {
		return b;
	}
	return Date.parse(a.updatedAt) > Date.parse(b.updatedAt) ? a : b;
}

/** Replaces the booking with the same id, or puts it first (the list is newest first). */
export function upsertBooking(list: BookingDto[] | undefined, booking: BookingDto): BookingDto[] {
	if (!list) {
		return [booking];
	}
	const index = list.findIndex((item) => item.id === booking.id);
	if (index === -1) {
		return [booking, ...list];
	}
	const next = list.slice();
	next[index] = newerBooking(list[index], booking);
	return next;
}
