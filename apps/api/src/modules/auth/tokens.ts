import { createHash, randomBytes } from 'node:crypto';

import type { Role } from '@trial-booking/shared';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';
import { ApiError } from '../../middleware/error-handler.js';

// Verified, not only emitted: a token signed with the same secret for another
// purpose must not pass as an access token for this API.
export const JWT_ISSUER = 'trial-booking';
export const JWT_AUDIENCE = 'trial-booking-api';

export interface AccessTokenClaims {
	sub: string;
	email: string;
	role: Role;
	/** Session the token was issued for. */
	sid: string;
	/**
	 * Session family (one sign-in). A token stays valid while its family has a live
	 * session, so a refresh in one tab does not cut off the other tabs, while logout and
	 * refresh-token reuse detection, which revoke the whole family, end every token at once.
	 */
	fam: string;
}

export function signAccessToken(
	claims: AccessTokenClaims,
	secret = env.JWT_SECRET,
	ttlSeconds = env.accessTokenTtlSeconds,
): string {
	return jwt.sign({ ...claims, type: 'access' }, secret, {
		algorithm: 'HS256',
		expiresIn: ttlSeconds,
		issuer: JWT_ISSUER,
		audience: JWT_AUDIENCE,
	});
}

export function verifyAccessToken(token: string, secret = env.JWT_SECRET): AccessTokenClaims {
	let decoded: unknown;
	try {
		decoded = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
	} catch (error) {
		if (error instanceof jwt.TokenExpiredError) {
			throw ApiError.of('TOKEN_EXPIRED', 'Access token has expired');
		}
		throw ApiError.unauthorized('Invalid access token');
	}
	const payload = decoded as Partial<AccessTokenClaims> & { type?: string };
	if (payload.type !== 'access' || !payload.sub || !payload.sid || !payload.fam || !payload.role || !payload.email) {
		throw ApiError.unauthorized('Invalid access token');
	}
	return { sub: payload.sub, sid: payload.sid, fam: payload.fam, role: payload.role, email: payload.email };
}

/** Opaque refresh token. Only its SHA-256 is stored. */
export function newRefreshToken(): string {
	return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
