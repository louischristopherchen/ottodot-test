import type { Db } from '../db/database.ts';
import type { PaymentProvider } from '../payments/provider.ts';

/**
 * pending_payment  booking created, no seat held yet
 * payment_failed   last payment attempt declined; the parent can retry
 * confirmed        paid and holding a seat; the only status on the roster
 * cancelled        closed by the system; see cancel_reason
 */
export type BookingStatus = 'pending_payment' | 'payment_failed' | 'confirmed' | 'cancelled';

/**
 * class_full       every seat was confirmed before this booking could be
 *                  (this is how the loser of the last-seat race ends up)
 * booking_closed   the class started before payment completed
 */
export type CancelReason = 'class_full' | 'booking_closed';

export type PaymentAttemptStatus =
  | 'processing'
  | 'authorized'
  | 'declined'
  | 'captured'
  | 'voided'
  | 'capture_failed';

export interface Deps {
  db: Db;
  payments: PaymentProvider;
  now: () => Date;
}

export interface TrialClass {
  id: string;
  subject: 'math' | 'science';
  title: string;
  teacherName: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  priceCents: number;
  currency: string;
  confirmedCount: number;
  seatsLeft: number;
}

export interface PaymentAttempt {
  id: string;
  status: PaymentAttemptStatus;
  amountCents: number;
  currency: string;
  paymentMethod: string;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Booking {
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
    subject: string;
    startsAt: string;
    priceCents: number;
    currency: string;
  };
  /** Oldest first. */
  paymentAttempts: PaymentAttempt[];
}

export interface RosterEntry {
  bookingId: string;
  studentId: string;
  studentName: string;
  level: number;
  parentName: string;
  parentEmail: string;
  confirmedAt: string;
}

export interface NotOnRosterEntry {
  bookingId: string;
  studentName: string;
  parentName: string;
  status: Exclude<BookingStatus, 'confirmed'>;
  cancelReason: CancelReason | null;
  lastPaymentStatus: PaymentAttemptStatus | null;
  lastPaymentFailureCode: string | null;
  updatedAt: string;
}

export interface Roster {
  trialClass: TrialClass;
  /** Confirmed bookings only: the list a teacher needs. */
  confirmed: RosterEntry[];
  /** Every other booking for the class, shown to staff for context. */
  notOnRoster: NotOnRosterEntry[];
}

export interface Family {
  id: string;
  name: string;
  email: string;
  children: { id: string; name: string; level: number }[];
}
