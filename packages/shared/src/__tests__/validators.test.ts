import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ERROR_STATUS, TEST_CARD_IDS } from '../constants.js';
import { createBookingSchema, idempotencyKeySchema, loginSchema, payBookingSchema } from '../validators.js';

describe('shared validators', () => {
	test('should normalise the email when logging in', () => {
		const parsed = loginSchema.parse({ email: '  Aisha.Rahman@Example.com ', password: 'x' });
		assert.equal(parsed.email, 'aisha.rahman@example.com');
	});

	test('should reject a booking when the ids are not uuids', () => {
		assert.equal(createBookingSchema.safeParse({ studentId: 'stu_1', trialClassId: 'cls_1' }).success, false);
	});

	test('should accept only the sandbox test cards when paying', () => {
		for (const card of TEST_CARD_IDS) {
			assert.equal(payBookingSchema.safeParse({ paymentMethod: card }).success, true);
		}
		assert.equal(payBookingSchema.safeParse({ paymentMethod: '4242424242424242' }).success, false);
	});

	test('should reject an idempotency key when it contains spaces or is too short', () => {
		assert.equal(idempotencyKeySchema.safeParse('has space in it').success, false);
		assert.equal(idempotencyKeySchema.safeParse('short').success, false);
		assert.equal(idempotencyKeySchema.safeParse('3f2b9c1e-7d4a-4e8b-9a61-0c5d2e7f8a90').success, true);
	});

	test('should map every business conflict to 409 when read from the status table', () => {
		for (const code of ['ALREADY_BOOKED', 'CLASS_FULL', 'BOOKING_CLOSED', 'NOT_PAYABLE'] as const) {
			assert.equal(ERROR_STATUS[code], 409);
		}
	});
});
