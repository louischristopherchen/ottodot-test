import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ProviderError, SandboxPaymentProvider } from '../../infra/payment-provider/index.js';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const impl = (async (input: string | URL | Request, init?: RequestInit) => {
		const call = { url: String(input), init: init ?? {} };
		calls.push(call);
		return respond(call);
	}) as typeof fetch;
	return { impl, calls };
}

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const provider = (impl: typeof fetch) =>
	new SandboxPaymentProvider({ baseUrl: 'http://sandbox.test', apiKey: 'unit-key-0123456789', timeoutMs: 1000, fetch: impl });

const request = {
	idempotencyKey: 'attempt-1',
	reference: 'booking-1',
	amountCents: 2000,
	currency: 'SGD',
	paymentMethod: 'pm_card_visa',
};

const isProviderError = (transient: boolean, code?: string) => (error: unknown) =>
	error instanceof ProviderError && error.transient === transient && (code === undefined || error.code === code);

describe('sandbox provider client', () => {
	test('should send the api key and the idempotency key when authorizing', async () => {
		const { impl, calls } = fakeFetch(() => json(200, { id: 'auth_1', status: 'authorized' }));

		const result = await provider(impl).authorize(request);

		assert.deepEqual(result, { status: 'authorized', providerRef: 'auth_1' });
		const headers = calls[0]!.init.headers as Record<string, string>;
		assert.equal(headers.authorization, 'Bearer unit-key-0123456789');
		assert.equal(headers['idempotency-key'], 'attempt-1');
		assert.equal(calls[0]!.url, 'http://sandbox.test/v1/authorizations');
	});

	test('should return the decline code when the card is declined', async () => {
		const { impl } = fakeFetch(() => json(200, { id: 'auth_2', status: 'declined', declineCode: 'insufficient_funds' }));
		assert.deepEqual(await provider(impl).authorize(request), { status: 'declined', declineCode: 'insufficient_funds' });
	});

	test('should treat a 5xx or 429 as transient', async () => {
		for (const status of [500, 503, 429]) {
			const { impl } = fakeFetch(() => json(status, { error: 'busy' }));
			await assert.rejects(provider(impl).capture('auth_1'), isProviderError(true, 'provider_error'));
		}
	});

	test('should treat a network failure as transient', async () => {
		const { impl } = fakeFetch(() => {
			throw new TypeError('fetch failed');
		});
		await assert.rejects(provider(impl).authorize(request), isProviderError(true, 'provider_unreachable'));
	});

	test('should treat a timeout as transient', async () => {
		const { impl } = fakeFetch(() => {
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		await assert.rejects(provider(impl).authorize(request), isProviderError(true, 'provider_timeout'));
	});

	test('should treat a refused capture or void as permanent and keep the provider code', async () => {
		const { impl } = fakeFetch(() => json(402, { error: 'capture_declined' }));
		await assert.rejects(provider(impl).capture('auth_1'), isProviderError(false, 'capture_declined'));
		const voided = fakeFetch(() => json(409, { error: 'authorization_captured' }));
		await assert.rejects(provider(voided.impl).voidAuthorization('auth_1'), isProviderError(false, 'authorization_captured'));
	});

	test('should return null when the provider has no authorization for the key', async () => {
		const { impl, calls } = fakeFetch(() => json(404, { error: 'not_found' }));
		assert.equal(await provider(impl).findAuthorization('attempt 9'), null);
		assert.equal(calls[0]!.url, 'http://sandbox.test/v1/authorizations?idempotencyKey=attempt%209');
	});
});
