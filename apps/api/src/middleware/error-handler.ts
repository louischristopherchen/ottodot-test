import { ERROR_STATUS, type ErrorCode } from '@trial-booking/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { logger } from '../config/logger.js';

/**
 * The one error type feature code throws. `ApiError.of()` takes the status from the
 * shared code-to-status table, so a code cannot be sent with the wrong status.
 */
export class ApiError extends Error {
	statusCode: number;
	code: ErrorCode;
	details?: Record<string, string[]>;

	constructor(statusCode: number, code: ErrorCode, message: string, details?: Record<string, string[]>) {
		super(message);
		this.name = 'ApiError';
		this.statusCode = statusCode;
		this.code = code;
		this.details = details;
	}

	static of(code: ErrorCode, message: string, details?: Record<string, string[]>): ApiError {
		return new ApiError(ERROR_STATUS[code], code, message, details);
	}

	static badRequest(message: string): ApiError {
		return ApiError.of('BAD_REQUEST', message);
	}

	static unauthorized(message = 'Sign in to continue'): ApiError {
		return ApiError.of('UNAUTHORIZED', message);
	}

	static forbidden(message = 'You do not have access to this'): ApiError {
		return ApiError.of('FORBIDDEN', message);
	}

	static notFound(message = 'Not found'): ApiError {
		return ApiError.of('NOT_FOUND', message);
	}
}

export function zodDetails(error: ZodError): Record<string, string[]> {
	const details: Record<string, string[]> = {};
	for (const issue of error.issues) {
		const key = issue.path.join('.') || 'body';
		details[key] = [...(details[key] ?? []), issue.message];
	}
	return details;
}

/** Errors raised by express.json(): they carry a 4xx status and a `type`. */
function bodyParserError(error: unknown): { status: number; type?: string } | null {
	if (typeof error !== 'object' || error === null) {
		return null;
	}
	const { status, type, expose } = error as { status?: unknown; type?: unknown; expose?: unknown };
	if (typeof status === 'number' && status >= 400 && status < 500 && expose === true) {
		return { status, type: typeof type === 'string' ? type : undefined };
	}
	return null;
}

function send(res: Response, status: number, code: ErrorCode, message: string, details?: Record<string, string[]>) {
	res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
	if (error instanceof ZodError) {
		// Field paths and rules only, never the rejected values.
		send(res, 400, 'VALIDATION_ERROR', 'Request validation failed', zodDetails(error));
		return;
	}

	if (error instanceof ApiError) {
		send(res, error.statusCode, error.code, error.message, error.details);
		return;
	}

	const parserError = bodyParserError(error);
	if (parserError) {
		if (parserError.type === 'entity.too.large') {
			send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
		} else if (parserError.type === 'entity.parse.failed') {
			send(res, 400, 'VALIDATION_ERROR', 'Request body is not valid JSON');
		} else {
			send(res, parserError.status, 'BAD_REQUEST', 'Bad request');
		}
		return;
	}

	logger.error('Unhandled error', {
		method: req.method,
		path: req.originalUrl,
		requestId: req.requestId,
		error,
	});
	const message = process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : 'Something went wrong';
	send(res, 500, 'INTERNAL_ERROR', message);
}

export function notFoundHandler(_req: Request, res: Response): void {
	send(res, 404, 'NOT_FOUND', 'No such endpoint');
}
