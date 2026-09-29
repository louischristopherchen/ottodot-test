import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
	interface Request {
		/** Correlates a request with its log lines and any payment job it creates. */
		requestId: string;
	}
}

// A client-supplied X-Request-Id is accepted only if it is a UUID, so it cannot inject into logs.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestId(req: Request, res: Response, next: NextFunction): void {
	const supplied = req.get('x-request-id');
	req.requestId = supplied && UUID_PATTERN.test(supplied) ? supplied.toLowerCase() : randomUUID();
	res.setHeader('X-Request-Id', req.requestId);
	next();
}
