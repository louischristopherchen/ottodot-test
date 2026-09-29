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

	test('should keep the seat and keep retrying while the capture keeps failing briefly', async () => {
		h.provider.failCapture({ transient: true, code: 'provider_error', times: 99 });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);
		await pay(h.tokens.aisha, bookingId);

		// PAYMENT_JOB_ALERT_AFTER_ATTEMPTS is 3 in tests; the job goes well past it.
		for (let run = 0; run < 5; run += 1) {
			await elapseBackoff();
			await runJobsOnce();
		}

		const job = (await PaymentJob.findOne({ where: { kind: 'capture' } }))!;
		assert.equal(job.status, 'pending', 'an outage never gives the seat away');
		assert.equal(job.attempts, 6);
		assert.equal((await Booking.findByPk(bookingId))!.status, 'confirmed');
		assert.equal(await confirmedCount(h.ids.classes.fractions), 4);
	});

	test('should keep the seat when a capture went through but its response was lost', async () => {
		h.provider.failCapture({ transient: true, code: 'provider_timeout', times: 1, afterCapturing: true });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);
		await pay(h.tokens.aisha, bookingId);

		await elapseBackoff();
		await runJobsOnce();

		assert.equal((await PaymentAttempt.findOne({ where: { bookingId } }))!.status, 'captured');
		assert.equal((await Booking.findByPk(bookingId))!.status, 'confirmed');
	});

	test('should keep the seat when the provider refuses a capture that had in fact gone through', async () => {
		h.provider.failCapture({ transient: false, code: 'authorization_captured', times: 1, afterCapturing: true });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);

		const result = await pay(h.tokens.aisha, bookingId);

		assert.equal(result.body.data.outcome, 'confirmed');
		assert.equal(result.body.data.paymentAttempt.status, 'captured');
		assert.equal(h.provider.calls.void, 0, 'a captured payment is never voided');
	});

	test('should leave the job pending if releasing the seat fails, and release it on a later run', async () => {
		h.provider.failCapture({ transient: true, code: 'provider_error', times: 1 });
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);
		await pay(h.tokens.aisha, bookingId);
		const job = (await PaymentJob.findOne({ where: { kind: 'capture' } }))!;

		// The next capture is refused for good, and the release transaction breaks halfway.
		h.provider.failCapture({ transient: false, code: 'capture_declined', times: 99 });
		await sequelize.query(`
			CREATE FUNCTION test_break_release() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
			CREATE TRIGGER test_break_release BEFORE UPDATE OF status ON bookings
				FOR EACH ROW WHEN (NEW.status = 'payment_failed') EXECUTE FUNCTION test_break_release();
		`);
		try {
			await elapseBackoff();
			await assert.rejects(paymentJobsService.runJob(job.id), /simulated failure/);
			assert.equal((await job.reload()).status, 'pending', 'nothing was half written');
			assert.equal((await Booking.findByPk(bookingId))!.status, 'confirmed');
		} finally {
			await sequelize.query('DROP TRIGGER test_break_release ON bookings; DROP FUNCTION test_break_release()');
		}

		// Once the lease expires the worker picks the job up again and finishes the release.
		await sequelize.query("UPDATE payment_jobs SET locked_until = now() - interval '1 second', run_after = now() - interval '1 second'");
		await runJobsOnce();

		assert.equal((await job.reload()).status, 'failed');
		assert.equal((await Booking.findByPk(bookingId))!.status, 'payment_failed');
		assert.equal((await PaymentAttempt.findOne({ where: { bookingId } }))!.status, 'voided');
		assert.equal(await confirmedCount(h.ids.classes.fractions), 3);
	});

	test('should not take a seat on an attempt that reconciliation settled while its request was stalled', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);
		h.provider.hold(bookingId);
		const payment = pay(h.tokens.aisha, bookingId);
		await h.provider.waitForAuthorization(bookingId);

		// The request is stuck long enough for reconciliation to find nothing at the provider.
		await sequelize.query("UPDATE payment_attempts SET updated_at = now() - interval '10 minutes'");
		await reconcilePaymentAttempts();
		h.provider.release(bookingId);
		const result = await payment;

		assert.equal(result.body.data.outcome, 'payment_declined');
		assert.equal(result.body.data.booking.status, 'payment_failed');
		assert.equal(await confirmedCount(h.ids.classes.fractions), 3, 'no seat was taken');
		const attempt = (await PaymentAttempt.findOne({ where: { bookingId } }))!;
		assert.equal(h.provider.statusOf(attempt.providerRef!), 'voided', 'the late authorization was released');
	});

	test('should not expire a booking whose payment starts while the expiry job runs', async () => {
		const bookingId = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		await sequelize.query("UPDATE bookings SET updated_at = now() - interval '2 hours' WHERE id = :id", {
			replacements: { id: bookingId },
		});

		// What payment step 1 does: lock the booking, touch it, record a processing attempt.
		const step1 = await sequelize.transaction();
		const booking = (await Booking.findByPk(bookingId, { lock: step1.LOCK.UPDATE, transaction: step1 }))!;
		booking.changed('updatedAt', true);
		await booking.save({ transaction: step1 });
		await PaymentAttempt.create(
			{ bookingId, amountCents: 2000, currency: 'SGD', paymentMethod: 'pm_card_visa', status: 'processing' },
			{ transaction: step1 },
		);

		const expiry = expireUnpaidBookings();
		await new Promise((resolve) => setTimeout(resolve, 200));
		await step1.commit();
		await expiry;

		assert.equal((await Booking.findByPk(bookingId))!.status, 'pending_payment');
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
		// Sessions are kept until their whole sign-in expired, so old tokens are still recognised as reuse.
		await sequelize.query("UPDATE sessions SET family_expires_at = now() - interval '2 days' WHERE user_id = :id", {
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
