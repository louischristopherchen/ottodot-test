import {
	LIVE_BOOKING_STATUSES,
	type BookingDto,
	type CreateBookingInput,
	type CreateBookingResultDto,
} from '@trial-booking/shared';
import { UniqueConstraintError } from 'sequelize';

import type { AuthenticatedUser } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/error-handler.js';
import { Booking, PaymentAttempt, Student, TrialClass } from '../../models/index.js';
import { BOOKING_QUERY, PAYMENT_ATTEMPTS_OLDEST_FIRST, toBookingDto } from './booking.mapper.js';

class BookingsService {
	/**
	 * Starts a trial booking. Idempotent: if the child already has an unpaid booking for
	 * this class, that booking is returned (created: false) instead of a second one.
	 * An unpaid booking does not hold a seat; the seat is taken when payment succeeds.
	 */
	async create(user: AuthenticatedUser, input: CreateBookingInput): Promise<CreateBookingResultDto> {
		const student = await Student.findByPk(input.studentId);
		// Another family's child looks the same as a missing one, so ids cannot be probed.
		if (!student || student.parentId !== user.id) {
			throw ApiError.notFound('Student not found');
		}
		const trialClass = await TrialClass.findByPk(input.trialClassId);
		if (!trialClass) {
			throw ApiError.notFound('Trial class not found');
		}
		if (trialClass.startsAt.getTime() <= Date.now()) {
			throw ApiError.of('BOOKING_CLOSED', 'This class has already started.');
		}

		const live = await this.findLive(student.id, trialClass.id);
		if (live?.status === 'confirmed') {
			throw ApiError.of('ALREADY_BOOKED', `${student.name} already has a confirmed seat in this class.`);
		}
		// Advisory: it stops a parent from starting a payment that cannot succeed. The
		// binding check runs under the class lock when the payment comes back.
		if (trialClass.confirmedCount >= trialClass.capacity) {
			throw ApiError.of('CLASS_FULL', 'This class is full.');
		}
		if (live) {
			return { booking: await this.load(live.id), created: false };
		}

		try {
			const booking = await Booking.create({
				studentId: student.id,
				trialClassId: trialClass.id,
				status: 'pending_payment',
			});
			return { booking: await this.load(booking.id), created: true };
		} catch (error) {
			// A parallel request (double click, second tab) created it first; the partial
			// unique index refused the duplicate. Answer as if this request had found it.
			if (error instanceof UniqueConstraintError) {
				const existing = await this.findLive(student.id, trialClass.id);
				if (existing?.status === 'confirmed') {
					throw ApiError.of('ALREADY_BOOKED', `${student.name} already has a confirmed seat in this class.`);
				}
				if (existing) {
					return { booking: await this.load(existing.id), created: false };
				}
			}
			throw error;
		}
	}

	async listForParent(parentId: string): Promise<BookingDto[]> {
		const bookings = await Booking.findAll({
			include: [
				{ model: Student, as: 'student', attributes: ['id', 'name', 'parentId'], where: { parentId } },
				{ model: TrialClass, as: 'trialClass' },
				{ model: PaymentAttempt, as: 'paymentAttempts' },
			],
			order: [['createdAt', 'DESC'], ...(PAYMENT_ATTEMPTS_OLDEST_FIRST as [])],
		});
		return bookings.map(toBookingDto);
	}

	async getForParent(parentId: string, bookingId: string): Promise<BookingDto> {
		const booking = await Booking.findByPk(bookingId, BOOKING_QUERY);
		if (!booking || booking.student?.parentId !== parentId) {
			throw ApiError.notFound('Booking not found');
		}
		return toBookingDto(booking);
	}

	async load(bookingId: string): Promise<BookingDto> {
		const booking = await Booking.findByPk(bookingId, BOOKING_QUERY);
		if (!booking) {
			throw ApiError.notFound('Booking not found');
		}
		return toBookingDto(booking);
	}

	private findLive(studentId: string, trialClassId: string): Promise<Booking | null> {
		return Booking.findOne({ where: { studentId, trialClassId, status: [...LIVE_BOOKING_STATUSES] } });
	}
}

export const bookingsService = new BookingsService();
