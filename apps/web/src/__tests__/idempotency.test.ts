import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { idempotencyKeySchema } from '@trial-booking/shared';

import { newIdempotencyKey } from '../lib/idempotency';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newIdempotencyKey', () => {
	test('should use crypto.randomUUID when the page is a secure context', () => {
		assert.equal(newIdempotencyKey({ randomUUID: () => 'fixed-uuid-value', getRandomValues: (a) => a }), 'fixed-uuid-value');
	});

	test('should build a v4 UUID from getRandomValues when randomUUID is missing', () => {
		const key = newIdempotencyKey({ getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
		assert.match(key, UUID_V4);
	});

	test('should return a different key accepted by the API when called twice', () => {
		const first = newIdempotencyKey();
		const second = newIdempotencyKey();
		assert.notEqual(first, second);
		assert.equal(idempotencyKeySchema.safeParse(first).success, true);
	});
});
