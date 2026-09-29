import type { BookingDto, PaymentAttemptDto, TrialClassDto } from '@trial-booking/shared';
import type { FindOptions, Includeable, Order } from 'sequelize';

import { Booking, PaymentAttempt, Student, TrialClass } from '../../models/index.js';

export function toTrialClassDto(trialClass: TrialClass): TrialClassDto {
	return {
		id: trialClass.id,
		subject: trialClass.subject,
		title: trialClass.title,
		teacherName: trialClass.teacherName,
		startsAt: trialClass.startsAt.toISOString(),
		durationMinutes: trialClass.durationMinutes,
		capacity: trialClass.capacity,
		confirmedCount: trialClass.confirmedCount,
		seatsLeft: Math.max(0, trialClass.capacity - trialClass.confirmedCount),
		priceCents: trialClass.priceCents,
		currency: trialClass.currency,
	};
}

export function toPaymentAttemptDto(attempt: PaymentAttempt): PaymentAttemptDto {
	return {
		id: attempt.id,
		status: attempt.status,
		amountCents: attempt.amountCents,
		currency: attempt.currency,
		paymentMethod: attempt.paymentMethod,
		failureCode: attempt.failureCode,
		createdAt: attempt.createdAt.toISOString(),
		updatedAt: attempt.updatedAt.toISOString(),
	};
}

export const BOOKING_INCLUDE: Includeable[] = [
	{ model: Student, as: 'student', attributes: ['id', 'name', 'parentId'] },
	{ model: TrialClass, as: 'trialClass' },
	{ model: PaymentAttempt, as: 'paymentAttempts' },
];

export const PAYMENT_ATTEMPTS_OLDEST_FIRST: Order = [[{ model: PaymentAttempt, as: 'paymentAttempts' }, 'createdAt', 'ASC']];

export const BOOKING_QUERY: Pick<FindOptions, 'include' | 'order'> = {
	include: BOOKING_INCLUDE,
	order: PAYMENT_ATTEMPTS_OLDEST_FIRST,
};

/** Expects a booking loaded with BOOKING_INCLUDE. */
export function toBookingDto(booking: Booking): BookingDto {
	const { student, trialClass } = booking;
	if (!student || !trialClass) {
		throw new Error('toBookingDto needs the student and trialClass associations');
	}
	return {
		id: booking.id,
		status: booking.status,
		cancelReason: booking.cancelReason,
		createdAt: booking.createdAt.toISOString(),
		updatedAt: booking.updatedAt.toISOString(),
		confirmedAt: booking.confirmedAt ? booking.confirmedAt.toISOString() : null,
		student: { id: student.id, name: student.name },
		trialClass: {
			id: trialClass.id,
			title: trialClass.title,
			subject: trialClass.subject,
			startsAt: trialClass.startsAt.toISOString(),
			priceCents: trialClass.priceCents,
			currency: trialClass.currency,
		},
		paymentAttempts: (booking.paymentAttempts ?? []).map(toPaymentAttemptDto),
	};
}
