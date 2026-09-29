import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';

import jwt from 'jsonwebtoken';

import { sequelize } from '../../config/database.js';
import { REFRESH_REUSE_GRACE_MS } from '../../modules/auth/auth.service.js';
import { DEMO_PASSWORD } from '../../scripts/seed.js';
import { closePool, startHarness, type Harness } from '../support/harness.js';

let h: Harness;
beforeEach(async () => {
	h = await startHarness();
});
afterEach(async () => {
	await h.close();
});
after(closePool);

function refreshCookieFrom(headers: Headers): string | undefined {
	const cookie = headers.getSetCookie().find((value) => value.startsWith('tb_refresh='));
	return cookie?.split(';')[0];
}

async function login(email = 'aisha.rahman@example.com', password = DEMO_PASSWORD) {
	return h.request('POST', '/api/auth/login', { body: { email, password } });
}

function refresh(cookie?: string, origin?: string) {
	return h.request('POST', '/api/auth/refresh', {
		headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
	});
}

describe('authentication', () => {
	test('should sign in and set an httpOnly, SameSite=Strict refresh cookie scoped to /api/auth', async () => {
		const response = await login();

		assert.equal(response.status, 200);
		assert.equal(response.body.data.user.role, 'parent');
		assert.equal(typeof response.body.data.accessToken, 'string');
		const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('tb_refresh='))!;
		assert.match(setCookie, /HttpOnly/i);
		assert.match(setCookie, /SameSite=Strict/i);
		assert.match(setCookie, /Path=\/api\/auth/i);
		assert.doesNotMatch(JSON.stringify(response.body), /tb_refresh/, 'the refresh token never appears in the body');
	});

	test('should answer an unknown email and a wrong password the same way', async () => {
		const unknown = await login('nobody@example.com');
		const wrong = await login('aisha.rahman@example.com', 'not-the-password');

		assert.equal(unknown.status, 401);
		assert.equal(wrong.status, 401);
		assert.deepEqual(unknown.body, wrong.body);
	});

	test('should lock the account after five failed attempts, even for the right password', async () => {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			assert.equal((await login('ben.carter@example.com', 'wrong')).status, 401);
		}
		const locked = await login('ben.carter@example.com');

		assert.equal(locked.status, 429);
		assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
	});

	test('should rotate the refresh token and accept the new one', async () => {
		const first = refreshCookieFrom((await login()).headers)!;

		const rotated = await refresh(first);
		const second = refreshCookieFrom(rotated.headers)!;
		assert.equal(rotated.status, 200);
		assert.notEqual(second, first);

		const again = await refresh(second);
		assert.equal(again.status, 200);
	});

	test('should revoke the whole session family when a rotated token is reused after the grace window', async () => {
		const stolen = refreshCookieFrom((await login()).headers)!;
		const current = refreshCookieFrom((await refresh(stolen)).headers)!;
		await sequelize.query(`UPDATE sessions SET revoked_at = now() - interval '${REFRESH_REUSE_GRACE_MS + 60_000} milliseconds' WHERE revoked_reason = 'rotated'`);

		const reuse = await refresh(stolen);
		assert.equal(reuse.status, 401);

		const legitimate = await refresh(current);
		assert.equal(legitimate.status, 401, 'the thief and the owner are both signed out');
	});

	test('should let two tabs refresh with the same cookie at once without signing the user out', async () => {
		const cookie = refreshCookieFrom((await login()).headers)!;

		const [tabOne, tabTwo] = await Promise.all([refresh(cookie), refresh(cookie)]);

		assert.equal(tabOne.status, 200);
		assert.equal(tabTwo.status, 200);
		const rotations = [tabOne, tabTwo].filter((response) => refreshCookieFrom(response.headers));
		assert.equal(rotations.length, 1, 'only one of them rotates the cookie');
	});

	test('should end the session on logout so the access token stops working at once', async () => {
		const response = await login();
		const token = response.body.data.accessToken;
		const cookie = refreshCookieFrom(response.headers)!;
		assert.equal((await h.request('GET', '/api/auth/me', { token })).status, 200);

		const logout = await h.request('POST', '/api/auth/logout', { headers: { cookie } });
		assert.equal(logout.status, 200);

		assert.equal((await h.request('GET', '/api/auth/me', { token })).status, 401);
		assert.equal((await refresh(cookie)).status, 401);
	});

	test('should refuse a refresh from an origin that is not allowed', async () => {
		const cookie = refreshCookieFrom((await login()).headers)!;
		const response = await refresh(cookie, 'https://evil.example');
		assert.equal(response.status, 403);
	});

	test('should reject a missing, tampered or expired access token', async () => {
		assert.equal((await h.request('GET', '/api/bookings')).status, 401);

		const token = (await login()).body.data.accessToken as string;
		const tampered = `${token.slice(0, -2)}xx`;
		assert.equal((await h.request('GET', '/api/bookings', { token: tampered })).status, 401);

		const claims = jwt.decode(token) as jwt.JwtPayload;
		const expired = jwt.sign(
			{ sub: claims.sub, email: claims.email, role: claims.role, sid: claims.sid, type: 'access' },
			process.env.JWT_SECRET!,
			{ expiresIn: -10, issuer: 'trial-booking', audience: 'trial-booking-api' },
		);
		const response = await h.request('GET', '/api/bookings', { token: expired });
		assert.equal(response.status, 401);
		assert.equal(response.body.error.code, 'TOKEN_EXPIRED');
	});

	test('should keep parents out of staff routes and staff out of parent routes', async () => {
		const roster = await h.request('GET', `/api/staff/trial-classes/${h.ids.classes.float}/roster`, {
			token: h.tokens.aisha,
		});
		assert.equal(roster.status, 403);

		const staffBooking = await h.request('POST', '/api/bookings', {
			token: h.tokens.staff,
			body: { studentId: h.ids.students.zara, trialClassId: h.ids.classes.float },
		});
		assert.equal(staffBooking.status, 403);

		const staffRoster = await h.request('GET', `/api/staff/trial-classes/${h.ids.classes.float}/roster`, {
			token: h.tokens.staff,
		});
		assert.equal(staffRoster.status, 200);
	});
});
