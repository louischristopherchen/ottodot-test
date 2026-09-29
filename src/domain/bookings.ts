import { randomUUID } from 'node:crypto';
import { withWriteLock, type Db } from '../db/database.ts';
import { execute, queryOne } from '../db/sql.ts';
import type { AuthorizeRequest, AuthorizeResult, PaymentProvider } from '../payments/provider.ts';
import { AppError } from './errors.ts';
import { findTrialClass, getBooking, getBookingForParent } from './queries.ts';
import type { Booking, BookingStatus, CancelReason, Deps, PaymentAttempt, PaymentAttemptStatus } from './types.ts';

// Booking lifecycle
//
//   pending_payment --declined-------------------------> payment_failed --retry--> (as pending_payment)
//   pending_payment --authorized + seat claimed--------> confirmed
//   pending_payment --class full or started------------> cancelled (class_full | booking_closed)
//   confirmed       --capture failed (rare)------------> payment_failed (seat released)
//
// A booking holds a seat only while it is `confirmed`, and the only code that
// sets `confirmed` is claimSeat(), which runs under the database write lock.

export interface CreateBookingInput {
  studentId: string;
  trialClassId: string;
}

/**
 * Starts a trial booking for one of the parent's children. Idempotent: if the
 * child already has an unpaid booking for this class, that booking is
 * returned (created: false) instead of a duplicate being created.
 */
export function createBooking(
  deps: Deps,
  parentId: string,
  input: CreateBookingInput,
): { booking: Booking; created: boolean } {
  const { db } = deps;
  const now = deps.now().toISOString();

  const { bookingId, created } = withWriteLock(db, () => {
    const student = queryOne<{ id: string; name: string; parentId: string }>(
      db,
      'SELECT id, name, parent_id AS parentId FROM students WHERE id = :studentId',
      { studentId: input.studentId },
    );
    // Another family's child looks the same as a missing one, so ids cannot be probed.
    if (!student || student.parentId !== parentId) {
      throw new AppError('not_found', 'Student not found.');
    }

    const trialClass = findTrialClass(db, input.trialClassId);
    if (!trialClass) throw new AppError('not_found', 'Trial class not found.');
    if (trialClass.startsAt <= now) {
      throw new AppError('booking_closed', 'This class has already started.');
    }

    const live = queryOne<{ id: string; status: BookingStatus }>(
      db,
      `SELECT id, status FROM bookings
        WHERE student_id = :studentId AND trial_class_id = :trialClassId
          AND status IN ('pending_payment', 'payment_failed', 'confirmed')`,
      { studentId: student.id, trialClassId: trialClass.id },
    );
    if (live?.status === 'confirmed') {
      throw new AppError('already_booked', `${student.name} already has a confirmed seat in this class.`);
    }

    // Advisory only: an unpaid booking does not hold a seat, so this check
    // just stops a parent from starting a payment that cannot succeed. The
    // binding check runs in claimSeat() when the payment comes back.
    if (trialClass.seatsLeft <= 0) throw new AppError('class_full', 'This class is full.');

    // Double click, second tab, or coming back after a declined card: resume
    // the unpaid booking. The partial unique index rejects a second live row
    // even if this check were skipped.
    if (live) return { bookingId: live.id, created: false };

    const id = `bkg_${randomUUID()}`;
    execute(
      db,
      `INSERT INTO bookings (id, student_id, trial_class_id, status, created_at, updated_at)
       VALUES (:id, :studentId, :trialClassId, 'pending_payment', :now, :now)`,
      { id, studentId: student.id, trialClassId: trialClass.id, now },
    );
    return { bookingId: id, created: true };
  });

  return { booking: getBooking(db, bookingId)!, created };
}

export type PaymentOutcome =
  | 'confirmed'
  | 'payment_declined'
  | 'class_full'
  | 'booking_closed'
  | 'already_confirmed';

export interface PaymentResult {
  outcome: PaymentOutcome;
  message: string;
  booking: Booking;
  /** Null when the booking was refused before the payment provider was contacted. */
  paymentAttempt: PaymentAttempt | null;
}

/**
 * Pays for a booking with the mock provider and confirms it if a seat is
 * still free. Four steps:
 *   1. Short write transaction: validate, refuse early if the class is full
 *      or closed (no money moves), record a `processing` payment attempt.
 *   2. Authorize the card. No transaction is open during this slow external
 *      call, which is exactly when another parent can take the last seat.
 *   3. claimSeat(): re-check everything under the write lock. The first
 *      payment to get here takes the seat; later ones are refused.
 *   4. Capture the money if the seat was claimed, otherwise void the
 *      authorization so the parent is never charged.
 */
