import { loginSchema } from '@trial-booking/shared';
import type { NextFunction, Request, Response } from 'express';

import { requireUser, type AuthRequest } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/error-handler.js';
import { authService, type ClientContext } from './auth.service.js';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './cookies.js';

function clientContext(req: Request): ClientContext {
	return { userAgent: req.get('user-agent'), ip: req.ip };
}

function refreshCookie(req: Request): string | undefined {
	const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
	return typeof value === 'string' ? value : undefined;
}

class AuthController {
	login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			const { email, password } = loginSchema.parse(req.body);
			const { session, refreshToken } = await authService.login(email, password, clientContext(req));
			setRefreshCookie(res, refreshToken!);
			res.json({ success: true, data: session });
		} catch (error) {
			next(error);
		}
	};

	refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			const { session, refreshToken } = await authService.refresh(refreshCookie(req), clientContext(req));
			if (refreshToken) {
				setRefreshCookie(res, refreshToken);
			}
			res.json({ success: true, data: session });
		} catch (error) {
			if (error instanceof ApiError && error.statusCode === 401) {
				clearRefreshCookie(res);
			}
			next(error);
		}
	};

	logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			await authService.logout(refreshCookie(req));
			clearRefreshCookie(res);
			res.json({ success: true, data: { loggedOut: true } });
		} catch (error) {
			next(error);
		}
	};

	me = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
		try {
			const user = requireUser(req);
			res.json({ success: true, data: await authService.me(user.id) });
		} catch (error) {
			next(error);
		}
	};
}

export const authController = new AuthController();
