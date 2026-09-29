import { Router } from 'express';

import { authMiddleware } from '../middleware/auth.js';
import { loginLimiters } from '../middleware/rate-limiter.js';
import { requireAllowedOrigin } from '../middleware/same-origin.js';
import { authController } from '../modules/auth/auth.controller.js';

const router = Router();

// Login, refresh and logout are public; refresh and logout act on the httpOnly cookie.
router.post('/login', requireAllowedOrigin, ...loginLimiters, authController.login);
router.post('/refresh', requireAllowedOrigin, authController.refresh);
router.post('/logout', requireAllowedOrigin, authController.logout);
router.post('/logout-all', requireAllowedOrigin, authMiddleware, authController.logoutEverywhere);
router.get('/me', authMiddleware, authController.me);

export default router;