export async function payForBooking(
  deps: Deps,
  parentId: string,
  bookingId: string,
  paymentMethod: string,
): Promise<PaymentResult> {
  const { db, payments } = deps;

  // Step 1
  const start = withWriteLock(db, () => {
    const booking = getBookingForParent(db, parentId, bookingId);
    if (booking.status === 'confirmed') return { kind: 'done', outcome: 'already_confirmed' } as const;
    if (booking.status === 'cancelled') {
      throw new AppError('not_payable', 'This booking was cancelled. Please start a new booking.');
    }
    const refusal = seatRefusal(db, booking.trialClass.id, deps.now());
    if (refusal) {
      cancelBooking(db, booking.id, refusal, deps.now());
      return { kind: 'done', outcome: refusal } as const;
    }
    const attemptId = `pay_${randomUUID()}`;
    const now = deps.now().toISOString();
    execute(
      db,
      `INSERT INTO payment_attempts
         (id, booking_id, amount_cents, currency, payment_method, status, created_at, updated_at)
       VALUES (:attemptId, :bookingId, :amountCents, :currency, :paymentMethod, 'processing', :now, :now)`,
      {
        attemptId,
        bookingId,
        amountCents: booking.trialClass.priceCents,
        currency: booking.trialClass.currency,
        paymentMethod,
        now,
      },
    );
    return {
      kind: 'authorize',
      request: {
        idempotencyKey: attemptId,
        reference: bookingId,
        amountCents: booking.trialClass.priceCents,
        currency: booking.trialClass.currency,
        paymentMethod,
      } satisfies AuthorizeRequest,
    } as const;
  });
  if (start.kind === 'done') return buildResult(db, bookingId, start.outcome, null);
  const attemptId = start.request.idempotencyKey;

  // Step 2
  const authorization = await authorize(payments, start.request);

  if (authorization.status === 'declined') {
    withWriteLock(db, () => {
      setAttemptStatus(db, attemptId, 'declined', deps.now(), authorization.failureCode);
      // Guarded: a parallel attempt for the same booking may have confirmed it already.
      execute(
        db,
        `UPDATE bookings SET status = 'payment_failed', updated_at = :now
          WHERE id = :bookingId AND status IN ('pending_payment', 'payment_failed')`,
        { bookingId, now: deps.now().toISOString() },
      );
    });
    const confirmedByParallelAttempt = getBooking(db, bookingId)!.status === 'confirmed';
    return buildResult(db, bookingId, confirmedByParallelAttempt ? 'already_confirmed' : 'payment_declined', attemptId);
  }

  // Step 3
  const decision = await claimSeatOrRelease(deps, bookingId, attemptId, authorization.providerRef);

  // Step 4
  if (decision !== 'confirmed') {
    await releaseAuthorization(deps, attemptId, authorization.providerRef);
    return buildResult(db, bookingId, decision, attemptId);
  }
  try {
    await payments.capture(authorization.providerRef);
  } catch (error) {
    console.error(`Capture failed for payment attempt ${attemptId}; releasing the seat`, error);
    // The seat was claimed but the money could not be taken. Give the seat
    // back so the roster only ever lists children whose trial is paid for.
    withWriteLock(db, () => {
      setAttemptStatus(db, attemptId, 'capture_failed', deps.now(), 'capture_failed');
      execute(
        db,
        `UPDATE bookings SET status = 'payment_failed', confirmed_at = NULL, updated_at = :now
          WHERE id = :bookingId AND status = 'confirmed'`,
        { bookingId, now: deps.now().toISOString() },
      );
    });
    return buildResult(db, bookingId, 'payment_declined', attemptId);
  }
  withWriteLock(db, () => setAttemptStatus(db, attemptId, 'captured', deps.now()));
  return buildResult(db, bookingId, 'confirmed', attemptId);
}

async function claimSeatOrRelease(
  deps: Deps,
  bookingId: string,
  attemptId: string,
  providerRef: string,
): Promise<'confirmed' | 'already_confirmed' | CancelReason> {
  try {
    return withWriteLock(deps.db, () => claimSeat(deps.db, bookingId, attemptId, providerRef, deps.now()));
  } catch (error) {
    // Never leave a hold on the parent's card because of an unexpected error.
    await releaseAuthorization(deps, attemptId, providerRef);
    throw error;
  }
}

/**
 * The authoritative seat check. Runs inside withWriteLock, so no other
 * connection or process can confirm a booking between the count and the
 * update. This is what resolves the last-seat race: whichever authorized
 * payment reaches this function first gets the seat.
 */
