import { expect, test } from '@playwright/test';

import { pay, resetDatabase, signIn, startBooking } from './support/app';

test.beforeEach(() => {
	resetDatabase();
});

// The scenario from the brief, in two separate browsers: A moves to payment on the last
// seat, B picks the same seat and pays first, then A's payment completes.
test('two parents race for the last seat: B gets it, A is refused and not charged', async ({ browser }) => {
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	const parentA = await contextA.newPage();
	const parentB = await contextB.newPage();

	await signIn(parentA, 'aisha.rahman@example.com');
	await signIn(parentB, 'chloe.tan@example.com');
	await startBooking(parentA, 'Zara Rahman', 'Fractions with pizza');
	await startBooking(parentB, 'Ethan Tan', 'Fractions with pizza');

	// A pays with the slow card: the authorization takes a few seconds.
	await pay(parentA, 'Visa ending 1881');
	await expect(parentA.getByRole('button', { name: 'Processing payment...' })).toBeVisible();

	// B pays with a normal card while A is still waiting.
	await pay(parentB, 'Visa ending 4242');
	await expect(parentB.getByText('Payment received. Ethan Tan has a confirmed seat')).toBeVisible();

	await expect(parentA.getByText('The last seat was taken while your payment was processing')).toBeVisible({
		timeout: 20_000,
	});
	await expect(parentA.getByText('Cancelled (class full)').first()).toBeVisible();

	// Staff see four confirmed children, and A's child is not among them.
	const staffContext = await browser.newContext();
	const staff = await staffContext.newPage();
	await signIn(staff, 'staff@example.com');
	await staff.getByRole('row', { name: /Fractions with pizza/ }).getByRole('link', { name: 'View roster' }).or(
		staff.getByRole('row', { name: /Fractions with pizza/ }).getByRole('button', { name: 'View roster' }),
	).click();
	await expect(staff.getByRole('heading', { name: /Roster: Fractions with pizza/ })).toBeVisible();
	await expect(staff.getByText('4 of 4 seats confirmed')).toBeVisible();
	await expect(staff.getByRole('row', { name: /Ethan Tan/ }).first()).toBeVisible();
	await expect(staff.getByRole('row', { name: /Zara Rahman.*Cancelled \(class full\)/ })).toBeVisible();

	await Promise.all([contextA.close(), contextB.close(), staffContext.close()]);
});
