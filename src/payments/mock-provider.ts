import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  TEST_CARDS,
  isTestCardId,
  type AuthorizeRequest,
  type AuthorizeResult,
  type PaymentProvider,
} from './provider.ts';

type AuthorizationState = 'authorized' | 'captured' | 'voided';

export interface MockPaymentProviderOptions {
  /** Simulated network and issuer latency for a normal authorization. */
  latencyMs?: number;
  /** Latency for the slow test card (pm_card_visa_slow). */
  slowLatencyMs?: number;
}

/**
 * In-memory stand-in for a card provider. Outcomes depend on the test card,
 * and state lives in this process only (a restart forgets authorizations,
 * which is fine for a demo).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly #latencyMs: number;
  readonly #slowLatencyMs: number;
  readonly #authorizations = new Map<string, AuthorizationState>();
  readonly #resultsByIdempotencyKey = new Map<string, Promise<AuthorizeResult>>();

  constructor(options: MockPaymentProviderOptions = {}) {
    this.#latencyMs = options.latencyMs ?? 800;
    this.#slowLatencyMs = options.slowLatencyMs ?? 10_000;
  }

  authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    const previous = this.#resultsByIdempotencyKey.get(request.idempotencyKey);
    if (previous) return previous;
    const result = this.#authorize(request);
    this.#resultsByIdempotencyKey.set(request.idempotencyKey, result);
    return result;
  }

  async capture(providerRef: string): Promise<void> {
    const state = this.#authorizations.get(providerRef);
    if (state === 'captured') return;
    if (state !== 'authorized') throw new Error(`Cannot capture ${providerRef} (state: ${state ?? 'unknown'})`);
    this.#authorizations.set(providerRef, 'captured');
  }

  async voidAuthorization(providerRef: string): Promise<void> {
    const state = this.#authorizations.get(providerRef);
    if (state === 'voided') return;
    if (state !== 'authorized') throw new Error(`Cannot void ${providerRef} (state: ${state ?? 'unknown'})`);
    this.#authorizations.set(providerRef, 'voided');
  }

  async #authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    if (!isTestCardId(request.paymentMethod)) {
      return { status: 'declined', failureCode: 'invalid_payment_method' };
    }
    const card = TEST_CARDS[request.paymentMethod];
    await sleep(card.behaviour === 'approve_slowly' ? this.#slowLatencyMs : this.#latencyMs);
    if (card.behaviour === 'decline') {
      return { status: 'declined', failureCode: 'insufficient_funds' };
    }
    const providerRef = `auth_${randomUUID()}`;
    this.#authorizations.set(providerRef, 'authorized');
    return { status: 'authorized', providerRef };
  }
}
