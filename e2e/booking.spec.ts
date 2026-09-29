import { expect, test } from '@playwright/test';

import { pay, resetDatabase, signIn, startBooking } from './support/app';

test.beforeEach(() => {
	resetDatabase();
});

test('a parent books a class, pays, and the booking is confirmed', async ({ page }) => {
	await signIn(page, 'aisha.rahman@example.com');
	await startBooking(page, 'Zara Rahman', 'Number patterns and puzzles');

	await pay(page, 'Visa ending 4242');

	await expect(page.getByText('Payment received. Zara Rahman has a confirmed seat')).toBeVisible();
	const row = page.getByRole('row', { name: /Zara Rahman Number patterns and puzzles/ });
	await expect(row.getByRole('cell', { name: 'Confirmed', exact: true })).toBeVisible();
	await expect(row.getByRole('cell', { name: 'Paid', exact: true })).toBeVisible();
});

test('a declined card leaves the booking unpaid, and a retry with another card confirms it', async ({ page }) => {
	await signIn(page, 'aisha.rahman@example.com');
	await startBooking(page, 'Zara Rahman', 'Sink or float? Investigating buoyancy');

	await pay(page, 'Visa ending 0002');
	await expect(page.getByText(/The payment was declined \(insufficient funds\)/)).toBeVisible();
	await expect(page.getByText('Payment failed').first()).toBeVisible();

	await pay(page, 'Visa ending 4242');
	await expect(page.getByText('Payment received. Zara Rahman has a confirmed seat')).toBeVisible();
});

test('booking a child who already has a confirmed seat is refused', async ({ page }) => {
	await signIn(page, 'ben.carter@example.com');

	await page.getByRole('radio', { name: 'Leo Carter' }).check();
	await page.getByRole('radio', { name: 'Sink or float? Investigating buoyancy' }).check();
	await page.getByRole('button', { name: 'Continue to payment' }).click();

	await expect(page.getByText('Leo Carter already has a confirmed seat in this class.')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Pay SGD/ })).toHaveCount(0);
});

test('a full class cannot be selected', async ({ page }) => {
	await signIn(page, 'aisha.rahman@example.com');
	await expect(page.getByRole('radio', { name: 'Magnets: push and pull' })).toBeDisabled();
});
