import type {
	BookingStatus,
	CancelReason,
	PaymentAttemptStatus,
	PaymentOutcome,
	Role,
	Subject,
} from '@trial-booking/shared';

export const APP_TIME_ZONE = 'Asia/Singapore';

/** Same names as the badge and alert variants in @trial-booking/ui. */
export type Tone = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

export interface Label {
	text: string;
	tone: Tone;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string): Intl.NumberFormat {
	let formatter = moneyFormatters.get(currency);
	if (!formatter) {
		formatter = new Intl.NumberFormat('en-SG', { style: 'currency', currency, currencyDisplay: 'code' });
		moneyFormatters.set(currency, formatter);
	}
	return formatter;
}

/** 2000, 'SGD' becomes 'SGD 20.00'. Amounts arrive in the currency's minor unit. */
export function formatMoney(amountMinor: number, currency: string): string {
	const formatter = moneyFormatter(currency.toUpperCase());
	const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
	// Intl separates the code with a no-break space; a plain space matches the copy in the design.
	return formatter.format(amountMinor / 10 ** fractionDigits).replace(/\s/g, ' ');
}

// en-US parts assembled by hand: en-SG and en-GB abbreviate September as "Sept".
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: APP_TIME_ZONE,
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	hour: 'numeric',
	minute: '2-digit',
	hour12: true,
});

/** '2026-10-01T09:00:00Z' becomes 'Thu 1 Oct, 5:00 pm SGT'. */
export function formatSgtDateTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
	for (const part of dateTimeFormatter.formatToParts(date)) {
		parts[part.type] = part.value;
	}
	const period = (parts.dayPeriod ?? '').toLowerCase();
	return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${period} SGT`;
}

export function levelLabel(level: number): string {
	return `P${level}`;
}

const SUBJECT_LABELS: Record<Subject, string> = {
	math: 'Math',
	science: 'Science',
};

export function subjectLabel(subject: Subject): string {
	return SUBJECT_LABELS[subject] ?? subject;
}

const ROLE_LABELS: Record<Role, string> = {
	parent: 'Parent',
	staff: 'Staff',
};

export function roleLabel(role: Role): string {
	return ROLE_LABELS[role] ?? role;
}

const CANCELLED_LABELS: Record<CancelReason, string> = {
	class_full: 'Cancelled (class full)',
	booking_closed: 'Cancelled (class started)',
	expired: 'Cancelled (expired)',
};

export function bookingStatusLabel(status: BookingStatus, cancelReason: CancelReason | null): Label {
	switch (status) {
		case 'pending_payment':
			return { text: 'Pending payment', tone: 'warning' };
		case 'payment_failed':
			return { text: 'Payment failed', tone: 'destructive' };
		case 'confirmed':
			return { text: 'Confirmed', tone: 'success' };
		case 'cancelled':
			return { text: cancelReason ? CANCELLED_LABELS[cancelReason] : 'Cancelled', tone: 'secondary' };
		default:
			return { text: String(status), tone: 'secondary' };
	}
}

const DECLINE_REASONS: Record<string, string> = {
	insufficient_funds: 'insufficient funds',
};

/** Text for the Payment column, from the latest attempt. `null` means nobody has tried to pay yet. */
export function paymentStatusText(status: PaymentAttemptStatus | null, failureCode: string | null): string {
	switch (status) {
		case null:
			return 'None yet';
		case 'processing':
			return 'Processing';
		case 'authorized':
			return 'Authorized';
		case 'declined': {
			if (!failureCode) {
				return 'Declined';
			}
			return `Declined (${DECLINE_REASONS[failureCode] ?? failureCode.replace(/_/g, ' ')})`;
		}
		case 'captured':
			return 'Paid';
		case 'voided':
			return 'Not charged (hold released)';
		case 'capture_failed':
			return 'Capture failed';
		default:
			return String(status);
	}
}

export function seatsLabel(seatsLeft: number, capacity: number): Label {
	if (seatsLeft <= 0) {
		return { text: 'Full', tone: 'secondary' };
	}
	if (seatsLeft === 1) {
		return { text: 'Last seat', tone: 'warning' };
	}
	return { text: `${seatsLeft} of ${capacity} seats left`, tone: 'success' };
}

export function paymentOutcomeTone(outcome: PaymentOutcome): 'default' | 'success' | 'destructive' {
	switch (outcome) {
		case 'confirmed':
			return 'success';
		case 'payment_declined':
		case 'class_full':
		case 'booking_closed':
			return 'destructive';
		default:
			return 'default';
	}
}

/** '3 of 4' */
export function confirmedOfCapacity(confirmed: number, capacity: number): string {
	return `${confirmed} of ${capacity}`;
}
