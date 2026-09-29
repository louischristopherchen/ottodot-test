import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { redact } from '../../config/logger.js';
import { installProcessGuards } from '../../config/process-guards.js';
import { roleAuth, type AuthRequest } from '../../middleware/auth.js';
import { ApiError, errorHandler, notFoundHandler } from '../../middleware/error-handler.js';
import { ipKey } from '../../middleware/rate-limiter.js';
import { requestId } from '../../middleware/request-id.js';
import { requireAllowedOrigin } from '../../middleware/same-origin.js';

type ErrorBody = { error: { message: string; details?: Record<string, string[]> } };

function fakeResponse() {
	const response = {
		statusCode: 200,
		body: undefined as unknown,
		headers: {} as Record<string, string>,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		json(payload: unknown) {
			this.body = payload;
			return this;
		},
		setHeader(name: string, value: string) {
			this.headers[name.toLowerCase()] = value;
		},
	};
	return response;
}

function fakeRequest(headers: Record<string, string> = {}, extra: Partial<AuthRequest> = {}) {
	return { get: (name: string) => headers[name.toLowerCase()], method: 'GET', originalUrl: '/x', ...extra } as unknown as AuthRequest;
}

function capture(): { next: NextFunction; errors: unknown[] } {
	const errors: unknown[] = [];
	return { errors, next: ((error?: unknown) => errors.push(error)) as NextFunction };
}

describe('error handler', () => {
	test('should turn a zod error into 400 with field paths and no rejected values', () => {
		const result = z.object({ email: z.string().email() }).safeParse({ email: 'secret-value' });
		const res = fakeResponse();
		errorHandler((result as { error: z.ZodError }).error, fakeRequest() as Request, res as unknown as Response, () => undefined);

		assert.equal(res.statusCode, 400);
		assert.deepEqual(Object.keys((res.body as ErrorBody).error.details ?? {}), ['email']);
		assert.doesNotMatch(JSON.stringify(res.body), /secret-value/);
	});

	test('should send an ApiError with the status from the shared table', () => {
		const res = fakeResponse();
		errorHandler(ApiError.of('CLASS_FULL', 'This class is full.'), fakeRequest() as Request, res as unknown as Response, () => undefined);
		assert.equal(res.statusCode, 409);
		assert.deepEqual(res.body, { success: false, error: { code: 'CLASS_FULL', message: 'This class is full.' } });
	});

	test('should hide the message of an unexpected error outside development', () => {
		const res = fakeResponse();
		errorHandler(new Error('connection string leaked'), fakeRequest() as Request, res as unknown as Response, () => undefined);
		assert.equal(res.statusCode, 500);
		assert.equal((res.body as ErrorBody).error.message, 'Something went wrong');
	});

	test('should map body parser errors to 413 and 400', () => {
		const tooLarge = fakeResponse();
		errorHandler(Object.assign(new Error('too large'), { status: 413, type: 'entity.too.large', expose: true }), fakeRequest() as Request, tooLarge as unknown as Response, () => undefined);
		assert.equal(tooLarge.statusCode, 413);
		const badJson = fakeResponse();
		errorHandler(Object.assign(new SyntaxError('bad'), { status: 400, type: 'entity.parse.failed', expose: true }), fakeRequest() as Request, badJson as unknown as Response, () => undefined);
		assert.equal(badJson.statusCode, 400);
	});

	test('should answer unknown routes with a JSON 404', () => {
		const res = fakeResponse();
		notFoundHandler(fakeRequest() as Request, res as unknown as Response);
		assert.equal(res.statusCode, 404);
	});
});

describe('request id', () => {
	test('should keep a well-formed client id and replace anything else', () => {
		const good = '3f2b9c1e-7d4a-4e8b-9a61-0c5d2e7f8a90';
		const req = fakeRequest({ 'x-request-id': good }) as Request;
		const res = fakeResponse();
		requestId(req, res as unknown as Response, () => undefined);
		assert.equal(req.requestId, good);
		assert.equal(res.headers['x-request-id'], good);

		const forged = fakeRequest({ 'x-request-id': 'id\nlevel=error' }) as Request;
		requestId(forged, fakeResponse() as unknown as Response, () => undefined);
		assert.notEqual(forged.requestId, 'id\nlevel=error');
		assert.match(forged.requestId, /^[0-9a-f-]{36}$/);
	});
});

describe('access control', () => {
	test('should let the right role through and refuse the others', () => {
		const parentOnly = roleAuth(['parent']);
		const allowed = capture();
		parentOnly(fakeRequest({}, { user: { id: '1', email: 'a', name: 'A', role: 'parent', sessionId: 's' } }), fakeResponse() as unknown as Response, allowed.next);
		assert.deepEqual(allowed.errors, [undefined]);

		const refused = capture();
		parentOnly(fakeRequest({}, { user: { id: '2', email: 'b', name: 'B', role: 'staff', sessionId: 's' } }), fakeResponse() as unknown as Response, refused.next);
		assert.equal((refused.errors[0] as ApiError).code, 'FORBIDDEN');

		const anonymous = capture();
		parentOnly(fakeRequest(), fakeResponse() as unknown as Response, anonymous.next);
		assert.equal((anonymous.errors[0] as ApiError).code, 'UNAUTHORIZED');
	});

	test('should refuse a cookie request from an origin that is not configured', () => {
		const foreign = capture();
		requireAllowedOrigin(fakeRequest({ origin: 'https://evil.example' }), fakeResponse() as unknown as Response, foreign.next);
		assert.equal((foreign.errors[0] as ApiError).code, 'FORBIDDEN');

		const own = capture();
		requireAllowedOrigin(fakeRequest({ origin: 'http://localhost:4000' }), fakeResponse() as unknown as Response, own.next);
		assert.deepEqual(own.errors, [undefined]);
	});

	test('should group IPv6 clients by /64 for rate limiting', () => {
		assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
		assert.equal(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
	});
});

describe('logging and process guards', () => {
	test('should redact values under credential-like keys at any depth', () => {
		const redacted = redact({ user: 'aisha', password: 'x', nested: { accessToken: 'y', list: [{ apiKey: 'z' }] } });
		assert.deepEqual(redacted, {
			user: 'aisha',
			password: '[redacted]',
			nested: { accessToken: '[redacted]', list: [{ apiKey: '[redacted]' }] },
		});
	});

	test('should shut down cleanly on SIGTERM and SIGINT and with exit code 1 on an uncaught exception', () => {
		const emitter = new EventEmitter();
		const calls: [string, number | undefined][] = [];
		installProcessGuards({
			process: emitter,
			shutdown: async (signal, exitCode) => {
				calls.push([signal, exitCode]);
			},
		});

		emitter.emit('SIGTERM');
		emitter.emit('SIGINT');
		emitter.emit('uncaughtException', new Error('boom'), 'uncaughtException');
		emitter.emit('unhandledRejection', new Error('ignored'));

		assert.deepEqual(calls, [
			['SIGTERM', undefined],
			['SIGINT', undefined],
			['uncaughtException', 1],
		]);
	});
});
