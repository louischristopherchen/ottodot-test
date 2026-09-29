/**
 * The slice of a card provider this app needs: the manual-capture model most
 * acquirers offer (Stripe, Adyen). Authorize holds the amount; capture takes it once
 * the seat is secured; void releases it when there is no seat, so a parent who
 * loses the last seat is never charged.
 */

export interface AuthorizeRequest {
	/** Our payment attempt id; a retry with the same key returns the same authorization. */
	idempotencyKey: string;
	/** Our booking id, stored by the provider for reconciliation. */
	reference: string;
	amountCents: number;
	currency: string;
	paymentMethod: string;
}

export type AuthorizeResult =
	| { status: 'authorized'; providerRef: string }
	| { status: 'declined'; declineCode: string };

export interface ProviderAuthorization {
	providerRef: string;
	status: 'authorized' | 'declined' | 'captured' | 'voided';
	declineCode: string | null;
}

export interface PaymentProvider {
	authorize(request: AuthorizeRequest): Promise<AuthorizeResult>;
	capture(providerRef: string): Promise<void>;
	voidAuthorization(providerRef: string): Promise<void>;
	/** Used by reconciliation when a response was lost. */
	findAuthorization(idempotencyKey: string): Promise<ProviderAuthorization | null>;
}

/**
 * transient: the outcome is unknown or the provider is briefly unavailable (timeout,
 * network error, 5xx, 429). Safe to retry with the same idempotency key.
 * permanent: the provider answered and refused; retrying will not help.
 */
export class ProviderError extends Error {
	readonly transient: boolean;
	readonly code: string;

	constructor(message: string, options: { transient: boolean; code: string }) {
		super(message);
		this.name = 'ProviderError';
		this.transient = options.transient;
		this.code = options.code;
	}
}
