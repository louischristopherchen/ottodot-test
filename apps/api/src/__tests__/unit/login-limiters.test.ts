import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, test } from 'node:test';

import express from 'express';

import { createLoginLimiters } from '../../middleware/rate-limiter.js';

let server: Server;

async function start(limits: { perIp: number; perIpAndEmail: number; perEmail: number }) {
	const app = express();
	// Lets each request pick its client IP through X-Forwarded-For, as nginx would set it.
	app.set('trust proxy', true);
	app.use(express.json());
	app.post('/login', ...createLoginLimiters({ ...limits, windowMs: 60_000 }), (_req, res) => {
		res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'x' } });
	});
	server = app.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/login`;
	return (ip: string, email: string) =>
		fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
			body: JSON.stringify({ email, password: 'guess' }),
		}).then((response) => response.status);
}

afterEach(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

describe('login rate limits', () => {
	test('should stop one address from spraying many accounts', async () => {
		const login = await start({ perIp: 3, perIpAndEmail: 100, perEmail: 100 });
		const statuses = [];
		for (let index = 0; index < 4; index += 1) {
			statuses.push(await login('203.0.113.7', `parent${index}@example.com`));
		}
		assert.deepEqual(statuses, [401, 401, 401, 429]);
		assert.equal(await login('203.0.113.8', 'parent0@example.com'), 401, 'another address is unaffected');
	});

	test('should stop many addresses from hammering one account', async () => {
		const login = await start({ perIp: 100, perIpAndEmail: 100, perEmail: 3 });
		const statuses = [];
		for (let index = 0; index < 4; index += 1) {
			statuses.push(await login(`198.51.100.${index}`, 'Aisha.Rahman@Example.com '));
		}
		assert.deepEqual(statuses, [401, 401, 401, 429]);
	});

	test('should treat an email that has no account exactly like one that does', async () => {
		const login = await start({ perIp: 100, perIpAndEmail: 2, perEmail: 100 });
		const real = [await login('203.0.113.9', 'aisha.rahman@example.com'), await login('203.0.113.9', 'aisha.rahman@example.com'), await login('203.0.113.9', 'aisha.rahman@example.com')];
		const unknown = [await login('203.0.113.9', 'nobody@example.com'), await login('203.0.113.9', 'nobody@example.com'), await login('203.0.113.9', 'nobody@example.com')];
		assert.deepEqual(real, unknown);
	});
});
