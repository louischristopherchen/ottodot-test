import { Router, type NextFunction, type Response } from 'express';

import { requireUser, roleAuth, type AuthRequest } from '../middleware/auth.js';
import { studentsService } from '../modules/students/students.service.js';

const router = Router();

router.use(roleAuth(['parent']));
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
	try {
		res.json({ success: true, data: await studentsService.listForParent(requireUser(req).id) });
	} catch (error) {
		next(error);
	}
});

export default router;
