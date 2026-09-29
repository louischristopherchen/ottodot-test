import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';

import { sequelize } from '../../config/database.js';
import { PaymentAttempt } from '../../models/index.js';
import { attemptStatuses, closePool, confirmedCount, startHarness, type Harness } from '../support/harness.js';

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
	return response.body.data.booking.id;
}

function pay(token: string, bookingId: string, paymentMethod = 'pm_card_visa', key?: string) {
	return h.request('POST', `/api/bookings/${bookingId}/payments`, {
		token,
		body: { paymentMethod },
		headers: key ? { 'idempotency-key': key } : {},
	});
}

async function rosterNames(trialClassId: string): Promise<string[]> {
	const roster = await h.request('GET', `/api/staff/trial-classes/${trialClassId}/roster`, { token: h.tokens.staff });
	return roster.body.data.confirmed.map((entry: { studentName: string }) => entry.studentName);
}

describe('paying for a booking', () => {
	test('should confirm, capture and add the child to the roster when the card approves', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);

		const result = await pay(h.tokens.aisha, bookingId);

		assert.equal(result.status, 200);
		assert.equal(result.body.data.outcome, 'confirmed');
		assert.equal(result.body.data.booking.status, 'confirmed');
		assert.equal(result.body.data.paymentAttempt.status, 'captured');
		assert.ok((await rosterNames(h.ids.classes.float)).includes('Zara Rahman'));
		assert.equal(await confirmedCount(h.ids.classes.float), 2);
	});

	test('should keep the child off the roster and the seat free when the card is declined, then allow a retry', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);

		const declined = await pay(h.tokens.aisha, bookingId, 'pm_card_declined');
		assert.equal(declined.body.data.outcome, 'payment_declined');
		assert.equal(declined.body.data.booking.status, 'payment_failed');
		assert.equal(declined.body.data.paymentAttempt.failureCode, 'insufficient_funds');
		assert.ok(!(await rosterNames(h.ids.classes.fractions)).includes('Zara Rahman'));
		assert.equal(await confirmedCount(h.ids.classes.fractions), 3);
		assert.equal(h.provider.calls.capture, 0);

		const retry = await pay(h.tokens.aisha, bookingId, 'pm_card_visa');
		assert.equal(retry.body.data.outcome, 'confirmed');
		assert.deepEqual(await attemptStatuses(bookingId), ['declined', 'captured']);
	});

	test('should release the seat and void the hold when the capture is refused for good', async () => {
		h.provider.failCapture({ transient: false, code: 'capture_declined', times: 1 });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);

		const result = await pay(h.tokens.aisha, bookingId);

		assert.equal(result.body.data.outcome, 'payment_declined');
		assert.equal(result.body.data.booking.status, 'payment_failed');
		assert.equal(result.body.data.booking.confirmedAt, null);
		assert.equal(result.body.data.paymentAttempt.status, 'voided');
		assert.equal(result.body.data.paymentAttempt.failureCode, 'capture_failed');
		assert.match(result.body.data.message, /could not be completed/);
		assert.equal(await confirmedCount(h.ids.classes.fractions), 3, 'the seat is free again');
		assert.equal(h.provider.calls.void, 1);
	});

	test('should ask the parent to retry and leave the attempt for reconciliation when the provider times out', async () => {
		h.provider.failAuthorize({ transient: true, code: 'provider_timeout', times: 1 });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);

		const result = await pay(h.tokens.aisha, bookingId);

		assert.equal(result.body.data.outcome, 'payment_declined');
		assert.equal(result.body.data.booking.status, 'payment_failed');
		assert.equal(result.body.data.paymentAttempt.status, 'processing');
		assert.match(result.body.data.message, /could not reach the payment provider/);
	});

	test('should replay the stored response and not charge again when the same Idempotency-Key is retried', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		const key = 'b7a2d9c4-2f1e-4d3a-9c8b-7e6f5a4b3c2d';

		const first = await pay(h.tokens.aisha, bookingId, 'pm_card_visa', key);
		const replay = await pay(h.tokens.aisha, bookingId, 'pm_card_visa', key);

		assert.equal(first.body.data.outcome, 'confirmed');
		assert.equal(replay.status, 200);
		assert.equal(replay.headers.get('idempotent-replayed'), 'true');
		assert.deepEqual(replay.body, first.body);
		assert.equal(h.provider.calls.authorize, 1);
	});

	test('should refuse an Idempotency-Key reused for a different request', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		const key = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
		await pay(h.tokens.aisha, bookingId, 'pm_card_declined', key);

		const reused = await pay(h.tokens.aisha, bookingId, 'pm_card_visa', key);

		assert.equal(reused.status, 422);
		assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
	});

	test('should refuse a retry with the same key while the first request is still running', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		const key = 'd4c3b2a1-0f9e-4d8c-8b7a-6f5e4d3c2b1a';
		h.provider.hold(bookingId);
		const first = pay(h.tokens.aisha, bookingId, 'pm_card_visa', key);
		await h.provider.waitForAuthorization(bookingId);

		const concurrent = await pay(h.tokens.aisha, bookingId, 'pm_card_visa', key);
		assert.equal(concurrent.status, 409);
		assert.equal(concurrent.body.error.code, 'REQUEST_IN_PROGRESS');

		h.provider.release(bookingId);
		assert.equal((await first).body.data.outcome, 'confirmed');
		assert.equal(h.provider.calls.authorize, 1);
	});

	test('should not touch the card when the booking is already confirmed', async () => {
		const [rows] = await sequelize.query(
			"SELECT id FROM bookings WHERE student_id = :leo AND status = 'confirmed'",
			{ replacements: { leo: h.ids.students.leo } },
		);
		const leosBooking = (rows as { id: string }[])[0]!.id;

		const result = await pay(h.tokens.ben, leosBooking);

		assert.equal(result.body.data.outcome, 'already_confirmed');
		assert.equal(result.body.data.paymentAttempt, null);
		assert.equal(h.provider.calls.authorize, 0);
	});

	test('should refuse the booking and void the hold when the class starts while the card is being authorized', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		h.provider.hold(bookingId);
		const payment = pay(h.tokens.aisha, bookingId);
		await h.provider.waitForAuthorization(bookingId);

		await sequelize.query("UPDATE trial_classes SET starts_at = now() - interval '1 minute' WHERE id = :id", {
			replacements: { id: h.ids.classes.float },
		});
		h.provider.release(bookingId);
		const result = await payment;

		assert.equal(result.body.data.outcome, 'booking_closed');
		assert.equal(result.body.data.booking.cancelReason, 'booking_closed');
		assert.equal(result.body.data.paymentAttempt.status, 'voided');

		const again = await pay(h.tokens.aisha, bookingId);
		assert.equal(again.status, 409);
		assert.equal(again.body.error.code, 'NOT_PAYABLE');
	});

	test("should not let a parent pay for another family's booking", async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);

		const result = await pay(h.tokens.chloe, bookingId);

		assert.equal(result.status, 404);
		assert.equal(h.provider.calls.authorize, 0);
		assert.equal(await PaymentAttempt.count({ where: { bookingId } }), 0);
	});

	test('should reject a payment method that is not a sandbox test card', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);

		const result = await pay(h.tokens.aisha, bookingId, '4242424242424242');

		assert.equal(result.status, 400);
		assert.equal(result.body.error.code, 'VALIDATION_ERROR');
		assert.ok(result.body.error.details?.paymentMethod);
	});
});
