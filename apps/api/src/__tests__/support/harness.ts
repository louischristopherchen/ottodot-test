import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../app.js';
import { sequelize } from '../../config/database.js';
import { setPaymentProvider } from '../../infra/payment-provider/index.js';
import { DEMO_PASSWORD, resetDatabase, seedDemoData, type SeedIds } from '../../scripts/seed.js';
import { FakePaymentProvider } from './fake-provider.js';

// Tests read whatever response fields they assert on; a loose default keeps them readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ApiResponse<T = any> {
	status: number;
	body: { success: boolean; data: T; error: { code: string; message: string; details?: Record<string, string[]> } };
	headers: Headers;
}

export interface Harness {
	ids: SeedIds;
	provider: FakePaymentProvider;
	baseUrl: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	request<T = any>(
		method: string,
		path: string,
		options?: { token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> },
	): Promise<ApiResponse<T>>;
	login(email: string): Promise<string>;
	/** Access tokens for the seeded parents and staff, by seed key. */
	tokens: Record<string, string>;
	close(): Promise<void>;
}

export const ORIGIN = 'http://localhost:4000';

const TOKEN_ACCOUNTS = {
	aisha: 'aisha.rahman@example.com',
	ben: 'ben.carter@example.com',
	chloe: 'chloe.tan@example.com',
	farah: 'farah.hassan@example.com',
	staff: 'staff@example.com',
} as const;

/**
 * Fresh seeded database, a fake payment provider and the real Express app on an
 * ephemeral port. Integration test files run one at a time against the test database.
 */
export async function startHarness(): Promise<Harness> {
	await resetDatabase();
	const ids = await seedDemoData();
	const provider = new FakePaymentProvider();
	setPaymentProvider(provider);

	const server: Server = createApp().listen(0, '127.0.0.1');
	await once(server, 'listening');
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	const request: Harness['request'] = async (method, path, options = {}) => {
		const headers: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN, ...options.headers };
		if (options.token) {
			headers.authorization = `Bearer ${options.token}`;
		}
		const response = await fetch(baseUrl + path, {
			method,
			headers,
			body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
		});
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : {}, headers: response.headers };
	};

	const login = async (email: string): Promise<string> => {
		const response = await request('POST', '/api/auth/login', { body: { email, password: DEMO_PASSWORD } });
		if (response.status !== 200) {
			throw new Error(`login failed for ${email}: ${response.status}`);
		}
		return response.body.data.accessToken;
	};

	const tokens: Record<string, string> = {};
	for (const [key, email] of Object.entries(TOKEN_ACCOUNTS)) {
		tokens[key] = await login(email);
	}

	return {
		ids,
		provider,
		baseUrl,
		request,
		login,
		tokens,
		async close() {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

/** Call once per test file, in an `after` hook. */
export async function closePool(): Promise<void> {
	await sequelize.close();
}

export async function confirmedCount(trialClassId: string): Promise<number> {
	const [rows] = await sequelize.query('SELECT confirmed_count FROM trial_classes WHERE id = :id', {
		replacements: { id: trialClassId },
	});
	return Number((rows as { confirmed_count: number }[])[0]?.confirmed_count);
}

export async function attemptStatuses(bookingId: string): Promise<string[]> {
	const [rows] = await sequelize.query(
		'SELECT status FROM payment_attempts WHERE booking_id = :id ORDER BY created_at, id',
		{ replacements: { id: bookingId } },
	);
	return (rows as { status: string }[]).map((row) => row.status);
}
