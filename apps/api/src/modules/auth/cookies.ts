import type { CookieOptions, Response } from 'express';

import { env } from '../../config/env.js';

export const REFRESH_COOKIE = 'tb_refresh';

/**
 * httpOnly: page scripts cannot read it. SameSite=Strict: cross-site requests never
 * carry it. Path=/api/auth: only the refresh and logout endpoints ever receive it.
 */
function options(): CookieOptions {
	return {
		httpOnly: true,
		secure: env.COOKIE_SECURE,
		sameSite: 'strict',
		path: '/api/auth',
	};
}

export function setRefreshCookie(res: Response, token: string): void {
	res.cookie(REFRESH_COOKIE, token, { ...options(), maxAge: env.REFRESH_TTL_DAYS * 86_400_000 });
}

export function clearRefreshCookie(res: Response): void {
	res.clearCookie(REFRESH_COOKIE, options());
}
