import { z } from 'zod';

import { TEST_CARD_IDS } from './constants.js';

// Request schemas shared by the API (validation) and the web app (forms).

export const loginSchema = z.object({
	email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
	password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createBookingSchema = z.object({
	studentId: z.string().uuid(),
	trialClassId: z.string().uuid(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const payBookingSchema = z.object({
	paymentMethod: z.enum(TEST_CARD_IDS),
});
export type PayBookingInput = z.infer<typeof payBookingSchema>;

export const uuidParamSchema = z.object({
	id: z.string().uuid(),
});

/** Client-chosen key, echoed back on retries. Printable ASCII, bounded length. */
export const idempotencyKeySchema = z
	.string()
	.min(8)
	.max(100)
	.regex(/^[\x21-\x7e]+$/, 'Idempotency-Key must be printable ASCII');
