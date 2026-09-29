import { expect, test } from '@playwright/test';

import { resetDatabase, signIn } from './support/app';

test.beforeEach(() => {
	resetDatabase();
});

test('staff see the classes and a roster that lists only confirmed children', async ({ page }) => {
	await signIn(page, 'staff@example.com');

	await expect(page).toHaveURL(/\/staff$/);
	await expect(page.getByText('Upcoming trial classes')).toBeVisible();
	const row = page.getByRole('row', { name: /Sink or float\? Investigating buoyancy/ });
	await expect(row.getByText('1 of 4')).toBeVisible();

	await row.getByRole('link', { name: 'View roster' }).or(row.getByRole('button', { name: 'View roster' })).click();

	await expect(page.getByRole('heading', { name: /Roster: Sink or float\?/ })).toBeVisible();
	await expect(page.getByRole('row', { name: /Leo Carter/ }).first()).toBeVisible();
	// Sofia's card was declined in the seed: she is listed, but not on the roster.
	await expect(page.getByRole('row', { name: /Sofia Petrova.*Payment failed/ })).toBeVisible();
});

test('a parent who opens a staff page is sent back to booking', async ({ page }) => {
	await signIn(page, 'aisha.rahman@example.com');
	await page.goto('/staff');
	await expect(page).toHaveURL(/\/book$/);
});
