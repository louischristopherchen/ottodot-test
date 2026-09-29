import type {
	ApiResponse,
	BookingDto,
	CreateBookingInput,
	CreateBookingResultDto,
	ErrorCode,
	LoginInput,
	PayBookingInput,
	PaymentResultDto,
	RosterDto,
	SessionDto,
	StudentDto,
	TrialClassDto,
	UserDto,
} from '@trial-booking/shared';
import { IDEMPOTENCY_HEADER } from '@trial-booking/shared/constants';

import { sessionStore, type SessionEndReason } from '../stores/session';

/** Codes from the API, plus two the client raises itself. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'BAD_RESPONSE';

export interface ApiErrorInit {
	code: ClientErrorCode;
	message: string;
	/** HTTP status; 0 when the server was never reached. */
	status: number;
	details?: Record<string, string[]>;
}

export class ApiError extends Error {
	readonly code: ClientErrorCode;
	readonly status: number;
	readonly details: Record<string, string[]> | undefined;

	constructor(init: ApiErrorInit) {
		super(init.message);
		this.name = 'ApiError';
		this.code = init.code;
		this.status = init.status;
		this.details = init.details;
	}

	/** First validation message for a field, if the API sent one. */
	fieldError(field: string): string | undefined {
		return this.details?.[field]?.[0];
	}
}

export function isApiError(error: unknown): error is ApiError {
	return error instanceof ApiError;
}

/** The API's own sentence when there is one, so the parent sees exactly what the server decided. */
export function errorMessage(error: unknown): string {
	return isApiError(error) ? error.message : 'Something went wrong. Try again.';
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
	fetch?: FetchLike;
	baseUrl?: string;
	getAccessToken: () => string | null;
	onSession: (session: SessionDto) => void;
	onSessionEnd: (reason: SessionEndReason) => void;
}

export interface RequestOptions {
	method?: 'GET' | 'POST';
	body?: unknown;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	/** Auth routes answer 401 for their own reasons, so they must not trigger a refresh. */
	refreshOnUnauthorized?: boolean;
}

const REFRESHABLE_CODES: ReadonlySet<ClientErrorCode> = new Set<ClientErrorCode>(['TOKEN_EXPIRED', 'UNAUTHORIZED']);

function isEnvelope(payload: unknown): payload is ApiResponse<unknown> {
	if (typeof payload !== 'object' || payload === null || !('success' in payload)) {
		return false;
	}
	if (payload.success === true) {
		return 'data' in payload;
	}
	if (payload.success === false && 'error' in payload) {
		const { error } = payload;
		return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
	}
	return false;
}

