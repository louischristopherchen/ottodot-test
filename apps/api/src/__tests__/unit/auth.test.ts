import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import jwt from 'jsonwebtoken';

import { durationToSeconds } from '../../config/env.js';
import { hashPassword, verifyPassword } from '../../modules/auth/passwords.js';
import {
	JWT_AUDIENCE,
	JWT_ISSUER,
	hashRefreshToken,
	newRefreshToken,
	signAccessToken,
	verifyAccessToken,
} from '../../modules/auth/tokens.js';

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const claims = { sub: 'user-1', email: 'aisha.rahman@example.com', role: 'parent' as const, sid: 'session-1', fam: 'family-1' };

describe('access tokens', () => {
	test('should round-trip the claims when the token is valid', () => {
		const token = signAccessToken(claims, SECRET, 60);
		assert.deepEqual(verifyAccessToken(token, SECRET), claims);
	});

	test('should reject a token signed for another issuer or audience', () => {
		const foreign = jwt.sign({ ...claims, type: 'access' }, SECRET, { issuer: 'someone-else', audience: JWT_AUDIENCE });
		assert.throws(() => verifyAccessToken(foreign, SECRET), { code: 'UNAUTHORIZED' });
		const wrongAudience = jwt.sign({ ...claims, type: 'access' }, SECRET, { issuer: JWT_ISSUER, audience: 'other' });
		assert.throws(() => verifyAccessToken(wrongAudience, SECRET), { code: 'UNAUTHORIZED' });
	});

	test('should reject a token without a session family', () => {
		const { fam: _fam, ...withoutFamily } = claims;
		const legacy = jwt.sign({ ...withoutFamily, type: 'access' }, SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
		assert.throws(() => verifyAccessToken(legacy, SECRET), { code: 'UNAUTHORIZED' });
	});

	test('should reject a token that is not an access token', () => {
		const refreshShaped = jwt.sign({ ...claims, type: 'refresh' }, SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
		assert.throws(() => verifyAccessToken(refreshShaped, SECRET), { code: 'UNAUTHORIZED' });
	});

	test('should report TOKEN_EXPIRED when the token has expired', () => {
		const expired = signAccessToken(claims, SECRET, -1);
		assert.throws(() => verifyAccessToken(expired, SECRET), { code: 'TOKEN_EXPIRED' });
	});

	test('should reject a token signed with another secret or algorithm none', () => {
		assert.throws(() => verifyAccessToken(signAccessToken(claims, `${SECRET}-other`, 60), SECRET), { code: 'UNAUTHORIZED' });
		const unsigned = jwt.sign({ ...claims, type: 'access' }, '', { algorithm: 'none', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
		assert.throws(() => verifyAccessToken(unsigned, SECRET), { code: 'UNAUTHORIZED' });
	});
});

describe('refresh tokens', () => {
	test('should generate unguessable tokens and store only a stable hash', () => {
		const first = newRefreshToken();
		assert.notEqual(first, newRefreshToken());
		assert.ok(first.length >= 64);
		assert.equal(hashRefreshToken(first), hashRefreshToken(first));
		assert.match(hashRefreshToken(first), /^[0-9a-f]{64}$/);
	});
});

describe('passwords', () => {
	test('should verify the right password and refuse a wrong one', async () => {
		const hash = await hashPassword('correct horse', 4);
		assert.equal(await verifyPassword('correct horse', hash), true);
		assert.equal(await verifyPassword('wrong horse', hash), false);
	});

	test('should return false and still compare when the account does not exist', async () => {
		assert.equal(await verifyPassword('anything', null), false);
	});
});

describe('durations', () => {
	test('should convert duration strings to seconds', () => {
		assert.equal(durationToSeconds('45s'), 45);
		assert.equal(durationToSeconds('30m'), 1800);
		assert.equal(durationToSeconds('12h'), 43_200);
		assert.equal(durationToSeconds('7d'), 604_800);
		assert.throws(() => durationToSeconds('30 minutes'));
	});
});
