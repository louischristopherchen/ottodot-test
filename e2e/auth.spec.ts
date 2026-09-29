import { expect, test } from '@playwright/test';

import { PASSWORD, resetDatabase, signIn } from './support/app';

test.beforeEach(() => {
	resetDatabase();
});

test('a parent signs in, sees their children, and signs out', async ({ page }) => {
	await signIn(page, 'aisha.rahman@example.com');

	await expect(page).toHaveURL(/\/book$/);
	await expect(page.getByRole('radio', { name: 'Zara Rahman' })).toBeVisible();
	await expect(page.getByRole('radio', { name: 'Idris Rahman' })).toBeVisible();

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a wrong password shows the error from the API', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('Email').fill('aisha.rahman@example.com');
	await page.getByLabel('Password').fill('not-the-password');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();

	await expect(page.getByText('Email or password is incorrect')).toBeVisible();
	await expect(page).toHaveURL(/\/login/);
});

test('the session survives a reload through the httpOnly refresh cookie', async ({ page, context }) => {
	await signIn(page, 'ben.carter@example.com');
	await page.reload();

	await expect(page).toHaveURL(/\/book$/);
	await expect(page.getByRole('radio', { name: 'Leo Carter' })).toBeVisible();
	const cookies = await context.cookies();
	const refresh = cookies.find((cookie) => cookie.name === 'tb_refresh');
	expect(refresh?.httpOnly).toBe(true);
	expect(refresh?.sameSite).toBe('Strict');
	// The access token is only in memory: nothing is kept in web storage.
	expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(
		'eyJ',
	);
});

test('a demo account can be filled in with one click', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByText(PASSWORD)).toBeVisible();
	await page.getByRole('row', { name: /Ben Carter/ }).getByRole('button', { name: 'Use' }).click();
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();

	await expect(page).toHaveURL(/\/book$/);
});
