import type { NotOnRosterEntryDto, RosterDto, RosterEntryDto } from '@trial-booking/shared';

import { ApiError } from '../../middleware/error-handler.js';
import { Booking, PaymentAttempt, Student, TrialClass, User } from '../../models/index.js';
import { toTrialClassDto } from '../bookings/booking.mapper.js';

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
				paymentStatus: booking.paymentAttempts?.at(-1)?.status ?? null,
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
