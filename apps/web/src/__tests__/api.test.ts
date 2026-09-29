import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { SessionDto } from '@trial-booking/shared';

import { ApiError, createApi, type FetchLike } from '../services/api';
import type { SessionEndReason } from '../stores/session';

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

type Handler = (call: Call, index: number) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ok(data: unknown, status = 200): Response {
	return json(status, { success: true, data });
}

function fail(status: number, code: string, message: string, details?: Record<string, string[]>): Response {
	return json(status, { success: false, error: { code, message, details } });
}

function session(accessToken: string): SessionDto {
	return {
		accessToken,
		expiresIn: 1800,
		user: { id: 'usr-1', email: 'aisha.rahman@example.com', name: 'Aisha Rahman', role: 'parent' },
	};
}

function setup(handler: Handler) {
	const calls: Call[] = [];
	const sessions: SessionDto[] = [];
	const ends: SessionEndReason[] = [];
	let token: string | null = 'old-token';

	const fetch: FetchLike = async (url, init) => {
		const call: Call = {
			url,
			method: init.method ?? 'GET',
			headers: { ...(init.headers as Record<string, string>) },
			body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
		};
		calls.push(call);
		return handler(call, calls.length - 1);
	};

	const api = createApi({
		fetch,
		getAccessToken: () => token,
		onSession: (next) => {
			token = next.accessToken;
			sessions.push(next);
		},
		onSessionEnd: (reason) => {
			token = null;
			ends.push(reason);
		},
	});

	return { api, calls, sessions, ends };
}

const BOOKING_PATH = '/api/bookings/bk-1/payments';

