import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';

import { sequelize } from '../../config/database.js';
import { expireUnpaidBookings, purgeExpiredRecords } from '../../jobs/maintenance.js';
import { reconcilePaymentAttempts } from '../../jobs/reconcile-payment-attempts.js';
import { runJobsOnce } from '../../jobs/run-jobs.js';
import { Booking, IdempotencyKey, PaymentAttempt, PaymentJob, Session } from '../../models/index.js';
import { paymentJobsService } from '../../modules/payments/payment-jobs.service.js';
import { closePool, confirmedCount, startHarness, type Harness } from '../support/harness.js';

let h: Harness;
beforeEach(async () => {
	h = await startHarness();
});
afterEach(async () => {
	await h.close();
});
after(closePool);

async function book(token: string, studentId: string, trialClassId: string): Promise<string> {
	return (await h.request('POST', '/api/bookings', { token, body: { studentId, trialClassId } })).body.data.booking.id;
}

function pay(token: string, bookingId: string, paymentMethod = 'pm_card_visa') {
	return h.request('POST', `/api/bookings/${bookingId}/payments`, { token, body: { paymentMethod } });
}

/** Moves every pending job's retry time into the past, as if the backoff had elapsed. */
async function elapseBackoff(): Promise<void> {
	await sequelize.query("UPDATE payment_jobs SET run_after = now() - interval '1 second' WHERE status = 'pending'");
}

/** Pretends a request authorized a card and then died before deciding the seat. */
async function strandedAttempt(bookingId: string, minutesAgo: number): Promise<PaymentAttempt> {
	const attempt = await PaymentAttempt.create({
		bookingId,
		amountCents: 2000,
		currency: 'SGD',
		paymentMethod: 'pm_card_visa',
		status: 'processing',
	});
	await sequelize.query(`UPDATE payment_attempts SET updated_at = now() - interval '${minutesAgo} minutes' WHERE id = :id`, {
		replacements: { id: attempt.id },
	});
	return attempt;
}

describe('background jobs', () => {
	test('should keep the seat and capture later when the capture fails briefly', async () => {
		h.provider.failCapture({ transient: true, code: 'provider_error', times: 1 });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);

		const result = await pay(h.tokens.aisha, bookingId);
		assert.equal(result.body.data.outcome, 'confirmed', 'the seat is secured; only the capture is pending');
		assert.equal(result.body.data.paymentAttempt.status, 'authorized');
		const job = (await PaymentJob.findOne({ where: { kind: 'capture', status: 'pending' } }))!;
		assert.equal(job.attempts, 1);
		assert.ok(job.runAfter > new Date(), 'retry is scheduled with backoff');

		await elapseBackoff();
		await runJobsOnce();

		assert.equal((await PaymentAttempt.findOne({ where: { bookingId } }))!.status, 'captured');
		assert.equal((await job.reload()).status, 'done');
	});

	test('should release the seat and void the hold when the capture keeps failing', async () => {
		h.provider.failCapture({ transient: true, code: 'provider_error', times: 99 });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);
		await pay(h.tokens.aisha, bookingId);
		assert.equal(await confirmedCount(h.ids.classes.fractions), 4);

		// PAYMENT_JOB_MAX_ATTEMPTS is 3 in tests: the request made attempt 1.
		for (let run = 0; run < 2; run += 1) {
			await elapseBackoff();
			await runJobsOnce();
		}

		const booking = (await Booking.findByPk(bookingId))!;
		const attempt = (await PaymentAttempt.findOne({ where: { bookingId } }))!;
		assert.equal(booking.status, 'payment_failed');
		assert.equal(attempt.status, 'voided');
		assert.equal(attempt.failureCode, 'capture_failed');
		assert.equal(await confirmedCount(h.ids.classes.fractions), 3);
	});

	test('should run a job once when two runners reach it at the same moment', async () => {
		h.provider.failCapture({ transient: true, code: 'provider_error', times: 1 });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.patterns);
		await pay(h.tokens.aisha, bookingId);
		const job = (await PaymentJob.findOne({ where: { status: 'pending' } }))!;
		await elapseBackoff();
		const capturesBefore = h.provider.calls.capture;

		const results = await Promise.all([paymentJobsService.runJob(job.id), paymentJobsService.runJob(job.id)]);

		assert.deepEqual(results.sort(), ['done', 'not_due']);
		assert.equal(h.provider.calls.capture - capturesBefore, 1);
	});

	test('should void an authorization whose request never finished', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		const attempt = await strandedAttempt(bookingId, 10);
		const providerRef = h.provider.recordAuthorization(attempt.id);

		assert.equal(await reconcilePaymentAttempts(), 1);

		await attempt.reload();
		assert.equal(attempt.status, 'voided');
		assert.equal(attempt.providerRef, providerRef);
		assert.equal(h.provider.statusOf(providerRef), 'voided');
		assert.equal((await Booking.findByPk(bookingId))!.status, 'pending_payment', 'no seat is granted in the background');
	});

	test('should mark an unfinished attempt declined when the provider never saw it', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		const attempt = await strandedAttempt(bookingId, 10);

		await reconcilePaymentAttempts();

		await attempt.reload();
		assert.equal(attempt.status, 'declined');
		assert.equal(attempt.failureCode, 'provider_unavailable');
	});

	test('should leave a recent attempt alone because its request may still be running', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		const attempt = await strandedAttempt(bookingId, 0);

		assert.equal(await reconcilePaymentAttempts(), 0);
		assert.equal((await attempt.reload()).status, 'processing');
		assert.equal(h.provider.calls.find, 0);
	});

	test('should expire old unpaid bookings but keep those with a payment in flight', async () => {
		const stale = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		const inFlight = await book(h.tokens.aisha, h.ids.students.idris, h.ids.classes.patterns);
		const fresh = await book(h.tokens.chloe, h.ids.students.ethan, h.ids.classes.float);
		await strandedAttempt(inFlight, 0);
		await sequelize.query("UPDATE bookings SET updated_at = now() - interval '2 hours' WHERE id IN (:ids)", {
			replacements: { ids: [stale, inFlight] },
		});

		await expireUnpaidBookings();

		const statusOf = async (id: string) => {
			const booking = (await Booking.findByPk(id))!;
			return `${booking.status}${booking.cancelReason ? `:${booking.cancelReason}` : ''}`;
		};
		assert.equal(await statusOf(stale), 'cancelled:expired');
		assert.equal(await statusOf(inFlight), 'pending_payment');
		assert.equal(await statusOf(fresh), 'pending_payment');
	});

	test('should purge expired sessions and old idempotency keys', async () => {
		await sequelize.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = :id", {
			replacements: { id: h.ids.parents.ben },
		});
		await IdempotencyKey.create({ userId: h.ids.parents.ben, key: 'old-key-000001', requestHash: 'x'.repeat(64), state: 'completed' });
		await sequelize.query("UPDATE idempotency_keys SET created_at = now() - interval '2 days'");

		const purged = await purgeExpiredRecords();

		assert.ok(purged.sessions >= 1);
		assert.equal(purged.idempotencyKeys, 1);
		assert.equal(await Session.count({ where: { userId: h.ids.parents.ben } }), 0);
	});
});
