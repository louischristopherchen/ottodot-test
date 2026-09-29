import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BookingDto, PaymentAttemptDto } from '@trial-booking/shared';

import {
	bookingPaymentText,
	isClassBookable,
	isPayable,
	lastPaymentAttempt,
	newerBooking,
	paymentOfRecord,
	upsertBooking,
} from '../lib/booking';

function attempt(status: PaymentAttemptDto['status'], failureCode: string | null = null): PaymentAttemptDto {
	return {
		id: `att-${status}`,
		status,
		amountCents: 2000,
		currency: 'SGD',
		paymentMethod: 'pm_card_visa',
		failureCode,
		createdAt: '2026-09-29T01:00:00.000Z',
		updatedAt: '2026-09-29T01:00:00.000Z',
	};
}

function booking(overrides: Partial<BookingDto> = {}): BookingDto {
	return {
		id: 'bk-1',
		status: 'pending_payment',
		cancelReason: null,
		createdAt: '2026-09-29T01:00:00.000Z',
		updatedAt: '2026-09-29T01:00:00.000Z',
		confirmedAt: null,
		student: { id: 'st-1', name: 'Zara Rahman' },
		trialClass: {
			id: 'tc-1',
			title: 'Fractions with pizza',
			subject: 'math',
			startsAt: '2026-10-01T09:00:00.000Z',
			priceCents: 2000,
			currency: 'SGD',
		},
		paymentAttempts: [],
		...overrides,
	};
}

describe('isPayable', () => {
	test('should allow paying when the booking is pending or failed', () => {
		assert.equal(isPayable('pending_payment'), true);
		assert.equal(isPayable('payment_failed'), true);
	});

	test('should refuse paying when the booking is confirmed or cancelled', () => {
		assert.equal(isPayable('confirmed'), false);
		assert.equal(isPayable('cancelled'), false);
	});
});

describe('isClassBookable', () => {
	test('should be false when no seat is left', () => {
		const base = {
			id: 'tc-1',
			subject: 'math' as const,
			title: 'Fractions with pizza',
			teacherName: 'Ms Lim',
			startsAt: '2026-10-01T09:00:00.000Z',
			durationMinutes: 60,
			capacity: 4,
			priceCents: 2000,
			currency: 'SGD',
		};
		assert.equal(isClassBookable({ ...base, confirmedCount: 4, seatsLeft: 0 }), false);
		assert.equal(isClassBookable({ ...base, confirmedCount: 3, seatsLeft: 1 }), true);
	});
});

describe('lastPaymentAttempt', () => {
	test('should return the newest attempt when attempts arrive oldest first', () => {
		const item = booking({ paymentAttempts: [attempt('declined', 'insufficient_funds'), attempt('captured')] });
		assert.equal(lastPaymentAttempt(item)?.status, 'captured');
		assert.equal(bookingPaymentText(item), 'Paid');
	});

	test('should return null and None yet when nobody has paid', () => {
		assert.equal(lastPaymentAttempt(booking()), null);
		assert.equal(bookingPaymentText(booking()), 'None yet');
	});
});

describe('newerBooking', () => {
	test('should keep the copy with the later updatedAt when a stale poll lands after a payment', () => {
		const stale = booking({ status: 'pending_payment', updatedAt: '2026-09-29T01:00:00.000Z' });
		const fresh = booking({ status: 'confirmed', updatedAt: '2026-09-29T01:00:05.000Z' });
		assert.equal(newerBooking(stale, fresh).status, 'confirmed');
		assert.equal(newerBooking(fresh, stale).status, 'confirmed');
	});

	test('should return the fallback when the list does not have the booking yet', () => {
		const fresh = booking();
		assert.equal(newerBooking(undefined, fresh), fresh);
	});
});

describe('upsertBooking', () => {
	test('should put a new booking first when the list is newest first', () => {
		const existing = booking({ id: 'bk-old' });
		const created = booking({ id: 'bk-new' });
		assert.deepEqual(
			upsertBooking([existing], created).map((item) => item.id),
			['bk-new', 'bk-old'],
		);
	});

	test('should replace the booking in place when it is already listed', () => {
		const list = [booking({ id: 'bk-2' }), booking({ id: 'bk-1' })];
		const paid = booking({ id: 'bk-1', status: 'confirmed', updatedAt: '2026-09-29T02:00:00.000Z' });
		const next = upsertBooking(list, paid);
		assert.deepEqual(
			next.map((item) => [item.id, item.status]),
			[
				['bk-2', 'pending_payment'],
				['bk-1', 'confirmed'],
			],
		);
		assert.notEqual(next, list);
	});

	test('should start a list when the cache is empty', () => {
		assert.equal(upsertBooking(undefined, booking()).length, 1);
	});
});

describe('payment of record', () => {
	test('should show the captured attempt when a later duplicate attempt was voided', () => {
		const doubleClicked = booking({
			status: 'confirmed',
			confirmedAt: '2026-09-29T01:00:00.000Z',
			paymentAttempts: [attempt('captured'), attempt('voided')],
		});
		assert.equal(paymentOfRecord(doubleClicked)?.status, 'captured');
		assert.equal(bookingPaymentText(doubleClicked), 'Paid');
	});

	test('should show the latest attempt when the booking is not confirmed', () => {
		const retried = booking({ status: 'payment_failed', paymentAttempts: [attempt('voided'), attempt('declined', 'insufficient_funds')] });
		assert.equal(paymentOfRecord(retried)?.status, 'declined');
	});
});
