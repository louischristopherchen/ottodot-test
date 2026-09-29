export const ROLES = ['parent', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const SUBJECTS = ['math', 'science'] as const;
export type Subject = (typeof SUBJECTS)[number];

/** Every trial class is capped at this many confirmed students. */
export const MAX_CLASS_CAPACITY = 4;

/**
 * pending_payment  booking created, no seat held yet
 * payment_failed   last payment attempt failed; the parent can retry
 * confirmed        seat claimed and funds authorized; the only status on the roster
 * cancelled        closed by the system; see CANCEL_REASONS
 */
export const BOOKING_STATUSES = ['pending_payment', 'payment_failed', 'confirmed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that count as a live booking: at most one per child and class. */
export const LIVE_BOOKING_STATUSES = ['pending_payment', 'payment_failed', 'confirmed'] as const;

/** Statuses a parent can pay from. */
export const PAYABLE_BOOKING_STATUSES = ['pending_payment', 'payment_failed'] as const;

/**
 * class_full       every seat was confirmed before this booking could be
 * booking_closed   the class started before payment completed
 * expired          left unpaid for too long
 */
export const CANCEL_REASONS = ['class_full', 'booking_closed', 'expired'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/**
 * processing      recorded before the provider is called
 * authorized      funds held on the card, not taken
 * declined        the provider refused the card
 * captured        money taken (seat secured)
 * voided          hold released, nothing taken
 * capture_failed  capture was refused after the seat was claimed
 */
export const PAYMENT_ATTEMPT_STATUSES = [
	'processing',
	'authorized',
	'declined',
	'captured',
	'voided',
	'capture_failed',
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

/** What a payment request ended in. Returned with HTTP 200: the request itself succeeded. */
export const PAYMENT_OUTCOMES = [
	'confirmed',
	'payment_declined',
	'class_full',
	'booking_closed',
	'already_confirmed',
] as const;
export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

export const PAYMENT_JOB_KINDS = ['capture', 'void'] as const;
export type PaymentJobKind = (typeof PAYMENT_JOB_KINDS)[number];

export const PAYMENT_JOB_STATUSES = ['pending', 'done', 'failed'] as const;
export type PaymentJobStatus = (typeof PAYMENT_JOB_STATUSES)[number];

export interface TestCard {
	label: string;
	description: string;
}

/** Cards understood by the payments sandbox. Nothing else is accepted. */
export const TEST_CARDS = {
	pm_card_visa: {
		label: 'Visa ending 4242',
		description: 'Approves.',
	},
	pm_card_visa_slow: {
		label: 'Visa ending 1881',
		description: 'Approves after about 10 seconds. Use it to race another parent for the last seat.',
	},
	pm_card_declined: {
		label: 'Visa ending 0002',
		description: 'Declined: insufficient funds.',
	},
	pm_card_capture_fails: {
		label: 'Visa ending 0341',
		description: 'Approves, then the capture is refused. The seat is released and the hold voided.',
	},
} as const satisfies Record<string, TestCard>;

export type TestCardId = keyof typeof TEST_CARDS;
export const TEST_CARD_IDS = Object.keys(TEST_CARDS) as [TestCardId, ...TestCardId[]];

/** Error code to HTTP status. `ApiError.of(code)` reads this, so a code cannot be sent with the wrong status. */
export const ERROR_STATUS = {
	VALIDATION_ERROR: 400,
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	INVALID_CREDENTIALS: 401,
	TOKEN_EXPIRED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	ALREADY_BOOKED: 409,
	CLASS_FULL: 409,
	BOOKING_CLOSED: 409,
	NOT_PAYABLE: 409,
	REQUEST_IN_PROGRESS: 409,
	PAYLOAD_TOO_LARGE: 413,
	IDEMPOTENCY_KEY_REUSED: 422,
	ACCOUNT_LOCKED: 429,
	RATE_LIMITED: 429,
	INTERNAL_ERROR: 500,
	PAYMENT_PROVIDER_UNAVAILABLE: 502,
	SERVICE_UNAVAILABLE: 503,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;

/** Header a client sends so a retried payment request is not processed twice. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
