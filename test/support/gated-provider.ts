import { MockPaymentProvider } from '../../src/payments/mock-provider.ts';
import type { AuthorizeRequest, AuthorizeResult, PaymentProvider } from '../../src/payments/provider.ts';

interface Gate {
  reached: PromiseWithResolvers<void>;
  released: PromiseWithResolvers<void>;
}

const gateKey = (bookingId: string, paymentMethod?: string) =>
  paymentMethod ? `${bookingId}|${paymentMethod}` : bookingId;

/**
 * Wraps the mock provider so a test can pause one booking's authorization
 * (optionally only the one made with a given card) mid-flight and decide
 * exactly when it returns. This turns "User A is still paying when User B
 * finishes" into a fixed sequence instead of a timing guess. Also counts
 * calls, so tests can assert that no money moved.
 */
export class GatedPaymentProvider implements PaymentProvider {
  readonly calls = { authorize: 0, capture: 0, void: 0 };
  readonly #inner = new MockPaymentProvider({ latencyMs: 0 });
  readonly #gates = new Map<string, Gate>();

  /** Authorizations for this booking (and card, if given) wait until release(). */
  hold(bookingId: string, paymentMethod?: string): void {
    this.#gates.set(gateKey(bookingId, paymentMethod), {
      reached: Promise.withResolvers<void>(),
      released: Promise.withResolvers<void>(),
    });
  }

  /** Resolves once the held authorization has reached the provider. */
  waitForAuthorization(bookingId: string, paymentMethod?: string): Promise<void> {
    return this.#gate(gateKey(bookingId, paymentMethod)).reached.promise;
  }

  release(bookingId: string, paymentMethod?: string): void {
    this.#gate(gateKey(bookingId, paymentMethod)).released.resolve();
  }

  async authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    this.calls.authorize += 1;
    const gate =
      this.#gates.get(gateKey(request.reference, request.paymentMethod)) ?? this.#gates.get(request.reference);
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

  #gate(key: string): Gate {
    const gate = this.#gates.get(key);
    if (!gate) throw new Error(`No gate for ${key}; call hold() first`);
    return gate;
  }
}
