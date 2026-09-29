/**
 * How a process is allowed to stop. Shared by the API and the worker.
 *
 * SIGTERM/SIGINT     clean shutdown, exit 0 (PM2 reload and deploys)
 * uncaughtException  log with the stack, then the same clean shutdown, exit 1
 * unhandledRejection log loudly and keep serving
 */

import { logger } from './logger.js';

export type ShutdownFn = (signal: string, exitCode?: number) => Promise<void>;

export interface ProcessGuardOptions {
	shutdown: ShutdownFn;
	/** Overridable so a test can assert without stopping the test runner. */
	process?: NodeJS.EventEmitter;
}

export function installProcessGuards(options: ProcessGuardOptions): void {
	const target = options.process ?? process;
	const { shutdown } = options;

	target.on('SIGTERM', () => void shutdown('SIGTERM'));
	target.on('SIGINT', () => void shutdown('SIGINT'));

	target.on('uncaughtException', (error: Error, origin: string) => {
		logger.error('Uncaught exception, shutting down', { origin, error });
		void shutdown('uncaughtException', 1);
	});

	target.on('unhandledRejection', (reason: unknown) => {
		logger.error('Unhandled promise rejection', { error: reason });
	});
}
