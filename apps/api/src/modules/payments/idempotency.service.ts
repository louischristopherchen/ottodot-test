import { createHash } from 'node:crypto';

import { Op, UniqueConstraintError } from 'sequelize';

import { ApiError } from '../../middleware/error-handler.js';
import { IdempotencyKey } from '../../models/index.js';

export interface StoredResponse {
	status: number;
	body: unknown;
}

/** Keys are kept for a day: long enough for any client retry. */
const RETENTION_MS = 86_400_000;

/** A request that died mid-flight leaves its key in progress; after this long a retry may take it over. */
export const STALE_IN_PROGRESS_MS = 5 * 60_000;

export function requestFingerprint(parts: Record<string, unknown>): string {
	return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

class IdempotencyService {
	/**
	 * Registers a key before the request is processed. Returns the stored response when
	 * the same request already completed; refuses a key reused for a different request
	 * and a retry that arrives while the first request is still running.
	 */
	async begin(userId: string, key: string, requestHash: string): Promise<StoredResponse | null> {
		try {
			await IdempotencyKey.create({ userId, key, requestHash, state: 'in_progress' });
			return null;
		} catch (error) {
			if (!(error instanceof UniqueConstraintError)) {
				throw error;
			}
		}
		const existing = await IdempotencyKey.findOne({ where: { userId, key } });
		if (!existing) {
			// Released between our insert and this read: treat as a fresh request.
			return this.begin(userId, key, requestHash);
		}
		if (existing.requestHash !== requestHash) {
			throw ApiError.of('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
		}
		if (existing.state === 'in_progress') {
			// Conditional update: of several retries arriving together, only one takes the key over.
			const [takenOver] = await IdempotencyKey.update(
				{ requestHash },
				{
					where: {
						id: existing.id,
						state: 'in_progress',
						updatedAt: { [Op.lt]: new Date(Date.now() - STALE_IN_PROGRESS_MS) },
					},
				},
			);
			if (takenOver === 1) {
				return null;
			}
			throw ApiError.of('REQUEST_IN_PROGRESS', 'The same payment request is still being processed');
		}
		return { status: existing.responseStatus!, body: existing.responseBody };
	}

	async complete(userId: string, key: string, response: StoredResponse): Promise<void> {
		await IdempotencyKey.update(
			{ state: 'completed', responseStatus: response.status, responseBody: response.body as object },
			{ where: { userId, key } },
		);
	}

	/** After an error the key is released, so the client can retry the same request. */
	async release(userId: string, key: string): Promise<void> {
		await IdempotencyKey.destroy({ where: { userId, key, state: 'in_progress' } });
	}

	async purgeExpired(now = new Date()): Promise<number> {
		return IdempotencyKey.destroy({ where: { createdAt: { [Op.lt]: new Date(now.getTime() - RETENTION_MS) } } });
	}
}

export const idempotencyService = new IdempotencyService();