function claimSeat(
  db: Db,
  bookingId: string,
  attemptId: string,
  providerRef: string,
  now: Date,
): 'confirmed' | 'already_confirmed' | CancelReason {
  execute(
    db,
    `UPDATE payment_attempts SET status = 'authorized', provider_ref = :providerRef, updated_at = :now
      WHERE id = :attemptId`,
    { attemptId, providerRef, now: now.toISOString() },
  );

  const booking = queryOne<{ status: BookingStatus; cancelReason: CancelReason | null; trialClassId: string }>(
    db,
    `SELECT status, cancel_reason AS cancelReason, trial_class_id AS trialClassId
       FROM bookings WHERE id = :bookingId`,
    { bookingId },
  )!;
  // Another attempt for this same booking (double submit) got here first.
  if (booking.status === 'confirmed') return 'already_confirmed';
  if (booking.status === 'cancelled') return booking.cancelReason ?? 'class_full';

  const refusal = seatRefusal(db, booking.trialClassId, now);
  if (refusal) {
    cancelBooking(db, bookingId, refusal, now);
    return refusal;
  }

  execute(
    db,
    `UPDATE bookings SET status = 'confirmed', confirmed_at = :now, updated_at = :now
      WHERE id = :bookingId`,
    { bookingId, now: now.toISOString() },
  );
  return 'confirmed';
}

function seatRefusal(db: Db, trialClassId: string, now: Date): CancelReason | null {
  const trialClass = findTrialClass(db, trialClassId)!;
  if (trialClass.startsAt <= now.toISOString()) return 'booking_closed';
  if (trialClass.seatsLeft <= 0) return 'class_full';
  return null;
}

function cancelBooking(db: Db, bookingId: string, reason: CancelReason, now: Date): void {
  execute(
    db,
    `UPDATE bookings SET status = 'cancelled', cancel_reason = :reason, updated_at = :now
      WHERE id = :bookingId AND status IN ('pending_payment', 'payment_failed')`,
    { bookingId, reason, now: now.toISOString() },
  );
}

function setAttemptStatus(
  db: Db,
  attemptId: string,
  status: PaymentAttemptStatus,
  now: Date,
  failureCode: string | null = null,
): void {
  execute(
    db,
    `UPDATE payment_attempts SET status = :status, failure_code = :failureCode, updated_at = :now
      WHERE id = :attemptId`,
    { attemptId, status, failureCode, now: now.toISOString() },
  );
}

async function authorize(payments: PaymentProvider, request: AuthorizeRequest): Promise<AuthorizeResult> {
  try {
    return await payments.authorize(request);
  } catch (error) {
    // Treated as a decline so the parent can retry. With a real provider an
    // error can hide a successful authorization; the idempotency key lets a
    // reconciliation job find and void it.
    console.error(`Payment provider error for attempt ${request.idempotencyKey}`, error);
    return { status: 'declined', failureCode: 'provider_error' };
  }
}

async function releaseAuthorization(deps: Deps, attemptId: string, providerRef: string): Promise<void> {
  try {
    await deps.payments.voidAuthorization(providerRef);
    withWriteLock(deps.db, () => setAttemptStatus(deps.db, attemptId, 'voided', deps.now()));
  } catch (error) {
    // The attempt stays `authorized`. Unused authorizations lapse at the
    // issuer; a reconciliation job would void them sooner (see README).
    console.error(`Could not void authorization ${providerRef} (attempt ${attemptId})`, error);
  }
}

function buildResult(
  db: Db,
  bookingId: string,
  outcome: PaymentOutcome,
  attemptId: string | null,
): PaymentResult {
  const booking = getBooking(db, bookingId)!;
  const paymentAttempt = booking.paymentAttempts.find((attempt) => attempt.id === attemptId) ?? null;
  return { outcome, message: describeOutcome(outcome, booking, paymentAttempt), booking, paymentAttempt };
}

const DECLINE_REASONS: Record<string, string> = {
  insufficient_funds: 'insufficient funds',
  invalid_payment_method: 'unsupported payment method',
  provider_error: 'the payment provider did not respond',
};

function describeOutcome(outcome: PaymentOutcome, booking: Booking, attempt: PaymentAttempt | null): string {
  const child = booking.student.name;
  switch (outcome) {
    case 'confirmed':
      return `Payment received. ${child} has a confirmed seat in "${booking.trialClass.title}".`;
    case 'payment_declined': {
      if (attempt?.status === 'capture_failed') {
        return `The payment could not be completed, so ${child} is not booked. Please try again.`;
      }
      const reason = DECLINE_REASONS[attempt?.failureCode ?? ''] ?? 'card declined';
      return `The payment was declined (${reason}). ${child} is not booked yet; you can retry with another card.`;
    }
    case 'class_full':
      if (!attempt) return 'This class is now full. You were not charged.';
      return attempt.status === 'voided'
        ? 'The last seat was taken while your payment was processing. The hold on your card was released, so you were not charged.'
        : 'The last seat was taken while your payment was processing, so you were not charged.';
    case 'booking_closed':
      return 'This class has already started, so it can no longer be booked. You were not charged.';
    case 'already_confirmed':
      return 'This booking is already confirmed. You were not charged again.';
  }
}
