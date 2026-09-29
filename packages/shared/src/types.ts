import type {
	BookingStatus,
	CancelReason,
	ErrorCode,
	PaymentAttemptStatus,
	PaymentOutcome,
	Role,
	Subject,
} from './constants.js';

// Response shapes of the HTTP API. Dates are ISO 8601 strings in UTC.

export interface ApiSuccess<T> {
	success: true;
	data: T;
}

export interface ApiFailure {
	success: false;
	error: {
		code: ErrorCode;
		message: string;
		details?: Record<string, string[]>;
	};
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface UserDto {
	id: string;
	email: string;
	name: string;
	role: Role;
}

export interface SessionDto {
	/** Short-lived bearer token. The refresh token travels in an httpOnly cookie only. */
	accessToken: string;
	/** Seconds until the access token expires. */
	expiresIn: number;
	user: UserDto;
}

export interface StudentDto {
	id: string;
	name: string;
	/** Primary 1 to 6. */
	level: number;
}

export interface TrialClassDto {
	id: string;
	subject: Subject;
	title: string;
	teacherName: string;
	startsAt: string;
	durationMinutes: number;
	capacity: number;
	confirmedCount: number;
	seatsLeft: number;
	priceCents: number;
	currency: string;
}

export interface PaymentAttemptDto {
	id: string;
	status: PaymentAttemptStatus;
	amountCents: number;
	currency: string;
	paymentMethod: string;
	failureCode: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface BookingDto {
	id: string;
	status: BookingStatus;
	cancelReason: CancelReason | null;
	createdAt: string;
	updatedAt: string;
	confirmedAt: string | null;
	student: { id: string; name: string };
	trialClass: {
		id: string;
		title: string;
		subject: Subject;
		startsAt: string;
		priceCents: number;
		currency: string;
	};
	/** Oldest first. */
	paymentAttempts: PaymentAttemptDto[];
}

export interface CreateBookingResultDto {
	booking: BookingDto;
	/** False when the child's existing unpaid booking for this class was returned instead. */
	created: boolean;
}

export interface PaymentResultDto {
	outcome: PaymentOutcome;
	message: string;
	booking: BookingDto;
	/** Null when the booking was refused before the payment provider was contacted. */
	paymentAttempt: PaymentAttemptDto | null;
}

export interface RosterEntryDto {
	bookingId: string;
	studentName: string;
	level: number;
	parentName: string;
	parentEmail: string;
	confirmedAt: string;
	paymentStatus: PaymentAttemptStatus | null;
}

export interface NotOnRosterEntryDto {
	bookingId: string;
	studentName: string;
	parentName: string;
	status: Exclude<BookingStatus, 'confirmed'>;
	cancelReason: CancelReason | null;
	lastPaymentStatus: PaymentAttemptStatus | null;
	lastPaymentFailureCode: string | null;
	updatedAt: string;
}

export interface RosterDto {
	trialClass: TrialClassDto;
	/** Confirmed bookings only: the list a teacher needs. */
	confirmed: RosterEntryDto[];
	/** Every other booking for the class, shown to staff for context. */
	notOnRoster: NotOnRosterEntryDto[];
}
