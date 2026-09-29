import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// Root .env first, then apps/api/.env. Neither is required: in CI and under PM2 the
// real process environment is enough. override: false means an exported variable wins.
for (const candidate of [path.resolve(currentDir, '../../../../.env'), path.resolve(currentDir, '../../.env')]) {
	if (fs.existsSync(candidate)) {
		dotenv.config({ path: candidate, override: false });
	}
}

const booleanish = z
	.enum(['true', 'false', '1', '0'])
	.transform((value) => value === 'true' || value === '1');

const duration = z.string().regex(/^\d+[smhd]$/, 'Use a duration such as 30m, 12h or 7d');

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
	PORT: z.coerce.number().int().positive().default(4001),
	// Loopback by default: nginx is the only front door.
	BIND_HOST: z.string().default('127.0.0.1'),
	TRUST_PROXY: z.coerce.number().int().nonnegative().default(1),

	DATABASE_URL: z.string().min(1).default('postgres://postgres@127.0.0.1:55432/trial_booking'),
	DB_POOL_MAX: z.coerce.number().int().positive().default(10),

	JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
	JWT_ACCESS_TTL: duration.default('30m'),
	REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
	/** Absolute lifetime of a sign-in: rotating the refresh token cannot extend a session past it. */
	SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
	BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

	/** Comma separated list of browser origins allowed to call the API. */
	CORS_ORIGIN: z.string().default('http://localhost:4000'),
	/** Defaults to true outside development and test. */
	COOKIE_SECURE: booleanish.optional(),

	PAYMENT_PROVIDER_URL: z.string().url().default('http://127.0.0.1:4002'),
	PAYMENT_PROVIDER_API_KEY: z.string().min(16, 'PAYMENT_PROVIDER_API_KEY must be at least 16 characters'),
	// Longer than the slow sandbox card (10 s) so a slow issuer is not mistaken for an outage.
	PAYMENT_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

	LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

	RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
	RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
	/** Login attempts per IP and email. */
	LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
	/** Login attempts per IP across all emails: stops one address spraying many accounts. */
	LOGIN_IP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
	/** Login attempts per email across all IPs: slows distributed guessing against one account. */
	LOGIN_EMAIL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
	PAYMENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

	UNPAID_BOOKING_TTL_MINUTES: z.coerce.number().int().positive().default(30),
	WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
	/** Transient capture or void failures retry forever; after this many attempts each failure is logged as an error. */
	PAYMENT_JOB_ALERT_AFTER_ATTEMPTS: z.coerce.number().int().positive().default(5),
	RECONCILE_AFTER_SECONDS: z.coerce.number().int().positive().default(120),
});

const parsed = envSchema
	.superRefine((values, context) => {
		// Reconciliation must never act on an attempt whose request may still be waiting on the provider.
		if (values.RECONCILE_AFTER_SECONDS * 1000 < 3 * values.PAYMENT_PROVIDER_TIMEOUT_MS) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['RECONCILE_AFTER_SECONDS'],
				message: 'RECONCILE_AFTER_SECONDS must be at least three payment provider timeouts',
			});
		}
	})
	.safeParse(process.env);

if (!parsed.success) {
	console.error('Invalid API environment:', parsed.error.flatten().fieldErrors);
	process.exit(1);
}

const values = parsed.data;

export const env = {
	...values,
	COOKIE_SECURE: values.COOKIE_SECURE ?? !['development', 'test'].includes(values.NODE_ENV),
	corsOrigins: values.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
	accessTokenTtlSeconds: durationToSeconds(values.JWT_ACCESS_TTL),
};

export type Env = typeof env;

export function durationToSeconds(value: string): number {
	const match = /^(\d+)([smhd])$/.exec(value);
	if (!match) {
		throw new Error(`Invalid duration: ${value}`);
	}
	const unit = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as 's' | 'm' | 'h' | 'd'];
	return Number(match[1]) * unit;
}
