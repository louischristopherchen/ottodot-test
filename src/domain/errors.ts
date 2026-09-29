export type ErrorCode =
  | 'validation_error'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'already_booked'
  | 'class_full'
  | 'booking_closed'
  | 'not_payable';

const HTTP_STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  already_booked: 409,
  class_full: 409,
  booking_closed: 409,
  not_payable: 409,
};

/** An expected, user-facing failure. Anything else is a bug and becomes a 500. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}
