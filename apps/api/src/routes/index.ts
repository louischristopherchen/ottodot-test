import { Router } from 'express';

import { authMiddleware } from '../middleware/auth.js';
import authRoutes from './auth.routes.js';
import bookingsRoutes from './bookings.routes.js';
import staffRoutes from './staff.routes.js';
import studentsRoutes from './students.routes.js';
import trialClassesRoutes from './trial-classes.routes.js';

const router = Router();

router.use('/auth', authRoutes);

// Authenticated from here down. Each router below checks the role it needs.
router.use(authMiddleware);
router.use('/trial-classes', trialClassesRoutes);
router.use('/students', studentsRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/staff', staffRoutes);

export default router;
