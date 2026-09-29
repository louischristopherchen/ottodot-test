import {
	ProviderError,
	type AuthorizeRequest,
	type AuthorizeResult,
	type PaymentProvider,
	type ProviderAuthorization,
} from './payment-provider.js';

export interface SandboxProviderOptions {
	baseUrl: string;
	apiKey: string;
	timeoutMs: number;
	/** Injectable for unit tests. */
	fetch?: typeof fetch;
}

interface SandboxAuthorization {
	id?: string;
	status?: string;
	declineCode?: string | null;
	error?: string;
}

/** HTTP client for apps/payments-sandbox. A real provider adapter would implement the same interface. */
export class SandboxPaymentProvider implements PaymentProvider {
	private readonly options: SandboxProviderOptions;
	private readonly fetchImpl: typeof fetch;

	constructor(options: SandboxProviderOptions) {
		this.options = options;
		this.fetchImpl = options.fetch ?? fetch;
	}

	private async request(
		method: 'GET' | 'POST',
		path: string,
		body?: unknown,
		idempotencyKey?: string,
	): Promise<{ status: number; body: SandboxAuthorization }> {
		let response: Response;
		try {
			response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
				method,
				headers: {
					authorization: `Bearer ${this.options.apiKey}`,
					'content-type': 'application/json',
					...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.options.timeoutMs),
			});
		} catch (error) {
			const timedOut = error instanceof Error && error.name === 'TimeoutError';
			throw new ProviderError(timedOut ? 'Payment provider timed out' : 'Payment provider unreachable', {
				transient: true,
				code: timedOut ? 'provider_timeout' : 'provider_unreachable',
			});
		}
		const parsed = (await response.json().catch(() => ({}))) as SandboxAuthorization;
		if (response.status >= 500 || response.status === 429) {
			throw new ProviderError(`Payment provider error (${response.status})`, {
				transient: true,
				code: 'provider_error',
			});
		}
		return { status: response.status, body: parsed };
	}

	private refused(action: string, status: number, body: SandboxAuthorization): ProviderError {
		return new ProviderError(`Payment provider refused the ${action} (${status})`, {
			transient: false,
			code: body.error ?? `http_${status}`,
		});
	}

	async authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
		const { status, body } = await this.request(
			'POST',
			'/v1/authorizations',
			{
				amountCents: request.amountCents,
				currency: request.currency,
				paymentMethod: request.paymentMethod,
				reference: request.reference,
			},
			request.idempotencyKey,
		);
		if (status !== 200 || !body.id) {
			throw this.refused('authorization', status, body);
		}
		return body.status === 'authorized'
			? { status: 'authorized', providerRef: body.id }
			: { status: 'declined', declineCode: body.declineCode ?? 'card_declined' };
	}

	async capture(providerRef: string): Promise<void> {
		const { status, body } = await this.request('POST', `/v1/authorizations/${encodeURIComponent(providerRef)}/capture`);
		if (status !== 200) {
			throw this.refused('capture', status, body);
		}
	}

	async voidAuthorization(providerRef: string): Promise<void> {
		const { status, body } = await this.request('POST', `/v1/authorizations/${encodeURIComponent(providerRef)}/void`);
		if (status !== 200) {
			throw this.refused('void', status, body);
		}
	}

	async findAuthorization(idempotencyKey: string): Promise<ProviderAuthorization | null> {
		const { status, body } = await this.request(
			'GET',
			`/v1/authorizations?idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
		);
		if (status === 404) {
			return null;
		}
		if (status !== 200 || !body.id) {
			throw this.refused('lookup', status, body);
		}
		return {
			providerRef: body.id,
			status: body.status as ProviderAuthorization['status'],
			declineCode: body.declineCode ?? null,
		};
	}
}
