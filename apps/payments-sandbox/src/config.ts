import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// Root .env first, then an app-local one; variables already set in the process win.
for (const candidate of [path.resolve(currentDir, '../../../.env'), path.resolve(currentDir, '../.env')]) {
	if (fs.existsSync(candidate)) {
		process.loadEnvFile(candidate);
	}
}

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
	SANDBOX_PORT: z.coerce.number().int().positive().default(4002),
	// Loopback only: the sandbox is reached by the API and the worker, never by browsers.
	SANDBOX_BIND_HOST: z.string().default('127.0.0.1'),
	SANDBOX_API_KEY: z.string().min(16, 'SANDBOX_API_KEY must be at least 16 characters'),
	SANDBOX_LATENCY_MS: z.coerce.number().int().nonnegative().default(800),
	SANDBOX_SLOW_LATENCY_MS: z.coerce.number().int().nonnegative().default(10_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	console.error('Invalid payments sandbox environment:', parsed.error.flatten().fieldErrors);
	process.exit(1);
}

export const env = parsed.data;
