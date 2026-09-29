import { Router } from 'express';

import { roleAuth } from '../middleware/auth.js';
import { paymentLimiter } from '../middleware/rate-limiter.js';
import { bookingsController } from '../modules/bookings/bookings.controller.js';
import { paymentsController } from '../modules/payments/payments.controller.js';

const router = Router();

router.use(roleAuth(['parent']));
router.post('/', bookingsController.create);
router.get('/', bookingsController.list);
router.get('/:id', bookingsController.get);
router.post('/:id/payments', paymentLimiter, paymentsController.pay);

export default router;
