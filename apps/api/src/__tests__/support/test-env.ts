// Preloaded with --import before any test file, so these values are in place before
// src/config/env.ts reads the environment. Values from .env files never override them.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
	process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/trial_booking_test';
process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
process.env.PAYMENT_PROVIDER_API_KEY = 'test-only-provider-key-0123456789';
process.env.PAYMENT_PROVIDER_URL = 'http://127.0.0.1:9';
process.env.PAYMENT_PROVIDER_TIMEOUT_MS = '2000';
process.env.CORS_ORIGIN = 'http://localhost:4000';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
// Low cost keeps tests fast; production uses 12.
process.env.BCRYPT_COST = '4';
process.env.RATE_LIMIT_MAX = '100000';
process.env.LOGIN_RATE_LIMIT_MAX = '100000';
process.env.PAYMENT_RATE_LIMIT_MAX = '100000';
process.env.RECONCILE_AFTER_SECONDS = '120';
process.env.UNPAID_BOOKING_TTL_MINUTES = '30';
process.env.PAYMENT_JOB_MAX_ATTEMPTS = '3';
