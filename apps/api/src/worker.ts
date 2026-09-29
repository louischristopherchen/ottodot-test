import { setTimeout as sleep } from 'node:timers/promises';

import { closeDatabase, connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { installProcessGuards } from './config/process-guards.js';
import { runJobsOnce } from './jobs/run-jobs.js';

// Background worker (its own PM2 process): payment job retries, reconciliation,
// expiry of unpaid bookings and housekeeping, every WORKER_INTERVAL_MS.

await connectDatabase();
logger.info('Worker started', { intervalMs: env.WORKER_INTERVAL_MS });

let stopping = false;
// Wakes the loop from its sleep so a shutdown does not wait out the interval.
const wake = new AbortController();
let stopped: () => void = () => undefined;
const loopFinished = new Promise<void>((resolve) => {
	stopped = resolve;
});

installProcessGuards({
	shutdown: async (signal, exitCode = 0) => {
		if (stopping) {
			return;
		}
		stopping = true;
		wake.abort();
		logger.info('Stopping worker after the current pass', { signal });
		setTimeout(() => process.exit(1), 30_000).unref();
		await loopFinished;
		await closeDatabase().catch(() => undefined);
		process.exit(exitCode);
	},
});

while (!stopping) {
	await runJobsOnce();
	await sleep(env.WORKER_INTERVAL_MS, undefined, { signal: wake.signal }).catch(() => undefined);
}
stopped();
