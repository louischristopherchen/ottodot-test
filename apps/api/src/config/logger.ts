/**
 * The single log output for application code: one JSON object per line, so the
 * lines can be shipped to any log store as they are. Values under keys that look
 * like credentials are replaced before anything is written.
 */

import { env } from './env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

export type LogLevel = Exclude<keyof typeof LEVELS, 'silent'>;

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key/i;

export function redact(value: unknown, depth = 0): unknown {
	if (value instanceof Error) {
		return { name: value.name, message: value.message, stack: value.stack };
	}
	if (value === null || typeof value !== 'object' || depth > 4) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redact(item, depth + 1));
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1),
		]),
	);
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
	if (LEVELS[level] < LEVELS[env.LOG_LEVEL]) {
		return;
	}
	const record = {
		time: new Date().toISOString(),
		level,
		msg: message,
		...(context ? (redact(context) as Record<string, unknown>) : {}),
	};
	const line = `${JSON.stringify(record)}\n`;
	if (level === 'error') {
		process.stderr.write(line);
	} else {
		process.stdout.write(line);
	}
}

export const logger = {
	debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
	info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
	warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
	error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
