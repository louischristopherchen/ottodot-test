import { randomUUID } from 'node:crypto';

import type { SessionDto, UserDto } from '@trial-booking/shared';
import { Op, fn, col, where as sqlWhere, type Transaction } from 'sequelize';

import { sequelize } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../middleware/error-handler.js';
import { Session, User } from '../../models/index.js';
import { lockedUntilAfter, verifyPassword } from './passwords.js';
import { hashRefreshToken, newRefreshToken, signAccessToken } from './tokens.js';

/** Two tabs refreshing with the same cookie at the same moment is not an attack. */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export interface ClientContext {
	userAgent?: string;
	ip?: string;
}

export interface IssuedSession {
	session: SessionDto;
	/** Null when no new cookie should be set (the grace-window case). */
	refreshToken: string | null;
}

function toUserDto(user: User): UserDto {
	return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function sessionDto(user: User, sessionId: string): SessionDto {
	return {
		accessToken: signAccessToken({ sub: user.id, email: user.email, role: user.role, sid: sessionId }),
		expiresIn: env.accessTokenTtlSeconds,
		user: toUserDto(user),
	};
}

class AuthService {
	async login(email: string, password: string, context: ClientContext): Promise<IssuedSession> {
		const now = new Date();
		const user = await User.findOne({ where: sqlWhere(fn('lower', col('email')), email.toLowerCase()) });

		if (user?.lockedUntil && user.lockedUntil > now) {
			throw ApiError.of('ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Try again in a few minutes.');
		}

		const passwordMatches = await verifyPassword(password, user?.passwordHash ?? null);
		if (!user || !passwordMatches) {
			if (user) {
				await this.recordFailedLogin(user.id, now);
			}
			throw ApiError.of('INVALID_CREDENTIALS', 'Email or password is incorrect');
		}

		if (user.failedLoginCount > 0 || user.lockedUntil) {
			await user.update({ failedLoginCount: 0, lockedUntil: null });
		}
		const { session, refreshToken } = await this.startSession(user, randomUUID(), context);
		return { session, refreshToken };
	}

	/** Atomic increment, so parallel wrong guesses all count. */
	private async recordFailedLogin(userId: string, now: Date): Promise<void> {
		const [, rows] = await User.update(
			{ failedLoginCount: sequelize.literal('failed_login_count + 1') as unknown as number },
			{ where: { id: userId }, returning: true },
		);
		const failedCount = rows[0]?.failedLoginCount ?? 0;
		const lockedUntil = lockedUntilAfter(failedCount, now);
		if (lockedUntil) {
			await User.update({ lockedUntil }, { where: { id: userId } });
			logger.warn('Account locked after failed sign-ins', { userId, failedCount });
		}
	}

	private async startSession(
		user: User,
		familyId: string,
		context: ClientContext,
		transaction?: Transaction,
	): Promise<IssuedSession & { sessionId: string }> {
		const refreshToken = newRefreshToken();
		const session = await Session.create(
			{
				userId: user.id,
				familyId,
				refreshTokenHash: hashRefreshToken(refreshToken),
				userAgent: context.userAgent?.slice(0, 255) ?? null,
				ip: context.ip?.slice(0, 64) ?? null,
				expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * 86_400_000),
			},
			{ transaction },
		);
		return { session: sessionDto(user, session.id), refreshToken, sessionId: session.id };
	}

	/**
	 * Rotates the refresh token. Presenting a token that was already rotated revokes the
	 * whole family (someone else has a copy), unless it happens within the grace window,
	 * in which case the caller gets an access token for the successor session and keeps
	 * the cookie the browser already received.
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
						return { kind: 'issued' as const, issued: { session: sessionDto(user, successor.id), refreshToken: null } };
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

			if (session.expiresAt <= now) {
				await session.update({ revokedAt: now, revokedReason: 'expired' }, { transaction });
				return { kind: 'reject' as const };
			}

			const user = await User.findByPk(session.userId, { transaction });
			if (!user) {
				return { kind: 'reject' as const };
			}
			const successor = await this.startSession(user, session.familyId, context, transaction);
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

	/** Ends every session in the family of the presented token. */
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

	async me(userId: string): Promise<UserDto> {
		const user = await User.findByPk(userId);
		if (!user) {
			throw ApiError.unauthorized();
		}
		return toUserDto(user);
	}

	/** Sessions past their expiry, and revoked ones older than a day, are removed by the worker. */
	async purgeSessions(now = new Date()): Promise<number> {
		return Session.destroy({
			where: {
				[Op.or]: [
					{ expiresAt: { [Op.lt]: now } },
					{ revokedAt: { [Op.lt]: new Date(now.getTime() - 86_400_000) } },
				],
			},
		});
	}
}

export const authService = new AuthService();
