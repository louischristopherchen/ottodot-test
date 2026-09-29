import { Router } from 'express';

import { trialClassesService } from '../modules/trial-classes/trial-classes.service.js';

const router = Router();

// Any signed-in user: parents pick a class, staff pick a roster.
router.get('/', async (_req, res, next) => {
	try {
		res.json({ success: true, data: await trialClassesService.listUpcoming() });
	} catch (error) {
		next(error);
	}
});

export default router;
