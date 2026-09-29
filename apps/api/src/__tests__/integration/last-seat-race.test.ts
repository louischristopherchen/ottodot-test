import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, afterEach, beforeEach, describe, test } from 'node:test';

import { sequelize } from '../../config/database.js';
import { Student, User } from '../../models/index.js';
import { hashPassword } from '../../modules/auth/passwords.js';
import { DEMO_PASSWORD } from '../../scripts/seed.js';
import { attemptStatuses, closePool, confirmedCount, startHarness, type Harness } from '../support/harness.js';

// "Fractions with pizza" is seeded with exactly 3 of 4 seats confirmed.

let h: Harness;
beforeEach(async () => {
	h = await startHarness();
});
afterEach(async () => {
	await h.close();
});
after(closePool);

async function book(token: string, studentId: string, trialClassId: string): Promise<string> {
	const response = await h.request('POST', '/api/bookings', { token, body: { studentId, trialClassId } });
	assert.ok(response.status === 201 || response.status === 200, `booking failed: ${response.status}`);
	return response.body.data.booking.id;
}

function pay(token: string, bookingId: string, paymentMethod = 'pm_card_visa') {
	return h.request('POST', `/api/bookings/${bookingId}/payments`, { token, body: { paymentMethod } });
}

describe('last-seat race', () => {
	test('should give the seat to B and void A when B pays while A is still paying (the scenario in the brief)', async () => {
		const fractions = h.ids.classes.fractions;

		// User A selects the last seat and moves to payment; the authorization is in flight.
		const bookingA = await book(h.tokens.aisha, h.ids.students.zara, fractions);
		h.provider.hold(bookingA);
		const paymentA = pay(h.tokens.aisha, bookingA);
		await h.provider.waitForAuthorization(bookingA);

		// User B selects the same seat and completes payment first.
		const bookingB = await book(h.tokens.chloe, h.ids.students.ethan, fractions);
		const resultB = await pay(h.tokens.chloe, bookingB);
		assert.equal(resultB.body.data.outcome, 'confirmed');

		// User A's payment completes.
		h.provider.release(bookingA);
		const resultA = await paymentA;

		assert.equal(resultA.status, 200);
		assert.equal(resultA.body.data.outcome, 'class_full');
		assert.equal(resultA.body.data.booking.status, 'cancelled');
		assert.equal(resultA.body.data.booking.cancelReason, 'class_full');
		assert.equal(resultA.body.data.paymentAttempt.status, 'voided', "A's hold is released, never captured");
		assert.match(resultA.body.data.message, /not charged/);

		assert.equal(await confirmedCount(fractions), 4);
		const roster = await h.request('GET', `/api/staff/trial-classes/${fractions}/roster`, { token: h.tokens.staff });
		const names = roster.body.data.confirmed.map((entry: { studentName: string }) => entry.studentName);
		assert.ok(names.includes('Ethan Tan'));
		assert.ok(!names.includes('Zara Rahman'));
		assert.deepEqual(h.provider.calls, { authorize: 2, capture: 1, void: 1, find: 0 });
	});

	test('should refuse A before touching the card when A pays only after B has confirmed', async () => {
		const fractions = h.ids.classes.fractions;
		const bookingA = await book(h.tokens.aisha, h.ids.students.zara, fractions);
		const bookingB = await book(h.tokens.chloe, h.ids.students.ethan, fractions);

		await pay(h.tokens.chloe, bookingB);
		const resultA = await pay(h.tokens.aisha, bookingA);

		assert.equal(resultA.body.data.outcome, 'class_full');
		assert.equal(resultA.body.data.paymentAttempt, null);
		assert.equal(h.provider.calls.authorize, 1, 'only B reached the provider');
	});

	test('should confirm exactly one of twelve parents paying for the last seat at the same moment', async () => {
		const fractions = h.ids.classes.fractions;
		const passwordHash = await hashPassword(DEMO_PASSWORD);
		const crowd: { token: string; bookingId: string }[] = [];
		for (let index = 0; index < 12; index += 1) {
			const parent = await User.create({
				email: `crowd${index}@example.com`,
				name: `Crowd parent ${index}`,
				role: 'parent',
				passwordHash,
			});
			const child = await Student.create({ parentId: parent.id, name: `Crowd child ${index}`, level: 4 });
			const token = await h.login(parent.email);
			crowd.push({ token, bookingId: await book(token, child.id, fractions) });
		}
		// Every payment gets past the early check before any authorization returns.
		h.provider.latencyMs = 50;

		const results = await Promise.all(crowd.map(({ token, bookingId }) => pay(token, bookingId)));

		const outcomes = results.map((result) => result.body.data.outcome);
		assert.equal(outcomes.filter((outcome) => outcome === 'confirmed').length, 1);
		assert.equal(outcomes.filter((outcome) => outcome === 'class_full').length, 11);
		assert.equal(await confirmedCount(fractions), 4);
		const statuses = (await Promise.all(crowd.map(({ bookingId }) => attemptStatuses(bookingId)))).flat();
		assert.equal(statuses.filter((status) => status === 'captured').length, 1);
		assert.equal(statuses.filter((status) => status === 'voided').length, 11);
	});

	test('should charge once when the same booking is paid twice at the same moment', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);
		h.provider.latencyMs = 30;

		const results = await Promise.all([pay(h.tokens.aisha, bookingId), pay(h.tokens.aisha, bookingId)]);

		assert.deepEqual(results.map((result) => result.body.data.outcome).sort(), ['already_confirmed', 'confirmed']);
		assert.deepEqual((await attemptStatuses(bookingId)).sort(), ['captured', 'voided']);
		assert.equal(await confirmedCount(h.ids.classes.fractions), 4);

		// The roster shows the attempt that paid, not the voided duplicate.
		const roster = await h.request('GET', `/api/staff/trial-classes/${h.ids.classes.fractions}/roster`, { token: h.tokens.staff });
		const zara = roster.body.data.confirmed.find((entry: { studentName: string }) => entry.studentName === 'Zara Rahman');
		assert.equal(zara.paymentStatus, 'captured');
	});

	test('should make the seat claim wait while another transaction holds the class row lock', async () => {
		const fractions = h.ids.classes.fractions;
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, fractions);

		const blocker = await sequelize.transaction();
		await sequelize.query('SELECT id FROM trial_classes WHERE id = :id FOR UPDATE', {
			replacements: { id: fractions },
			transaction: blocker,
		});

		let finished = false;
		const payment = pay(h.tokens.aisha, bookingId).then((result) => {
			finished = true;
			return result;
		});
		await sleep(400);
		assert.equal(finished, false, 'the claim must wait for the class row lock');

		await blocker.commit();
		const result = await payment;
		assert.equal(result.body.data.outcome, 'confirmed');
	});
});
