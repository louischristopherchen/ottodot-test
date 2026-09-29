import { randomUUID } from 'node:crypto';

import type { SessionDto, UserDto } from '@trial-booking/shared';
import { Op, col, fn, where as sqlWhere, type Transaction } from 'sequelize';

import { sequelize } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../middleware/error-handler.js';
import { Session, User } from '../../models/index.js';
import { verifyPassword } from './passwords.js';
import { hashRefreshToken, newRefreshToken, signAccessToken } from './tokens.js';

/** Two tabs refreshing with the same cookie at the same moment is not an attack. */
export const REFRESH_REUSE_GRACE_MS = 10_000;

const DAY_MS = 86_400_000;

export interface ClientContext {
	userAgent?: string;
	ip?: string;
}

export interface IssuedSession {
	session: SessionDto;
	/** Null when no new cookie should be set (the grace-window case). */
	refreshToken: string | null;
}

interface SessionFamily {
	familyId: string;
	familyExpiresAt: Date;
}

function toUserDto(user: User): UserDto {
	return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function sessionDto(user: User, session: { id: string; familyId: string }): SessionDto {
	return {
		accessToken: signAccessToken({
			sub: user.id,
			email: user.email,
			role: user.role,
			sid: session.id,
			fam: session.familyId,
		}),
		expiresIn: env.accessTokenTtlSeconds,
		user: toUserDto(user),
	};
}

class AuthService {
	/**
	 * Wrong password and unknown email take the same time and give the same answer.
	 * Repeated failures are slowed by the login rate limits (per IP, per IP and email,
	 * per email), which do not depend on whether the account exists.
	 */
	async login(email: string, password: string, context: ClientContext): Promise<IssuedSession> {
		const user = await User.findOne({ where: sqlWhere(fn('lower', col('email')), email.toLowerCase()) });
		const passwordMatches = await verifyPassword(password, user?.passwordHash ?? null);
		if (!user || !passwordMatches) {
			logger.warn('Failed sign-in', { userId: user?.id ?? null, ip: context.ip });
			throw ApiError.of('INVALID_CREDENTIALS', 'Email or password is incorrect');
		}
		const family = { familyId: randomUUID(), familyExpiresAt: new Date(Date.now() + env.SESSION_MAX_AGE_DAYS * DAY_MS) };
		const { session, refreshToken } = await this.startSession(user, family, context);
		return { session, refreshToken };
	}

	private async startSession(
		user: User,
		family: SessionFamily,
		context: ClientContext,
		transaction?: Transaction,
	): Promise<IssuedSession & { sessionId: string }> {
		const refreshToken = newRefreshToken();
		const expiresAt = new Date(Math.min(Date.now() + env.REFRESH_TTL_DAYS * DAY_MS, family.familyExpiresAt.getTime()));
		const session = await Session.create(
			{
				userId: user.id,
				familyId: family.familyId,
				familyExpiresAt: family.familyExpiresAt,
				refreshTokenHash: hashRefreshToken(refreshToken),
				userAgent: context.userAgent?.slice(0, 255) ?? null,
				ip: context.ip?.slice(0, 64) ?? null,
				expiresAt,
			},
			{ transaction },
		);
		return { session: sessionDto(user, session), refreshToken, sessionId: session.id };
	}

	/**
	 * Rotates the refresh token. Presenting a token that was already rotated revokes the
	 * whole family (someone else has a copy), unless it happens within the grace window,
	 * in which case the caller gets an access token for the successor session and keeps
	 * the cookie the browser already received. A family never outlives SESSION_MAX_AGE_DAYS.
	 */
	async refresh(refreshToken: string | undefined, context: ClientContext): Promise<IssuedSession> {
		if (!refreshToken) {
			throw ApiError.unauthorized();
		}

		const outcome = await sequelize.transaction(async (transaction) => {
			const now = new Date();
			const session = await Session.findOne({
				where: { refreshTokenHash: hashRefreshToken(refreshToken) },
				lock: transaction.LOCK.UPDATE,
				transaction,
			});
			if (!session) {
				return { kind: 'reject' as const };
			}

			if (session.revokedAt) {
				const withinGrace =
					session.revokedReason === 'rotated' &&
					session.replacedById !== null &&
					now.getTime() - session.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
				if (withinGrace) {
					const successor = await Session.findByPk(session.replacedById!, { transaction });
					const user = await User.findByPk(session.userId, { transaction });
					if (successor && user && !successor.revokedAt && successor.expiresAt > now) {
						return { kind: 'issued' as const, issued: { session: sessionDto(user, successor), refreshToken: null } };
					}
				}
				if (session.revokedReason === 'rotated') {
					// Commit the revocation before refusing: this is the point of reuse detection.
					await Session.update(
						{ revokedAt: now, revokedReason: 'reuse_detected' },
						{ where: { familyId: session.familyId, revokedAt: null }, transaction },
					);
					logger.warn('Refresh token reuse detected, session family revoked', {
						userId: session.userId,
						familyId: session.familyId,
					});
				}
				return { kind: 'reject' as const };
			}

			if (session.expiresAt <= now || session.familyExpiresAt <= now) {
				await session.update({ revokedAt: now, revokedReason: 'expired' }, { transaction });
				return { kind: 'reject' as const };
			}

			const user = await User.findByPk(session.userId, { transaction });
			if (!user) {
				return { kind: 'reject' as const };
			}
			const successor = await this.startSession(user, session, context, transaction);
			await session.update(
				{ revokedAt: now, revokedReason: 'rotated', replacedById: successor.sessionId },
				{ transaction },
			);
			return {
				kind: 'issued' as const,
				issued: { session: successor.session, refreshToken: successor.refreshToken },
			};
		});

		if (outcome.kind === 'reject') {
			throw ApiError.unauthorized('Your session has ended. Sign in again.');
		}
		return outcome.issued;
	}

	/** Ends the sign-in (every session in the family) of the presented token. */
	async logout(refreshToken: string | undefined): Promise<void> {
		if (!refreshToken) {
			return;
		}
		const session = await Session.findOne({ where: { refreshTokenHash: hashRefreshToken(refreshToken) } });
		if (session) {
			await Session.update(
				{ revokedAt: new Date(), revokedReason: 'logout' },
				{ where: { familyId: session.familyId, revokedAt: null } },
			);
		}
	}

	/** Ends every sign-in of the user, on every device. */
	async logoutEverywhere(userId: string): Promise<number> {
		const [count] = await Session.update(
			{ revokedAt: new Date(), revokedReason: 'logout' },
			{ where: { userId, revokedAt: null } },
		);
		return count;
	}

	async me(userId: string): Promise<UserDto> {
		const user = await User.findByPk(userId);
		if (!user) {
			throw ApiError.unauthorized();
		}
		return toUserDto(user);
	}

	/**
	 * Removes sessions once their whole family has expired. Rotated and revoked rows are
	 * kept until then, so presenting an old refresh token is still recognised as reuse.
	 */
	async purgeSessions(now = new Date()): Promise<number> {
		return Session.destroy({ where: { familyExpiresAt: { [Op.lt]: new Date(now.getTime() - DAY_MS) } } });
	}
}

export const authService = new AuthService();
