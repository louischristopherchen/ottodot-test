import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { ProviderError, SandboxPaymentProvider } from '../../infra/payment-provider/index.js';

// The real HTTP client against the real sandbox, started as its own process the way
// PM2 runs it, so timeouts, status codes and idempotency are exercised end to end.

const API_KEY = 'integration-sandbox-key-0123456789';
let sandbox: ChildProcess;
let baseUrl: string;

async function freePort(): Promise<number> {
	const server = createServer().listen(0, '127.0.0.1');
	await once(server, 'listening');
	const { port } = server.address() as { port: number };
	await new Promise((resolve) => server.close(resolve));
	return port;
}

before(async () => {
	const port = await freePort();
	baseUrl = `http://127.0.0.1:${port}`;
	const entry = fileURLToPath(new URL('../../../../payments-sandbox/src/index.ts', import.meta.url));
	sandbox = spawn(process.execPath, ['--import', 'tsx', entry], {
		env: {
			...process.env,
			SANDBOX_PORT: String(port),
			SANDBOX_API_KEY: API_KEY,
			SANDBOX_LATENCY_MS: '0',
			SANDBOX_SLOW_LATENCY_MS: '1500',
		},
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	for await (const chunk of sandbox.stdout!) {
		if (String(chunk).includes('listening')) {
			break;
		}
	}
});

after(() => {
	sandbox.kill('SIGTERM');
});

function client(overrides: Partial<{ apiKey: string; timeoutMs: number; baseUrl: string }> = {}) {
	return new SandboxPaymentProvider({ baseUrl, apiKey: API_KEY, timeoutMs: 1000, ...overrides });
}

const request = (key: string, paymentMethod = 'pm_card_visa') => ({
	idempotencyKey: key,
	reference: 'booking-1',
	amountCents: 2000,
	currency: 'SGD',
	paymentMethod,
});

describe('sandbox payment provider client', () => {
	test('should authorize and then capture when the card approves', async () => {
		const result = await client().authorize(request('it-approve-1'));
		assert.equal(result.status, 'authorized');
		await client().capture(result.status === 'authorized' ? result.providerRef : '');
		const found = await client().findAuthorization('it-approve-1');
		assert.equal(found?.status, 'captured');
	});

	test('should return the same authorization when authorize is retried with the same key', async () => {
		const first = await client().authorize(request('it-retry-1'));
		const second = await client().authorize(request('it-retry-1'));
		assert.deepEqual(second, first);
	});

	test('should report a decline with its reason', async () => {
		const result = await client().authorize(request('it-decline-1', 'pm_card_declined'));
		assert.deepEqual(result, { status: 'declined', declineCode: 'insufficient_funds' });
	});

	test('should classify a refused capture as permanent', async () => {
		const result = await client().authorize(request('it-capture-fails-1', 'pm_card_capture_fails'));
		assert.equal(result.status, 'authorized');
		await assert.rejects(
			client().capture(result.status === 'authorized' ? result.providerRef : ''),
			(error: unknown) => error instanceof ProviderError && !error.transient && error.code === 'capture_declined',
		);
	});

	test('should classify a timeout as transient', async () => {
		await assert.rejects(
			client({ timeoutMs: 200 }).authorize(request('it-slow-1', 'pm_card_visa_slow')),
			(error: unknown) => error instanceof ProviderError && error.transient && error.code === 'provider_timeout',
		);
	});

	test('should classify an unreachable provider as transient', async () => {
		await assert.rejects(
			client({ baseUrl: 'http://127.0.0.1:9' }).authorize(request('it-down-1')),
			(error: unknown) => error instanceof ProviderError && error.transient,
		);
	});

	test('should classify a wrong api key as permanent', async () => {
		await assert.rejects(
			client({ apiKey: 'wrong-key-0000000000' }).authorize(request('it-key-1')),
			(error: unknown) => error instanceof ProviderError && !error.transient,
		);
	});

	test('should return null for an authorization the provider never saw', async () => {
		assert.equal(await client().findAuthorization('never-sent-key'), null);
	});
});
