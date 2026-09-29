import { IDEMPOTENCY_HEADER, idempotencyKeySchema, payBookingSchema, uuidParamSchema } from '@trial-booking/shared';
import type { NextFunction, Response } from 'express';

import { requireUser, type AuthRequest } from '../../middleware/auth.js';
import { idempotencyService, requestFingerprint } from './idempotency.service.js';
import { paymentsService } from './payments.service.js';

class PaymentsController {
	/**
	 * POST /api/bookings/:id/payments. With an Idempotency-Key header a retried request
	 * gets the first response back instead of being processed again.
	 */
	pay = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
		let registeredKey: string | undefined;
		try {
			const user = requireUser(req);
			const { id } = uuidParamSchema.parse(req.params);
			const { paymentMethod } = payBookingSchema.parse(req.body);

			const suppliedKey = req.get(IDEMPOTENCY_HEADER);
			if (suppliedKey !== undefined) {
				const key = idempotencyKeySchema.parse(suppliedKey);
				const stored = await idempotencyService.begin(user.id, key, requestFingerprint({ bookingId: id, paymentMethod }));
				if (stored) {
					res.setHeader('Idempotent-Replayed', 'true');
					res.status(stored.status).json(stored.body);
					return;
				}
				registeredKey = key;
			}

			const body = { success: true, data: await paymentsService.pay(user, id, paymentMethod) };
			if (registeredKey) {
				await idempotencyService.complete(user.id, registeredKey, { status: 200, body });
			}
			res.json(body);
		} catch (error) {
			if (registeredKey && req.user) {
				await idempotencyService.release(req.user.id, registeredKey).catch(() => undefined);
			}
			next(error);
		}
	};
}

export const paymentsController = new PaymentsController();
