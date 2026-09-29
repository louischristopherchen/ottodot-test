import { PAYABLE_BOOKING_STATUSES } from '@trial-booking/shared';
import { Op } from 'sequelize';

import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { Booking } from '../models/index.js';
import { authService } from '../modules/auth/auth.service.js';
import { idempotencyService } from '../modules/payments/idempotency.service.js';

/**
 * Unpaid bookings older than UNPAID_BOOKING_TTL_MINUTES are cancelled as `expired`,
 * so the parent's list stays tidy and the partial unique index frees the pair. A
 * booking with a payment still in flight is left alone. Unpaid bookings never held
 * a seat, so no seat is released here.
 */
export async function expireUnpaidBookings(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - env.UNPAID_BOOKING_TTL_MINUTES * 60_000);
	const [count] = await Booking.update(
		{ status: 'cancelled', cancelReason: 'expired' },
		{
			where: {
				status: [...PAYABLE_BOOKING_STATUSES],
				updatedAt: { [Op.lt]: cutoff },
				id: {
					[Op.notIn]: sequelize.literal(
						"(SELECT booking_id FROM payment_attempts WHERE status IN ('processing', 'authorized'))",
					),
				},
			},
		},
	);
	return count;
}

export async function purgeExpiredRecords(now = new Date()): Promise<{ sessions: number; idempotencyKeys: number }> {
	return {
		sessions: await authService.purgeSessions(now),
		idempotencyKeys: await idempotencyService.purgeExpired(now),
	};
}
