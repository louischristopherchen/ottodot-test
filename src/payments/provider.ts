/**
 * The slice of a card payment provider this app needs. It mirrors the
 * authorize / capture / void model that Stripe (manual capture), Adyen and
 * most card acquirers support:
 *   authorize: reserve the amount on the card; no money moves yet.
 *   capture:   take the reserved amount. Called only after a seat is secured.
 *   void:      release the reservation. Called when the seat is gone, so a
 *              parent who loses the last-seat race is never charged.
 */
export interface PaymentProvider {
  authorize(request: AuthorizeRequest): Promise<AuthorizeResult>;
  capture(providerRef: string): Promise<void>;
  voidAuthorization(providerRef: string): Promise<void>;
}

export interface AuthorizeRequest {
  /** Our payment attempt id. Retrying with the same key returns the same result. */
  idempotencyKey: string;
  /** Our booking id, stored by the provider for reconciliation. */
  reference: string;
  amountCents: number;
  currency: string;
  paymentMethod: string;
}

export type AuthorizeResult =
  | { status: 'authorized'; providerRef: string }
  | { status: 'declined'; failureCode: string };

/** Test cards understood by the mock provider (in the spirit of Stripe's test cards). */
export const TEST_CARDS = {
  pm_card_visa: {
    label: 'Visa ending 4242',
    behaviour: 'approve',
    description: 'Approves.',
  },
  pm_card_visa_slow: {
    label: 'Visa ending 1881',
    behaviour: 'approve_slowly',
    description: 'Approves after a 6 second delay. Use it to race another parent for the last seat.',
  },
  pm_card_declined: {
    label: 'Visa ending 0002',
    behaviour: 'decline',
    description: 'Declined: insufficient funds.',
  },
} as const;

export type TestCardId = keyof typeof TEST_CARDS;

export const TEST_CARD_IDS = Object.keys(TEST_CARDS) as [TestCardId, ...TestCardId[]];

export function isTestCardId(value: string): value is TestCardId {
  return Object.hasOwn(TEST_CARDS, value);
}
