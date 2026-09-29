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
	LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
	PAYMENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

	UNPAID_BOOKING_TTL_MINUTES: z.coerce.number().int().positive().default(30),
	WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
	PAYMENT_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
	RECONCILE_AFTER_SECONDS: z.coerce.number().int().positive().default(120),
});

const parsed = envSchema.safeParse(process.env);

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
