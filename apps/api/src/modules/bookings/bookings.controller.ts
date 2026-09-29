import { createBookingSchema, uuidParamSchema } from '@trial-booking/shared';
import type { NextFunction, Response } from 'express';

import { requireUser, type AuthRequest } from '../../middleware/auth.js';
import { bookingsService } from './bookings.service.js';

class BookingsController {
	create = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
		try {
			const user = requireUser(req);
			const input = createBookingSchema.parse(req.body);
			const data = await bookingsService.create(user, input);
			res.status(data.created ? 201 : 200).json({ success: true, data });
		} catch (error) {
			next(error);
		}
	};

	list = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
		try {
			const user = requireUser(req);
			res.json({ success: true, data: await bookingsService.listForParent(user.id) });
		} catch (error) {
			next(error);
		}
	};

	get = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
		try {
			const user = requireUser(req);
			const { id } = uuidParamSchema.parse(req.params);
			res.json({ success: true, data: await bookingsService.getForParent(user.id, id) });
		} catch (error) {
			next(error);
		}
	};
}

export const bookingsController = new BookingsController();
