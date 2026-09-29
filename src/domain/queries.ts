import type { Db } from '../db/database.ts';
import { queryAll, queryOne } from '../db/sql.ts';
import { AppError } from './errors.ts';
import type {
  Booking,
  BookingStatus,
  CancelReason,
  Family,
  NotOnRosterEntry,
  PaymentAttempt,
  Roster,
  RosterEntry,
  TrialClass,
} from './types.ts';

const TRIAL_CLASS_COLUMNS = `
  c.id, c.subject, c.title, c.teacher_name AS teacherName, c.starts_at AS startsAt,
  c.duration_minutes AS durationMinutes, c.capacity, c.price_cents AS priceCents, c.currency,
  (SELECT count(*) FROM bookings b
    WHERE b.trial_class_id = c.id AND b.status = 'confirmed') AS confirmedCount`;

type TrialClassRow = Omit<TrialClass, 'seatsLeft'>;

function withSeatsLeft(row: TrialClassRow): TrialClass {
  return { ...row, seatsLeft: row.capacity - row.confirmedCount };
}

export function findTrialClass(db: Db, trialClassId: string): TrialClass | undefined {
  const row = queryOne<TrialClassRow>(
    db,
    `SELECT ${TRIAL_CLASS_COLUMNS} FROM trial_classes c WHERE c.id = :trialClassId`,
    { trialClassId },
  );
  return row && withSeatsLeft(row);
}

/** Classes that have not started yet, soonest first. Seat counts are a snapshot for display. */
export function listUpcomingTrialClasses(db: Db, now: Date): TrialClass[] {
  return queryAll<TrialClassRow>(
    db,
    `SELECT ${TRIAL_CLASS_COLUMNS} FROM trial_classes c
      WHERE c.starts_at > :now
      ORDER BY c.starts_at`,
    { now: now.toISOString() },
  ).map(withSeatsLeft);
}

interface BookingRow {
  id: string;
  status: BookingStatus;
  cancelReason: CancelReason | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  parentId: string;
  studentId: string;
  studentName: string;
  trialClassId: string;
  trialClassTitle: string;
  trialClassSubject: string;
  trialClassStartsAt: string;
  priceCents: number;
  currency: string;
}

const BOOKING_SELECT = `
  SELECT b.id, b.status, b.cancel_reason AS cancelReason, b.created_at AS createdAt,
         b.updated_at AS updatedAt, b.confirmed_at AS confirmedAt,
         s.parent_id AS parentId, s.id AS studentId, s.name AS studentName,
         c.id AS trialClassId, c.title AS trialClassTitle, c.subject AS trialClassSubject,
         c.starts_at AS trialClassStartsAt, c.price_cents AS priceCents, c.currency
    FROM bookings b
    JOIN students s ON s.id = b.student_id
    JOIN trial_classes c ON c.id = b.trial_class_id`;

const PAYMENT_ATTEMPT_COLUMNS = `
  id, booking_id AS bookingId, status, amount_cents AS amountCents, currency,
  payment_method AS paymentMethod, failure_code AS failureCode,
  created_at AS createdAt, updated_at AS updatedAt`;

function toBooking(row: BookingRow, paymentAttempts: PaymentAttempt[]): Booking {
  return {
    id: row.id,
    status: row.status,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confirmedAt: row.confirmedAt,
    student: { id: row.studentId, name: row.studentName },
    trialClass: {
      id: row.trialClassId,
      title: row.trialClassTitle,
      subject: row.trialClassSubject,
      startsAt: row.trialClassStartsAt,
      priceCents: row.priceCents,
      currency: row.currency,
    },
    paymentAttempts,
  };
}

function stripBookingId({ bookingId: _, ...attempt }: PaymentAttempt & { bookingId: string }): PaymentAttempt {
  return attempt;
}

export function getBooking(db: Db, bookingId: string): Booking | undefined {
  const row = queryOne<BookingRow>(db, `${BOOKING_SELECT} WHERE b.id = :bookingId`, { bookingId });
  if (!row) return undefined;
  const attempts = queryAll<PaymentAttempt & { bookingId: string }>(
    db,
    `SELECT ${PAYMENT_ATTEMPT_COLUMNS} FROM payment_attempts
      WHERE booking_id = :bookingId ORDER BY created_at, rowid`,
    { bookingId },
  );
  return toBooking(row, attempts.map(stripBookingId));
}

