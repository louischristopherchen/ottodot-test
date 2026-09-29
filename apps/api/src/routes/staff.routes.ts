import { uuidParamSchema } from '@trial-booking/shared';
import { Router } from 'express';

import { roleAuth } from '../middleware/auth.js';
import { rostersService } from '../modules/rosters/rosters.service.js';

const router = Router();

router.use(roleAuth(['staff']));
router.get('/trial-classes/:id/roster', async (req, res, next) => {
	try {
		const { id } = uuidParamSchema.parse(req.params);
		res.json({ success: true, data: await rostersService.getRoster(id) });
	} catch (error) {
		next(error);
	}
});

export default router;
