import type { Request, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';

import { env } from '../config/env.js';

function rateLimitedResponse(_req: Request, res: Response): void {
	res.status(429).json({
		success: false,
		error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.' },
	});
}

const shared: Partial<Options> = {
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	handler: rateLimitedResponse,
};

/** IPv6 addresses are grouped by /64, so one client cannot rotate through its own block. */
export function ipKey(ip: string): string {
	if (!ip.includes(':')) {
		return ip;
	}
	return `${(ip.split('%')[0] ?? '').split(':').slice(0, 4).join(':')}::/64`;
}

export const globalLimiter = rateLimit({
	...shared,
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	limit: env.RATE_LIMIT_MAX,
	keyGenerator: (req) => ipKey(req.ip ?? ''),
});

/** Per IP and email: one address cannot spray many accounts, and one account cannot be locked out from everywhere. */
export function createLoginLimiter(limit: number, windowMs = env.RATE_LIMIT_WINDOW_MS) {
	return rateLimit({
		...shared,
		windowMs,
		limit,
		keyGenerator: (req: Request): string => {
			const body = req.body as { email?: unknown } | undefined;
			const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
			return `${ipKey(req.ip ?? '')}|${email}`;
		},
	});
}

export const loginLimiter = createLoginLimiter(env.LOGIN_RATE_LIMIT_MAX);

/** Per signed-in user, applied after authentication. */
export const paymentLimiter = rateLimit({
	...shared,
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	limit: env.PAYMENT_RATE_LIMIT_MAX,
	keyGenerator: (req) => (req as Request & { user?: { id: string } }).user?.id ?? ipKey(req.ip ?? ''),
});