/** Another family's booking looks the same as a missing one, so ids cannot be probed. */
export function getBookingForParent(db: Db, parentId: string, bookingId: string): Booking {
  const row = queryOne<BookingRow>(db, `${BOOKING_SELECT} WHERE b.id = :bookingId`, { bookingId });
  if (!row || row.parentId !== parentId) throw new AppError('not_found', 'Booking not found.');
  return getBooking(db, bookingId)!;
}

export function listBookingsForParent(db: Db, parentId: string): Booking[] {
  const rows = queryAll<BookingRow>(
    db,
    `${BOOKING_SELECT} WHERE s.parent_id = :parentId ORDER BY b.created_at DESC, b.rowid DESC`,
    { parentId },
  );
  const attempts = queryAll<PaymentAttempt & { bookingId: string }>(
    db,
    `SELECT ${PAYMENT_ATTEMPT_COLUMNS} FROM payment_attempts
      WHERE booking_id IN (
        SELECT b.id FROM bookings b JOIN students s ON s.id = b.student_id
         WHERE s.parent_id = :parentId)
      ORDER BY created_at, rowid`,
    { parentId },
  );
  const attemptsByBooking = Map.groupBy(attempts, (attempt) => attempt.bookingId);
  return rows.map((row) =>
    toBooking(row, (attemptsByBooking.get(row.id) ?? []).map(stripBookingId)),
  );
}

export function getRoster(db: Db, trialClassId: string): Roster {
  const trialClass = findTrialClass(db, trialClassId);
  if (!trialClass) throw new AppError('not_found', 'Trial class not found.');

  const confirmed = queryAll<RosterEntry>(
    db,
    `SELECT b.id AS bookingId, s.id AS studentId, s.name AS studentName, s.level,
            p.name AS parentName, p.email AS parentEmail, b.confirmed_at AS confirmedAt
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       JOIN parents p ON p.id = s.parent_id
      WHERE b.trial_class_id = :trialClassId AND b.status = 'confirmed'
      ORDER BY b.confirmed_at, b.rowid`,
    { trialClassId },
  );

  const notOnRoster = queryAll<NotOnRosterEntry>(
    db,
    `SELECT b.id AS bookingId, s.name AS studentName, p.name AS parentName, b.status,
            b.cancel_reason AS cancelReason, b.updated_at AS updatedAt,
            last_payment.status AS lastPaymentStatus,
            last_payment.failure_code AS lastPaymentFailureCode
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       JOIN parents p ON p.id = s.parent_id
       LEFT JOIN payment_attempts last_payment ON last_payment.rowid = (
         SELECT pa.rowid FROM payment_attempts pa
          WHERE pa.booking_id = b.id
          ORDER BY pa.created_at DESC, pa.rowid DESC LIMIT 1)
      WHERE b.trial_class_id = :trialClassId AND b.status <> 'confirmed'
      ORDER BY b.updated_at DESC, b.rowid DESC`,
    { trialClassId },
  );

  return { trialClass, confirmed, notOnRoster };
}

export function findParent(db: Db, parentId: string): { id: string; name: string } | undefined {
  return queryOne(db, 'SELECT id, name FROM parents WHERE id = :parentId', { parentId });
}

/** Parents with their children: feeds the demo sign-in switcher and the child picker. */
export function listFamilies(db: Db): Family[] {
  const parents = queryAll<Omit<Family, 'children'>>(
    db,
    'SELECT id, name, email FROM parents ORDER BY name',
  );
  const children = queryAll<Family['children'][number] & { parentId: string }>(
    db,
    'SELECT id, name, level, parent_id AS parentId FROM students ORDER BY name',
  );
  const childrenByParent = Map.groupBy(children, (child) => child.parentId);
  return parents.map((parent) => ({
    ...parent,
    children: (childrenByParent.get(parent.id) ?? []).map(({ parentId: _, ...child }) => child),
  }));
}
