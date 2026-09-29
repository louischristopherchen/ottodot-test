import type { TrialClassDto } from '@trial-booking/shared';
import { Op } from 'sequelize';

import { TrialClass } from '../../models/index.js';
import { toTrialClassDto } from '../bookings/booking.mapper.js';

class TrialClassesService {
	/** Classes that have not started, soonest first. Seat counts are a snapshot for display. */
	async listUpcoming(now = new Date()): Promise<TrialClassDto[]> {
		const classes = await TrialClass.findAll({
			where: { startsAt: { [Op.gt]: now } },
			order: [['startsAt', 'ASC']],
		});
		return classes.map(toTrialClassDto);
	}
}

export const trialClassesService = new TrialClassesService();