describe('api client envelope', () => {
	test('should return data when the envelope reports success', async () => {
		const { api } = setup(() => ok([{ id: 'st-1', name: 'Zara Rahman', level: 3 }]));
		assert.deepEqual(await api.listStudents(), [{ id: 'st-1', name: 'Zara Rahman', level: 3 }]);
	});

	test('should throw an ApiError with code, status and details when the envelope reports failure', async () => {
		const { api } = setup(() =>
			fail(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', { email: ['Enter a valid email address'] }),
		);
		const error = await api.login({ email: 'x@example.com', password: 'x' }).catch((caught: unknown) => caught);
		assert.ok(error instanceof ApiError);
		assert.equal(error.code, 'VALIDATION_ERROR');
		assert.equal(error.status, 400);
		assert.equal(error.message, 'Check the highlighted fields.');
		assert.equal(error.fieldError('email'), 'Enter a valid email address');
	});

	test('should raise SERVICE_UNAVAILABLE when a proxy answers 502 with HTML', async () => {
		const { api } = setup(() => new Response('<html>Bad gateway</html>', { status: 502 }));
		await assert.rejects(api.listTrialClasses(), { name: 'ApiError', code: 'SERVICE_UNAVAILABLE', status: 502 });
	});

	test('should raise NETWORK_ERROR with status 0 when fetch rejects', async () => {
		const { api } = setup(() => {
			throw new TypeError('Failed to fetch');
		});
		await assert.rejects(api.listBookings(), { name: 'ApiError', code: 'NETWORK_ERROR', status: 0 });
	});

	test('should send the bearer token, JSON body and Idempotency-Key when paying', async () => {
		const { api, calls } = setup(() => ok({ outcome: 'confirmed', message: 'Booked.' }));
		await api.payBooking('bk-1', { paymentMethod: 'pm_card_visa' }, 'key-0001-abcd');
		assert.equal(calls[0].url, BOOKING_PATH);
		assert.equal(calls[0].method, 'POST');
		assert.equal(calls[0].headers.Authorization, 'Bearer old-token');
		assert.equal(calls[0].headers['Content-Type'], 'application/json');
		assert.equal(calls[0].headers['Idempotency-Key'], 'key-0001-abcd');
		assert.deepEqual(calls[0].body, { paymentMethod: 'pm_card_visa' });
	});
});

describe('api client token refresh', () => {
	test('should refresh once and retry with the same Idempotency-Key when the access token expired', async () => {
		const { api, calls, sessions } = setup((call) => {
			if (call.url === '/api/auth/refresh') {
				return ok(session('new-token'));
			}
			return call.headers.Authorization === 'Bearer new-token'
				? ok({ outcome: 'confirmed', message: 'Zara Rahman is booked.' })
				: fail(401, 'TOKEN_EXPIRED', 'Your session expired.');
		});

		const result = await api.payBooking('bk-1', { paymentMethod: 'pm_card_visa' }, 'key-0002-abcd');

		assert.deepEqual(result, { outcome: 'confirmed', message: 'Zara Rahman is booked.' });
		assert.deepEqual(
			calls.map((call) => call.url),
			[BOOKING_PATH, '/api/auth/refresh', BOOKING_PATH],
		);
		assert.equal(calls[2].headers['Idempotency-Key'], 'key-0002-abcd');
		assert.equal(calls[2].headers.Authorization, 'Bearer new-token');
		assert.deepEqual(calls[2].body, calls[0].body);
		assert.equal(sessions.length, 1);
	});

	test('should share one refresh when two requests fail with 401 at the same time', async () => {
		let refreshes = 0;
		const { api } = setup(async (call) => {
			if (call.url === '/api/auth/refresh') {
				refreshes += 1;
				await new Promise((resolve) => setTimeout(resolve, 5));
				return ok(session('new-token'));
			}
			return call.headers.Authorization === 'Bearer new-token' ? ok([]) : fail(401, 'UNAUTHORIZED', 'Sign in.');
		});

		const [classes, bookings] = await Promise.all([api.listTrialClasses(), api.listBookings()]);

		assert.deepEqual(classes, []);
		assert.deepEqual(bookings, []);
		assert.equal(refreshes, 1);
	});

	test('should end the session and reject when the refresh is refused', async () => {
		const { api, calls, ends } = setup((call) =>
			call.url === '/api/auth/refresh'
				? fail(401, 'UNAUTHORIZED', 'Your session has ended. Sign in again.')
				: fail(401, 'TOKEN_EXPIRED', 'Your session expired.'),
		);

		await assert.rejects(api.listBookings(), { code: 'UNAUTHORIZED', status: 401 });
		assert.deepEqual(ends, ['expired']);
		assert.equal(calls.length, 2);
	});

	test('should keep the session when the refresh fails because the network is down', async () => {
		const { api, ends } = setup((call) => {
			if (call.url === '/api/auth/refresh') {
				throw new TypeError('Failed to fetch');
			}
			return fail(401, 'TOKEN_EXPIRED', 'Your session expired.');
		});

		await assert.rejects(api.listBookings(), { code: 'NETWORK_ERROR' });
		assert.deepEqual(ends, []);
	});

	test('should not retry a second time when the retried request is still unauthorized', async () => {
		const { api, calls } = setup((call) =>
			call.url === '/api/auth/refresh' ? ok(session('new-token')) : fail(401, 'UNAUTHORIZED', 'Sign in.'),
		);

		await assert.rejects(api.listBookings(), { code: 'UNAUTHORIZED' });
		assert.equal(calls.length, 3);
	});

	test('should not refresh when the login itself answers 401', async () => {
		const { api, calls } = setup(() => fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'));

		await assert.rejects(api.login({ email: 'aisha.rahman@example.com', password: 'wrong' }), {
			code: 'INVALID_CREDENTIALS',
			message: 'Email or password is incorrect.',
		});
		assert.equal(calls.length, 1);
	});

	test('should not refresh when a 401 carries a code other than TOKEN_EXPIRED or UNAUTHORIZED', async () => {
		const { api, calls } = setup(() => fail(401, 'INVALID_CREDENTIALS', 'No.'));
		await assert.rejects(api.listBookings(), { code: 'INVALID_CREDENTIALS' });
		assert.equal(calls.length, 1);
	});
});

describe('api client sign-in and sign-out', () => {
	test('should store the session when login succeeds', async () => {
		const { api, sessions, calls } = setup(() => ok(session('fresh-token')));
		await api.login({ email: 'aisha.rahman@example.com', password: 'trial-demo-2026' });
		assert.equal(sessions[0].accessToken, 'fresh-token');
		assert.deepEqual(calls[0].body, { email: 'aisha.rahman@example.com', password: 'trial-demo-2026' });
	});

	test('should end the session locally when logout cannot reach the server', async () => {
		const { api, ends } = setup(() => {
			throw new TypeError('Failed to fetch');
		});
		await api.logout();
		assert.deepEqual(ends, ['signed_out']);
	});
});

describe('api client with several tabs or requests in flight', () => {
	test('should retry with the token another request already refreshed instead of refreshing again', async () => {
		let releaseLate: () => void = () => undefined;
		const lateAnswer = new Promise<void>((resolve) => {
			releaseLate = resolve;
		});
		const { api, calls } = setup(async (call) => {
			if (call.url === '/api/auth/refresh') {
				return ok(session('new-token'));
			}
			if (call.headers.Authorization === 'Bearer old-token') {
				if (call.url === '/api/students') {
					await lateAnswer;
				}
				return fail(401, 'TOKEN_EXPIRED', 'Access token has expired');
			}
			return ok([]);
		});

		// Sent with the old token; its 401 only arrives after the other request refreshed.
		const late = api.listStudents();
		await api.listTrialClasses();
		releaseLate();

		assert.deepEqual(await late, []);
		assert.equal(calls.filter((call) => call.url === '/api/auth/refresh').length, 1);
		assert.equal(calls.at(-1)?.headers.Authorization, 'Bearer new-token');
	});
});
