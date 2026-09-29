import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { ApiError } from './error-handler.js';

/**
 * Guard for the routes that act on the refresh cookie. The cookie is SameSite=Strict,
 * so a cross-site request never carries it; checking Origin as well means a browser
 * bug or a misconfigured proxy is not the only thing standing between a forged request
 * and a session. Requests without an Origin header (curl, server to server) have no
 * cookie to abuse and pass through.
 */
export function requireAllowedOrigin(req: Request, _res: Response, next: NextFunction): void {
	const origin = req.get('origin');
	if (origin && !env.corsOrigins.includes(origin)) {
		next(ApiError.forbidden('Origin not allowed'));
		return;
	}
	next();
}
