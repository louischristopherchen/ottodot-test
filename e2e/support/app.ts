import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { expect, type Page } from '@playwright/test';

import { API_ENV } from './env';

const ROOT = path.resolve(__dirname, '../..');

export const PASSWORD = 'trial-demo-2026';

/** Wipes the e2e database and loads the demo data again, with class times relative to now. */
export function resetDatabase(): void {
	execFileSync(process.execPath, ['--import', 'tsx', 'apps/api/src/scripts/seed.ts', '--reset'], {
		cwd: ROOT,
		env: { ...process.env, ...API_ENV },
		stdio: 'pipe',
	});
}

export async function signIn(page: Page, email: string): Promise<void> {
	await page.goto('/login');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).not.toHaveURL(/\/login/);
}

/** Picks a child and a class on the booking page and moves to the payment step. */
export async function startBooking(page: Page, child: string, trialClass: string): Promise<void> {
	await page.getByRole('radio', { name: child }).check();
	await page.getByRole('radio', { name: trialClass }).check();
	await page.getByRole('button', { name: 'Continue to payment' }).click();
	await expect(page.getByRole('button', { name: /^Pay SGD/ })).toBeVisible();
}

export async function pay(page: Page, card: string): Promise<void> {
	await page.getByRole('radio', { name: card }).check();
	await page.getByRole('button', { name: /^Pay SGD/ }).click();
}
