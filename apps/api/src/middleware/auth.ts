import type { Role } from '@trial-booking/shared';
import type { NextFunction, Request, Response } from 'express';
import { Op } from 'sequelize';

import { Session, User } from '../models/index.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { ApiError } from './error-handler.js';

export interface AuthenticatedUser {
	id: string;
	email: string;
	name: string;
	role: Role;
	/** Session the access token was issued for; a revoked session ends the token too. */
	sessionId: string;
}

export interface AuthRequest extends Request {
	user?: AuthenticatedUser;
}

/**
 * Verifies the bearer token, then checks that its session is still alive and reloads
 * the user. Two primary-key lookups per request, so logout and refresh-token reuse
 * detection take effect at once instead of when the access token expires.
 */
export async function authMiddleware(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
	try {
		const header = req.get('authorization') ?? '';
		if (!header.startsWith('Bearer ')) {
			throw ApiError.unauthorized();
		}
		const payload = verifyAccessToken(header.slice(7));

		const session = await Session.findOne({
			where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
			attributes: ['id'],
		});
		if (!session) {
			throw ApiError.unauthorized('Your session has ended. Sign in again.');
		}
		const user = await User.findByPk(payload.sub, { attributes: ['id', 'email', 'name', 'role'] });
		if (!user) {
			throw ApiError.unauthorized();
		}

		req.user = { id: user.id, email: user.email, name: user.name, role: user.role, sessionId: session.id };
		next();
	} catch (error) {
		next(error);
	}
}

export function requireUser(req: AuthRequest): AuthenticatedUser {
	if (!req.user) {
		throw ApiError.unauthorized();
	}
	return req.user;
}

export function roleAuth(roles: Role[]) {
	return (req: AuthRequest, _res: Response, next: NextFunction): void => {
		if (!req.user) {
			next(ApiError.unauthorized());
			return;
		}
		if (!roles.includes(req.user.role)) {
			next(ApiError.forbidden());
			return;
		}
		next();
	};
}
