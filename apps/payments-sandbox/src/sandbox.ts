import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { TEST_CARDS, type TestCardId } from '@trial-booking/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

/**
 * A stand-in for a card acquirer that supports manual capture (authorize, then capture
 * or void), the model Stripe and Adyen use. State is in memory: a restart forgets every
 * authorization, which the API treats like any other provider failure.
 */

type AuthorizationStatus = 'authorized' | 'declined' | 'captured' | 'voided';

interface Authorization {
	id: string;
	idempotencyKey: string;
	requestHash: string;
	reference: string;
	amountCents: number;
	currency: string;
	paymentMethod: string;
	status: AuthorizationStatus;
	declineCode: string | null;
	createdAt: string;
}

export interface SandboxOptions {
	apiKey: string;
	latencyMs: number;
	slowLatencyMs: number;
}

const authorizeBody = z.object({
	amountCents: z.number().int().nonnegative(),
	currency: z.string().length(3),
	paymentMethod: z.string().min(1).max(64),
	reference: z.string().min(1).max(100),
});

function isTestCard(value: string): value is TestCardId {
	return Object.hasOwn(TEST_CARDS, value);
}

function publicView(authorization: Authorization) {
	return {
		id: authorization.id,
		status: authorization.status,
		declineCode: authorization.declineCode,
		reference: authorization.reference,
		amountCents: authorization.amountCents,
		currency: authorization.currency,
	};
}

function sameSecret(expected: string, supplied: string): boolean {
	const a = createHash('sha256').update(expected).digest();
	const b = createHash('sha256').update(supplied).digest();
	return timingSafeEqual(a, b);
}

export function createSandboxApp(options: SandboxOptions): express.Express {
	const byId = new Map<string, Authorization>();
	const byIdempotencyKey = new Map<string, Authorization>();
	// Two requests with the same key that arrive together must get one authorization.
	const inFlight = new Map<string, Promise<Authorization>>();

	const app = express();
	app.disable('x-powered-by');
	app.use(express.json({ limit: '8kb' }));

	app.get('/health', (_req, res) => {
		res.json({ ok: true });
	});

	app.use('/v1', (req: Request, res: Response, next: NextFunction) => {
		const header = req.get('authorization') ?? '';
		const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
		if (!supplied || !sameSecret(options.apiKey, supplied)) {
			res.status(401).json({ error: 'invalid_api_key' });
			return;
		}
		next();
	});

	app.post('/v1/authorizations', async (req, res) => {
		const idempotencyKey = req.get('idempotency-key');
		if (!idempotencyKey) {
			res.status(400).json({ error: 'idempotency_key_required' });
			return;
		}
		const parsed = authorizeBody.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: 'invalid_request' });
			return;
		}
		const requestHash = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');

		// Look up and register in one synchronous step: an await in between would let a
		// second request with the same key start its own authorization.
		let pending = byIdempotencyKey.has(idempotencyKey) ? undefined : inFlight.get(idempotencyKey);
		if (!byIdempotencyKey.has(idempotencyKey) && !pending) {
			pending = authorize(idempotencyKey, requestHash, parsed.data);
			inFlight.set(idempotencyKey, pending);
			pending.finally(() => inFlight.delete(idempotencyKey)).catch(() => undefined);
		}
		let authorization: Authorization;
		try {
			authorization = byIdempotencyKey.get(idempotencyKey) ?? (await pending!);
		} catch {
			res.status(500).json({ error: 'internal_error' });
			return;
		}

		if (authorization.requestHash !== requestHash) {
			res.status(422).json({ error: 'idempotency_key_reused' });
			return;
		}
		res.json(publicView(authorization));
	});

	async function authorize(
		idempotencyKey: string,
		requestHash: string,
		body: z.infer<typeof authorizeBody>,
	): Promise<Authorization> {
		const card = body.paymentMethod;
		await sleep(card === 'pm_card_visa_slow' ? options.slowLatencyMs : options.latencyMs);

		let status: AuthorizationStatus = 'authorized';
		let declineCode: string | null = null;
		if (!isTestCard(card)) {
			status = 'declined';
			declineCode = 'invalid_payment_method';
		} else if (card === 'pm_card_declined') {
			status = 'declined';
			declineCode = 'insufficient_funds';
		}

		const authorization: Authorization = {
			id: `auth_${randomUUID()}`,
			idempotencyKey,
			requestHash,
			reference: body.reference,
			amountCents: body.amountCents,
			currency: body.currency,
			paymentMethod: card,
			status,
			declineCode,
			createdAt: new Date().toISOString(),
		};
		byId.set(authorization.id, authorization);
		byIdempotencyKey.set(idempotencyKey, authorization);
		return authorization;
	}

	app.get('/v1/authorizations', (req, res) => {
		const key = typeof req.query.idempotencyKey === 'string' ? req.query.idempotencyKey : '';
		const authorization = byIdempotencyKey.get(key);
		if (!authorization) {
			res.status(404).json({ error: 'not_found' });
			return;
		}
		res.json(publicView(authorization));
	});

	app.post('/v1/authorizations/:id/capture', async (req, res) => {
		const authorization = byId.get(req.params.id);
		if (!authorization) {
			res.status(404).json({ error: 'not_found' });
			return;
		}
		await sleep(Math.min(options.latencyMs, 200));
		if (authorization.status === 'captured') {
			res.json(publicView(authorization));
			return;
		}
		if (authorization.status !== 'authorized') {
			res.status(409).json({ error: `authorization_${authorization.status}` });
			return;
		}
		if (authorization.paymentMethod === 'pm_card_capture_fails') {
			res.status(402).json({ error: 'capture_declined' });
			return;
		}
		authorization.status = 'captured';
		res.json(publicView(authorization));
	});

	app.post('/v1/authorizations/:id/void', async (req, res) => {
		const authorization = byId.get(req.params.id);
		if (!authorization) {
			res.status(404).json({ error: 'not_found' });
			return;
		}
		await sleep(Math.min(options.latencyMs, 200));
		if (authorization.status === 'voided') {
			res.json(publicView(authorization));
			return;
		}
		if (authorization.status !== 'authorized') {
			res.status(409).json({ error: `authorization_${authorization.status}` });
			return;
		}
		authorization.status = 'voided';
		res.json(publicView(authorization));
	});

	app.use((_req, res) => {
		res.status(404).json({ error: 'not_found' });
	});

	return app;
}
