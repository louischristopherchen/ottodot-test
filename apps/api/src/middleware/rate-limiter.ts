import type { Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';

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

/** IPv6 clients are grouped by /64 (compressed forms included), so one client cannot rotate through its own block. */
export function ipKey(req: Request): string {
	return ipKeyGenerator(req.ip ?? '', 64);
}

function emailKey(req: Request): string {
	const body = req.body as { email?: unknown } | undefined;
	return typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
}

export const globalLimiter = rateLimit({
	...shared,
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	limit: env.RATE_LIMIT_MAX,
	keyGenerator: ipKey,
});

export interface LoginLimits {
	perIp: number;
	perIpAndEmail: number;
	perEmail: number;
	windowMs: number;
}

/**
 * Three limits on sign-in, all keyed on strings the client sends, so they behave the
 * same for accounts that do not exist (no account enumeration, and no way to lock a
 * known parent out of every device):
 *   per IP            one address cannot spray many accounts
 *   per IP and email  one address cannot hammer one account
 *   per email         many addresses together cannot hammer one account
 */
export function createLoginLimiters(limits: LoginLimits): RequestHandler[] {
	return [
		rateLimit({ ...shared, windowMs: limits.windowMs, limit: limits.perIp, keyGenerator: (req) => `ip|${ipKey(req)}` }),
		rateLimit({
			...shared,
			windowMs: limits.windowMs,
			limit: limits.perIpAndEmail,
			keyGenerator: (req) => `ip-email|${ipKey(req)}|${emailKey(req)}`,
		}),
		rateLimit({ ...shared, windowMs: limits.windowMs, limit: limits.perEmail, keyGenerator: (req) => `email|${emailKey(req)}` }),
	];
}

export const loginLimiters = createLoginLimiters({
	perIp: env.LOGIN_IP_RATE_LIMIT_MAX,
	perIpAndEmail: env.LOGIN_RATE_LIMIT_MAX,
	perEmail: env.LOGIN_EMAIL_RATE_LIMIT_MAX,
	windowMs: env.RATE_LIMIT_WINDOW_MS,
});

/** Per signed-in user, applied after authentication. */
export const paymentLimiter = rateLimit({
	...shared,
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	limit: env.PAYMENT_RATE_LIMIT_MAX,
	keyGenerator: (req) => (req as Request & { user?: { id: string } }).user?.id ?? ipKey(req),
});
