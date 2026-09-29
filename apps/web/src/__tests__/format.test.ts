import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
	bookingStatusLabel,
	confirmedOfCapacity,
	formatMoney,
	formatSgtDateTime,
	levelLabel,
	paymentOutcomeTone,
	paymentStatusText,
	seatsLabel,
	subjectLabel,
} from '../lib/format';

describe('formatMoney', () => {
	test('should show the currency code and two decimals when given SGD cents', () => {
		assert.equal(formatMoney(2000, 'SGD'), 'SGD 20.00');
	});

	test('should add thousand separators when the amount is large', () => {
		assert.equal(formatMoney(123456789, 'SGD'), 'SGD 1,234,567.89');
	});

	test('should use a plain space when Intl would insert a no-break space', () => {
		assert.equal(formatMoney(2000, 'sgd').includes(' '), false);
	});

	test('should not divide by 100 when the currency has no minor unit', () => {
		assert.equal(formatMoney(1500, 'JPY'), 'JPY 1,500');
	});
});

describe('formatSgtDateTime', () => {
	test('should show Singapore time with an SGT suffix when given a UTC instant', () => {
		assert.equal(formatSgtDateTime('2026-10-01T09:00:00.000Z'), 'Thu 1 Oct, 5:00 pm SGT');
	});

	test('should move to the next day when the UTC time is late evening', () => {
		assert.equal(formatSgtDateTime('2026-09-30T16:30:00Z'), 'Thu 1 Oct, 12:30 am SGT');
	});

	test('should show 12:00 pm when it is noon in Singapore', () => {
		assert.equal(formatSgtDateTime('2026-10-01T04:00:00Z'), 'Thu 1 Oct, 12:00 pm SGT');
	});

	test('should abbreviate September as Sep when the date is in September', () => {
		assert.equal(formatSgtDateTime('2026-09-29T02:00:00Z'), 'Tue 29 Sep, 10:00 am SGT');
	});

	test('should return an empty string when the input is not a date', () => {
		assert.equal(formatSgtDateTime('not a date'), '');
	});
});

describe('bookingStatusLabel', () => {
	test('should map each live status to its text and tone when not cancelled', () => {
		assert.deepEqual(bookingStatusLabel('pending_payment', null), { text: 'Pending payment', tone: 'warning' });
		assert.deepEqual(bookingStatusLabel('payment_failed', null), { text: 'Payment failed', tone: 'destructive' });
		assert.deepEqual(bookingStatusLabel('confirmed', null), { text: 'Confirmed', tone: 'success' });
	});

	test('should name the reason in a secondary badge when the booking is cancelled', () => {
		assert.deepEqual(bookingStatusLabel('cancelled', 'class_full'), {
			text: 'Cancelled (class full)',
			tone: 'secondary',
		});
		assert.equal(bookingStatusLabel('cancelled', 'booking_closed').text, 'Cancelled (class started)');
		assert.equal(bookingStatusLabel('cancelled', 'expired').text, 'Cancelled (expired)');
	});

	test('should fall back to Cancelled when no reason is given', () => {
		assert.equal(bookingStatusLabel('cancelled', null).text, 'Cancelled');
	});
});

describe('paymentStatusText', () => {
	test('should show None yet when there is no attempt', () => {
		assert.equal(paymentStatusText(null, null), 'None yet');
	});

	test('should map every attempt status to the copy in the design when an attempt exists', () => {
		assert.equal(paymentStatusText('processing', null), 'Processing');
		assert.equal(paymentStatusText('authorized', null), 'Authorized');
		assert.equal(paymentStatusText('declined', 'insufficient_funds'), 'Declined (insufficient funds)');
		assert.equal(paymentStatusText('captured', null), 'Paid');
		assert.equal(paymentStatusText('voided', null), 'Not charged (hold released)');
		assert.equal(paymentStatusText('capture_failed', 'capture_refused'), 'Capture failed');
	});

	test('should spell out an unknown decline code when the provider sends one', () => {
		assert.equal(paymentStatusText('declined', 'card_expired'), 'Declined (card expired)');
		assert.equal(paymentStatusText('declined', null), 'Declined');
	});
});

describe('seatsLabel', () => {
	test('should show seats left in green when more than one is free', () => {
		assert.deepEqual(seatsLabel(3, 4), { text: '3 of 4 seats left', tone: 'success' });
	});

	test('should warn when exactly one seat is left', () => {
		assert.deepEqual(seatsLabel(1, 4), { text: 'Last seat', tone: 'warning' });
	});

	test('should show Full when no seat is left', () => {
		assert.deepEqual(seatsLabel(0, 4), { text: 'Full', tone: 'secondary' });
	});
});

describe('paymentOutcomeTone', () => {
	test('should pick success, destructive or default when given each outcome', () => {
		assert.equal(paymentOutcomeTone('confirmed'), 'success');
		assert.equal(paymentOutcomeTone('payment_declined'), 'destructive');
		assert.equal(paymentOutcomeTone('class_full'), 'destructive');
		assert.equal(paymentOutcomeTone('booking_closed'), 'destructive');
		assert.equal(paymentOutcomeTone('already_confirmed'), 'default');
	});
});

describe('small labels', () => {
	test('should format level, subject and seat count when given raw values', () => {
		assert.equal(levelLabel(3), 'P3');
		assert.equal(subjectLabel('math'), 'Math');
		assert.equal(subjectLabel('science'), 'Science');
		assert.equal(confirmedOfCapacity(3, 4), '3 of 4');
	});
});
