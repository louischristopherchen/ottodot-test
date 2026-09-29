import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
	decideSeatClaim,
	describeOutcome,
	isPayable,
	nextRunAt,
	outcomeAfterDecline,
	outcomeForRefusal,
	seatRefusal,
} from '../../modules/payments/booking-rules.js';

const NOW = new Date('2026-10-05T01:00:00.000Z');
const LATER = new Date('2026-10-06T09:00:00.000Z');
const openClass = { startsAt: LATER, capacity: 4, confirmedCount: 3 };
const fullClass = { startsAt: LATER, capacity: 4, confirmedCount: 4 };
const startedClass = { startsAt: NOW, capacity: 4, confirmedCount: 0 };

describe('booking rules', () => {
	test('should allow payment only when the booking is pending or failed', () => {
		assert.equal(isPayable('pending_payment'), true);
		assert.equal(isPayable('payment_failed'), true);
		assert.equal(isPayable('confirmed'), false);
		assert.equal(isPayable('cancelled'), false);
	});

	test('should refuse a seat when the class is full or has started', () => {
		assert.equal(seatRefusal(openClass, NOW), null);
		assert.equal(seatRefusal(fullClass, NOW), 'class_full');
		assert.equal(seatRefusal(startedClass, NOW), 'booking_closed');
		// A started class reports booking_closed even when it is also full.
		assert.equal(seatRefusal({ ...fullClass, startsAt: NOW }, NOW), 'booking_closed');
	});

	test('should confirm when the last seat is still free under the lock', () => {
		assert.deepEqual(decideSeatClaim({ status: 'pending_payment', cancelReason: null }, openClass, NOW), {
			action: 'confirm',
		});
		assert.deepEqual(decideSeatClaim({ status: 'payment_failed', cancelReason: null }, openClass, NOW), {
			action: 'confirm',
		});
	});

	test('should refuse and cancel when another parent took the last seat first', () => {
		assert.deepEqual(decideSeatClaim({ status: 'pending_payment', cancelReason: null }, fullClass, NOW), {
			action: 'refuse',
			reason: 'class_full',
			cancelBooking: true,
		});
	});

	test('should report already confirmed when a parallel attempt for the same booking won', () => {
		assert.deepEqual(decideSeatClaim({ status: 'confirmed', cancelReason: null }, fullClass, NOW), {
			action: 'already_confirmed',
		});
	});

	test('should refuse without cancelling again when the booking was already cancelled', () => {
		assert.deepEqual(decideSeatClaim({ status: 'cancelled', cancelReason: 'expired' }, openClass, NOW), {
			action: 'refuse',
			reason: 'expired',
			cancelBooking: false,
		});
	});

	test('should map refusals and late declines to the outcome the parent sees', () => {
		assert.equal(outcomeForRefusal('class_full'), 'class_full');
		assert.equal(outcomeForRefusal('booking_closed'), 'booking_closed');
		assert.equal(outcomeForRefusal('expired'), 'booking_closed');
		assert.equal(outcomeAfterDecline({ status: 'payment_failed', cancelReason: null }), 'payment_declined');
		assert.equal(outcomeAfterDecline({ status: 'confirmed', cancelReason: null }), 'already_confirmed');
		assert.equal(outcomeAfterDecline({ status: 'cancelled', cancelReason: 'class_full' }), 'class_full');
	});

	test('should explain every outcome in a sentence that says whether money moved', () => {
		const context = { studentName: 'Zara Rahman', classTitle: 'Fractions with pizza', cancelReason: null };
		assert.match(describeOutcome('confirmed', context, null), /Zara Rahman has a confirmed seat in "Fractions with pizza"/);
		assert.match(describeOutcome('class_full', context, { status: 'voided', failureCode: null }), /not charged/);
		assert.match(describeOutcome('class_full', context, null), /now full/);
		assert.match(
			describeOutcome('payment_declined', context, { status: 'declined', failureCode: 'insufficient_funds' }),
			/insufficient funds/,
		);
		assert.match(
			describeOutcome('payment_declined', context, { status: 'voided', failureCode: 'capture_failed' }),
			/could not be completed/,
		);
		assert.match(describeOutcome('booking_closed', { ...context, cancelReason: 'expired' }, null), /expired/);
		assert.match(describeOutcome('already_confirmed', context, null), /not charged again/);
	});

	test('should back off exponentially and cap the delay at ten minutes', () => {
		const delay = (attempts: number) => nextRunAt(attempts, NOW).getTime() - NOW.getTime();
		assert.equal(delay(1), 10_000);
		assert.equal(delay(2), 20_000);
		assert.equal(delay(3), 40_000);
		assert.equal(delay(20), 600_000);
	});
});
