import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createSandboxApp } from '../sandbox.js';

const API_KEY = 'sandbox-test-key-0123456789';

let server: Server;
let baseUrl: string;

beforeEach(async () => {
	server = createSandboxApp({ apiKey: API_KEY, latencyMs: 0, slowLatencyMs: 50 }).listen(0, '127.0.0.1');
	await once(server, 'listening');
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
	const response = await fetch(baseUrl + path, {
		method,
		headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const authorize = (key: string, paymentMethod: string, amountCents = 2000) =>
	call('POST', '/v1/authorizations', { amountCents, currency: 'SGD', paymentMethod, reference: 'bkg_1' }, { 'idempotency-key': key });

describe('payments sandbox', () => {
	test('should reject a request when the api key is wrong', async () => {
		const response = await fetch(`${baseUrl}/v1/authorizations`, { headers: { authorization: 'Bearer nope' } });
		assert.equal(response.status, 401);
	});

	test('should authorize, then capture, when the card approves', async () => {
		const authorized = await authorize('key-approve-1', 'pm_card_visa');
		assert.equal(authorized.body.status, 'authorized');
		const captured = await call('POST', `/v1/authorizations/${authorized.body.id}/capture`);
		assert.equal(captured.status, 200);
		assert.equal(captured.body.status, 'captured');
	});

	test('should decline with a reason when the card is the declined test card', async () => {
		const declined = await authorize('key-decline-1', 'pm_card_declined');
		assert.equal(declined.body.status, 'declined');
		assert.equal(declined.body.declineCode, 'insufficient_funds');
	});

	test('should return the same authorization when a request is retried with the same key', async () => {
		const [first, second] = await Promise.all([
			authorize('key-retry-1', 'pm_card_visa_slow'),
			authorize('key-retry-1', 'pm_card_visa_slow'),
		]);
		assert.equal(first.body.id, second.body.id);
		const lookup = await call('GET', '/v1/authorizations?idempotencyKey=key-retry-1');
		assert.equal(lookup.body.id, first.body.id);
	});

	test('should refuse to reuse a key when the request body differs', async () => {
		await authorize('key-reuse-1', 'pm_card_visa', 2000);
		const reused = await authorize('key-reuse-1', 'pm_card_visa', 9999);
		assert.equal(reused.status, 422);
	});

	test('should refuse the capture when the card is the capture-fails test card', async () => {
		const authorized = await authorize('key-capture-fails-1', 'pm_card_capture_fails');
		const captured = await call('POST', `/v1/authorizations/${authorized.body.id}/capture`);
		assert.equal(captured.status, 402);
		const voided = await call('POST', `/v1/authorizations/${authorized.body.id}/void`);
		assert.equal(voided.body.status, 'voided');
	});

	test('should not capture a voided authorization and should void only once', async () => {
		const authorized = await authorize('key-void-1', 'pm_card_visa');
		const first = await call('POST', `/v1/authorizations/${authorized.body.id}/void`);
		const again = await call('POST', `/v1/authorizations/${authorized.body.id}/void`);
		assert.equal(first.body.status, 'voided');
		assert.equal(again.status, 200);
		const capture = await call('POST', `/v1/authorizations/${authorized.body.id}/capture`);
		assert.equal(capture.status, 409);
	});
});
