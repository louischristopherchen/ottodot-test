import type { NextFunction, Request, Response } from 'express';

import { logger } from '../config/logger.js';

/** One access log line per request, written when the response finishes. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
	const started = process.hrtime.bigint();
	res.on('finish', () => {
		if (req.path.startsWith('/health')) {
			return;
		}
		const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
		const context = {
			requestId: req.requestId,
			method: req.method,
			// The path without the query string: queries can carry personal data.
			path: req.baseUrl + req.path,
			status: res.statusCode,
			durationMs: Math.round(durationMs * 10) / 10,
			userId: (req as Request & { user?: { id: string } }).user?.id,
		};
		if (res.statusCode >= 500) {
			logger.error('request', context);
		} else {
			logger.info('request', context);
		}
	});
	next();
}