export function createApi(options: ApiClientOptions) {
	const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
	const baseUrl = options.baseUrl ?? '';
	let refreshing: Promise<SessionDto> | null = null;

	async function parse<T>(response: Response, signal: AbortSignal | undefined): Promise<T> {
		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			if (signal?.aborted) {
				throw error;
			}
		}
		if (isEnvelope(payload)) {
			if (payload.success) {
				return payload.data as T;
			}
			throw new ApiError({
				code: payload.error.code,
				message: payload.error.message,
				status: response.status,
				details: payload.error.details,
			});
		}
		if (response.status >= 500) {
			throw new ApiError({
				code: 'SERVICE_UNAVAILABLE',
				message: 'The service is unavailable right now. Try again in a moment.',
				status: response.status,
			});
		}
		throw new ApiError({
			code: 'BAD_RESPONSE',
			message: 'The server sent a response this page could not read.',
			status: response.status,
		});
	}

	async function send<T>(
		path: string,
		method: string,
		headers: Record<string, string>,
		body: string | undefined,
		signal: AbortSignal | undefined,
	): Promise<T> {
		let response: Response;
		try {
			response = await doFetch(`${baseUrl}${path}`, { method, headers, body, signal, credentials: 'same-origin' });
		} catch (error) {
			// Let TanStack Query see its own cancellations as cancellations.
			if (signal?.aborted) {
				throw error;
			}
			throw new ApiError({
				code: 'NETWORK_ERROR',
				message: 'Could not reach the server. Check your connection and try again.',
				status: 0,
			});
		}
		return parse<T>(response, signal);
	}

	/** Concurrent callers share one refresh: the refresh token rotates, so a second call would fail. */
	function refreshSession(): Promise<SessionDto> {
		refreshing ??= (async () => {
			try {
				const session = await send<SessionDto>(
					'/api/auth/refresh',
					'POST',
					{ Accept: 'application/json' },
					undefined,
					undefined,
				);
				options.onSession(session);
				return session;
			} catch (error) {
				// Only a refusal from the server ends the session; a dropped connection proves nothing.
				if (isApiError(error) && (error.status === 401 || error.status === 403)) {
					options.onSessionEnd('expired');
				}
				throw error;
			} finally {
				refreshing = null;
			}
		})();
		return refreshing;
	}

	async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
		const method = init.method ?? 'GET';
		const body = init.body === undefined ? undefined : JSON.stringify(init.body);
		const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
		if (body !== undefined) {
			headers['Content-Type'] = 'application/json';
		}
		const token = options.getAccessToken();
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}

		try {
			return await send<T>(path, method, headers, body, init.signal);
		} catch (error) {
			const canRefresh =
				(init.refreshOnUnauthorized ?? true) &&
				isApiError(error) &&
				error.status === 401 &&
				REFRESHABLE_CODES.has(error.code);
			if (!canRefresh) {
				throw error;
			}
			// If another request already refreshed while this one was in flight, its token is
			// newer than the one this request used: retry with it instead of rotating again.
			const current = options.getAccessToken();
			const accessToken = current && current !== token ? current : (await refreshSession()).accessToken;
			// Same headers (Idempotency-Key included) so the server treats it as the same request.
			return send<T>(path, method, { ...headers, Authorization: `Bearer ${accessToken}` }, body, init.signal);
		}
	}

	return {
		request,
		refreshSession,

		async login(input: LoginInput): Promise<SessionDto> {
			const session = await request<SessionDto>('/api/auth/login', {
				method: 'POST',
				body: input,
				refreshOnUnauthorized: false,
			});
			options.onSession(session);
			return session;
		},

		/** Never throws: the local session ends even if the server cannot be reached. */
		async logout(): Promise<void> {
			try {
				await request<{ loggedOut: true }>('/api/auth/logout', { method: 'POST', refreshOnUnauthorized: false });
			} catch {
				// The refresh cookie may survive; the next page load will ask the server again.
			}
			options.onSessionEnd('signed_out');
		},

		me: (signal?: AbortSignal) => request<UserDto>('/api/auth/me', { signal }),

		listStudents: (signal?: AbortSignal) => request<StudentDto[]>('/api/students', { signal }),

		listTrialClasses: (signal?: AbortSignal) => request<TrialClassDto[]>('/api/trial-classes', { signal }),

		listBookings: (signal?: AbortSignal) => request<BookingDto[]>('/api/bookings', { signal }),

		getBooking: (id: string, signal?: AbortSignal) =>
			request<BookingDto>(`/api/bookings/${encodeURIComponent(id)}`, { signal }),

		createBooking: (input: CreateBookingInput) =>
			request<CreateBookingResultDto>('/api/bookings', { method: 'POST', body: input }),

		payBooking: (id: string, input: PayBookingInput, idempotencyKey: string) =>
			request<PaymentResultDto>(`/api/bookings/${encodeURIComponent(id)}/payments`, {
				method: 'POST',
				body: input,
				headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
			}),

		getRoster: (trialClassId: string, signal?: AbortSignal) =>
			request<RosterDto>(`/api/staff/trial-classes/${encodeURIComponent(trialClassId)}/roster`, { signal }),
	};
}

export type Api = ReturnType<typeof createApi>;

export const api = createApi({
	getAccessToken: () => sessionStore.getState().accessToken,
	onSession: (session) => sessionStore.getState().signIn(session),
	onSessionEnd: (reason) => sessionStore.getState().signOut(reason),
});

/** Called once at startup: the httpOnly refresh cookie is the only way to know who is signed in. */
export async function restoreSession(client: Api = api): Promise<void> {
	try {
		await client.refreshSession();
	} catch {
		if (sessionStore.getState().status === 'unknown') {
			sessionStore.getState().signOut('expired');
		}
	}
}
