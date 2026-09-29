import { env } from '../../config/env.js';
import type { PaymentProvider } from './payment-provider.js';
import { SandboxPaymentProvider } from './sandbox-provider.js';

export * from './payment-provider.js';
export { SandboxPaymentProvider } from './sandbox-provider.js';

let provider: PaymentProvider = new SandboxPaymentProvider({
	baseUrl: env.PAYMENT_PROVIDER_URL,
	apiKey: env.PAYMENT_PROVIDER_API_KEY,
	timeoutMs: env.PAYMENT_PROVIDER_TIMEOUT_MS,
});

export function paymentProvider(): PaymentProvider {
	return provider;
}

/** Test seam: integration tests install a provider they can pause and inspect. */
export function setPaymentProvider(next: PaymentProvider): void {
	provider = next;
}
