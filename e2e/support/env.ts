// One place for the ports and settings of the stack the e2e tests run against.

export const E2E_PORTS = { web: 4100, api: 4101, sandbox: 4102 } as const;

export const WEB_URL = `http://localhost:${E2E_PORTS.web}`;

const PROVIDER_KEY = 'e2e-only-provider-key-0123456789';

export const API_ENV: Record<string, string> = {
	NODE_ENV: 'test',
	PORT: String(E2E_PORTS.api),
	BIND_HOST: '127.0.0.1',
	DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/trial_booking_e2e',
	JWT_SECRET: 'e2e-only-jwt-secret-with-at-least-32-characters',
	CORS_ORIGIN: WEB_URL,
	PAYMENT_PROVIDER_URL: `http://127.0.0.1:${E2E_PORTS.sandbox}`,
	PAYMENT_PROVIDER_API_KEY: PROVIDER_KEY,
	LOG_LEVEL: 'warn',
	BCRYPT_COST: '4',
	RATE_LIMIT_MAX: '100000',
	LOGIN_RATE_LIMIT_MAX: '100000',
	PAYMENT_RATE_LIMIT_MAX: '100000',
};

export const SANDBOX_ENV: Record<string, string> = {
	SANDBOX_PORT: String(E2E_PORTS.sandbox),
	SANDBOX_BIND_HOST: '127.0.0.1',
	SANDBOX_API_KEY: PROVIDER_KEY,
	SANDBOX_LATENCY_MS: '150',
	// Long enough for the other parent to pay first in the race test, short enough to keep it quick.
	SANDBOX_SLOW_LATENCY_MS: '4000',
};

export const WEB_ENV: Record<string, string> = {
	WEB_PORT: String(E2E_PORTS.web),
	API_URL: `http://127.0.0.1:${E2E_PORTS.api}`,
	SHOW_DEMO_ACCOUNTS: 'true',
};
