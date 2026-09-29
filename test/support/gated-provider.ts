import { MockPaymentProvider } from '../../src/payments/mock-provider.ts';
import type { AuthorizeRequest, AuthorizeResult, PaymentProvider } from '../../src/payments/provider.ts';

interface Gate {
  reached: PromiseWithResolvers<void>;
  released: PromiseWithResolvers<void>;
}

/**
 * Wraps the mock provider so a test can pause one booking's authorization
 * mid-flight and decide exactly when it returns. This turns "User A is still
 * paying when User B finishes" into a fixed sequence instead of a timing guess.
 * Also counts calls, so tests can assert that no money moved.
 */
export class GatedPaymentProvider implements PaymentProvider {
  readonly calls = { authorize: 0, capture: 0, void: 0 };
  readonly #inner = new MockPaymentProvider({ latencyMs: 0 });
  readonly #gates = new Map<string, Gate>();

  /** The next authorization for this booking waits until release(bookingId). */
  hold(bookingId: string): void {
    this.#gates.set(bookingId, {
      reached: Promise.withResolvers<void>(),
      released: Promise.withResolvers<void>(),
    });
  }

  /** Resolves once the held authorization has reached the provider. */
  waitForAuthorization(bookingId: string): Promise<void> {
    return this.#gate(bookingId).reached.promise;
  }

  release(bookingId: string): void {
    this.#gate(bookingId).released.resolve();
  }

  async authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    this.calls.authorize += 1;
    const gate = this.#gates.get(request.reference);
    if (gate) {
      gate.reached.resolve();
      await gate.released.promise;
    }
    return this.#inner.authorize(request);
  }

  capture(providerRef: string): Promise<void> {
    this.calls.capture += 1;
    return this.#inner.capture(providerRef);
  }

  voidAuthorization(providerRef: string): Promise<void> {
    this.calls.void += 1;
    return this.#inner.voidAuthorization(providerRef);
  }

  #gate(bookingId: string): Gate {
    const gate = this.#gates.get(bookingId);
    if (!gate) throw new Error(`No gate for ${bookingId}; call hold() first`);
    return gate;
  }
}
