import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import {
	ProviderError,
	type AuthorizeRequest,
	type AuthorizeResult,
	type PaymentProvider,
	type ProviderAuthorization,
} from '../../infra/payment-provider/index.js';

interface Gate {
	reached: PromiseWithResolvers<void>;
	released: PromiseWithResolvers<void>;
}

/** afterCapturing: the capture happens at the provider, then the answer is an error (a lost response). */
type Failure = { transient: boolean; code: string; times: number; afterCapturing?: boolean };

/**
 * In-memory provider for integration tests. It can pause one booking's authorization
 * until the test releases it, which turns "A is still paying when B finishes" into an
 * exact sequence instead of a timing guess. It also counts calls and injects failures.
 */
export class FakePaymentProvider implements PaymentProvider {
	readonly calls = { authorize: 0, capture: 0, void: 0, find: 0 };
	latencyMs = 0;
	private readonly authorizations = new Map<string, ProviderAuthorization & { key: string }>();
	private readonly gates = new Map<string, Gate>();
	private captureFailure: Failure | null = null;
	private authorizeFailure: Failure | null = null;

	/** The next authorization for this booking waits until release(). */
	hold(bookingId: string): void {
		this.gates.set(bookingId, { reached: Promise.withResolvers(), released: Promise.withResolvers() });
	}

	waitForAuthorization(bookingId: string): Promise<void> {
		return this.gate(bookingId).reached.promise;
	}

	release(bookingId: string): void {
		this.gate(bookingId).released.resolve();
	}

	failCapture(failure: Failure): void {
		this.captureFailure = failure;
	}

	failAuthorize(failure: Failure): void {
		this.authorizeFailure = failure;
	}

	/** Pretend an authorization exists (a response that was lost on the way back). */
	recordAuthorization(idempotencyKey: string, status: ProviderAuthorization['status'] = 'authorized'): string {
		const providerRef = `auth_${randomUUID()}`;
		this.authorizations.set(providerRef, { providerRef, status, declineCode: null, key: idempotencyKey });
		return providerRef;
	}

	statusOf(providerRef: string): ProviderAuthorization['status'] | undefined {
		return this.authorizations.get(providerRef)?.status;
	}

	async authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
		this.calls.authorize += 1;
		const gate = this.gates.get(request.reference);
		if (gate) {
			gate.reached.resolve();
			await gate.released.promise;
			this.gates.delete(request.reference);
		}
		if (this.latencyMs > 0) {
			await sleep(this.latencyMs);
		}
		if (this.authorizeFailure && this.authorizeFailure.times > 0) {
			this.authorizeFailure.times -= 1;
			throw new ProviderError('injected authorize failure', this.authorizeFailure);
		}
		if (request.paymentMethod === 'pm_card_declined') {
			return { status: 'declined', declineCode: 'insufficient_funds' };
		}
		const providerRef = this.recordAuthorization(request.idempotencyKey);
		return { status: 'authorized', providerRef };
	}

	async capture(providerRef: string): Promise<void> {
		this.calls.capture += 1;
		if (this.captureFailure && this.captureFailure.times > 0) {
			this.captureFailure.times -= 1;
			if (this.captureFailure.afterCapturing) {
				this.transition(providerRef, 'captured');
			}
			throw new ProviderError('injected capture failure', this.captureFailure);
		}
		this.transition(providerRef, 'captured');
	}

	async voidAuthorization(providerRef: string): Promise<void> {
		this.calls.void += 1;
		this.transition(providerRef, 'voided');
	}

	async findAuthorization(idempotencyKey: string): Promise<ProviderAuthorization | null> {
		this.calls.find += 1;
		for (const authorization of this.authorizations.values()) {
			if (authorization.key === idempotencyKey) {
				return { providerRef: authorization.providerRef, status: authorization.status, declineCode: null };
			}
		}
		return null;
	}

	private transition(providerRef: string, to: 'captured' | 'voided'): void {
		const authorization = this.authorizations.get(providerRef);
		if (!authorization) {
			throw new ProviderError('unknown authorization', { transient: false, code: 'not_found' });
		}
		if (authorization.status === to) {
			return;
		}
		if (authorization.status !== 'authorized') {
			throw new ProviderError(`cannot ${to} a ${authorization.status} authorization`, {
				transient: false,
				code: `authorization_${authorization.status}`,
			});
		}
		authorization.status = to;
	}

	private gate(bookingId: string): Gate {
		const gate = this.gates.get(bookingId);
		if (!gate) {
			throw new Error(`No gate for ${bookingId}; call hold() first`);
		}
		return gate;
	}
}
