import { defineConfig, devices } from '@playwright/test';

import { API_ENV, E2E_PORTS, SANDBOX_ENV, WEB_ENV, WEB_URL } from './e2e/support/env';

/**
 * End-to-end tests against the real stack: payments sandbox, API on its own database,
 * and the web app. The database is reset before each test, so tests run one at a time.
 */
export default defineConfig({
	testDir: './e2e',
	globalSetup: './e2e/global-setup.ts',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
	use: {
		baseURL: WEB_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: [
		{
			command: 'node --import tsx apps/payments-sandbox/src/index.ts',
			url: `http://127.0.0.1:${E2E_PORTS.sandbox}/health`,
			env: SANDBOX_ENV,
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
		},
		{
			command: 'node --import tsx apps/api/src/index.ts',
			url: `http://127.0.0.1:${E2E_PORTS.api}/health/ready`,
			env: API_ENV,
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
		},
		{
			command: 'npm run dev -w @trial-booking/web',
			url: WEB_URL,
			env: WEB_ENV,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
	],
});
