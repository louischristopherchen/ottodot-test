import type { NotOnRosterEntryDto, RosterDto, RosterEntryDto } from '@trial-booking/shared';

import { ApiError } from '../../middleware/error-handler.js';
import { Booking, PaymentAttempt, Student, TrialClass, User } from '../../models/index.js';
import { toTrialClassDto } from '../bookings/booking.mapper.js';

/**
 * The attempt that paid for a confirmed booking, or else the latest one. A double click
 * can leave a later, voided attempt next to the one that was captured.
 */
function paymentOfRecord(booking: Booking): PaymentAttempt | undefined {
	const attempts = booking.paymentAttempts ?? [];
	if (booking.status === 'confirmed') {
		const paid = attempts.findLast((attempt) => attempt.status === 'captured' || attempt.status === 'authorized');
		if (paid) {
			return paid;
		}
	}
	return attempts.at(-1);
}

class RostersService {
	async getRoster(trialClassId: string): Promise<RosterDto> {
		const trialClass = await TrialClass.findByPk(trialClassId);
		if (!trialClass) {
			throw ApiError.notFound('Trial class not found');
		}

		const bookings = await Booking.findAll({
			where: { trialClassId },
			include: [
				{
					model: Student,
					as: 'student',
					include: [{ model: User, as: 'parent', attributes: ['name', 'email'] }],
				},
				{ model: PaymentAttempt, as: 'paymentAttempts' },
			],
			order: [
				['updatedAt', 'DESC'],
				[{ model: PaymentAttempt, as: 'paymentAttempts' }, 'createdAt', 'ASC'],
			],
		});

		const confirmed: RosterEntryDto[] = bookings
			.filter((booking) => booking.status === 'confirmed')
			.sort((a, b) => a.confirmedAt!.getTime() - b.confirmedAt!.getTime())
			.map((booking) => ({
				bookingId: booking.id,
				studentName: booking.student!.name,
				level: booking.student!.level,
				parentName: booking.student!.parent!.name,
				parentEmail: booking.student!.parent!.email,
				confirmedAt: booking.confirmedAt!.toISOString(),
				paymentStatus: paymentOfRecord(booking)?.status ?? null,
			}));

		const notOnRoster: NotOnRosterEntryDto[] = bookings
			.filter((booking) => booking.status !== 'confirmed')
			.map((booking) => {
				const last = booking.paymentAttempts?.at(-1);
				return {
					bookingId: booking.id,
					studentName: booking.student!.name,
					parentName: booking.student!.parent!.name,
					status: booking.status as NotOnRosterEntryDto['status'],
					cancelReason: booking.cancelReason,
					lastPaymentStatus: last?.status ?? null,
					lastPaymentFailureCode: last?.failureCode ?? null,
					updatedAt: booking.updatedAt.toISOString(),
				};
			});

		return { trialClass: toTrialClassDto(trialClass), confirmed, notOnRoster };
	}
}

export const rostersService = new RostersService();
