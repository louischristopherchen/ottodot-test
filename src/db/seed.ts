import { withWriteLock, type Db } from './database.ts';
import { execute, queryOne } from './sql.ts';

// Synthetic demo data. Class start times are relative to the moment of
// seeding, so the demo works on any day. Stable ids let the README, the
// tests and the CLI scripts refer to seeded records.

export const SEED = {
  parents: {
    aisha: 'par_aisha',
    ben: 'par_ben',
    chloe: 'par_chloe',
    daniel: 'par_daniel',
    elena: 'par_elena',
    farah: 'par_farah',
    george: 'par_george',
    hana: 'par_hana',
  },
  students: {
    zara: 'stu_zara',
    idris: 'stu_idris',
    leo: 'stu_leo',
    ethan: 'stu_ethan',
    mia: 'stu_mia',
    noah: 'stu_noah',
    sofia: 'stu_sofia',
    adam: 'stu_adam',
    lucas: 'stu_lucas',
    yuki: 'stu_yuki',
  },
  classes: {
    /** 1 of 4 confirmed, plus a declined payment. Leo's seat is the duplicate-booking case. */
    float: 'cls_float',
    /** Exactly 3 of 4 confirmed: the last-seat race. */
    fractions: 'cls_fractions',
    /** 4 of 4 confirmed: full. */
    magnets: 'cls_magnets',
    /** 0 of 4 confirmed. */
    patterns: 'cls_patterns',
  },
} as const;

const PRICE_CENTS = 2000; // SGD 20.00 per trial

const PARENTS = [
  { id: SEED.parents.aisha, name: 'Aisha Rahman', email: 'aisha.rahman@example.com' },
  { id: SEED.parents.ben, name: 'Ben Carter', email: 'ben.carter@example.com' },
  { id: SEED.parents.chloe, name: 'Chloe Tan', email: 'chloe.tan@example.com' },
  { id: SEED.parents.daniel, name: 'Daniel Lim', email: 'daniel.lim@example.com' },
  { id: SEED.parents.elena, name: 'Elena Petrova', email: 'elena.petrova@example.com' },
  { id: SEED.parents.farah, name: 'Farah Hassan', email: 'farah.hassan@example.com' },
  { id: SEED.parents.george, name: 'George Ng', email: 'george.ng@example.com' },
  { id: SEED.parents.hana, name: 'Hana Sato', email: 'hana.sato@example.com' },
];

const STUDENTS = [
  { id: SEED.students.zara, parentId: SEED.parents.aisha, name: 'Zara Rahman', level: 3 },
  { id: SEED.students.idris, parentId: SEED.parents.aisha, name: 'Idris Rahman', level: 5 },
  { id: SEED.students.leo, parentId: SEED.parents.ben, name: 'Leo Carter', level: 4 },
  { id: SEED.students.ethan, parentId: SEED.parents.chloe, name: 'Ethan Tan', level: 3 },
  { id: SEED.students.mia, parentId: SEED.parents.chloe, name: 'Mia Tan', level: 6 },
  { id: SEED.students.noah, parentId: SEED.parents.daniel, name: 'Noah Lim', level: 4 },
  { id: SEED.students.sofia, parentId: SEED.parents.elena, name: 'Sofia Petrova', level: 5 },
  { id: SEED.students.adam, parentId: SEED.parents.farah, name: 'Adam Hassan', level: 3 },
  { id: SEED.students.lucas, parentId: SEED.parents.george, name: 'Lucas Ng', level: 4 },
  { id: SEED.students.yuki, parentId: SEED.parents.hana, name: 'Yuki Sato', level: 5 },
];

const CLASSES = [
  { id: SEED.classes.float, subject: 'science', title: 'Sink or float? Investigating buoyancy', teacher: 'Ms. Priya Nair', daysAhead: 1, sgtHour: 17 },
  { id: SEED.classes.fractions, subject: 'math', title: 'Fractions with pizza', teacher: 'Mr. Marcus Wong', daysAhead: 2, sgtHour: 17 },
  { id: SEED.classes.magnets, subject: 'science', title: 'Magnets: push and pull', teacher: 'Ms. Siti Aminah', daysAhead: 3, sgtHour: 10 },
  { id: SEED.classes.patterns, subject: 'math', title: 'Number patterns and puzzles', teacher: 'Mr. Kenji Ito', daysAhead: 4, sgtHour: 17 },
];

type SeedBooking = {
  studentId: string;
  trialClassId: string;
  status: 'confirmed' | 'payment_failed';
  minutesAgo: number;
};

const BOOKINGS: SeedBooking[] = [
  { studentId: SEED.students.leo, trialClassId: SEED.classes.float, status: 'confirmed', minutesAgo: 300 },
  { studentId: SEED.students.sofia, trialClassId: SEED.classes.float, status: 'payment_failed', minutesAgo: 90 },

  { studentId: SEED.students.noah, trialClassId: SEED.classes.fractions, status: 'confirmed', minutesAgo: 600 },
  { studentId: SEED.students.lucas, trialClassId: SEED.classes.fractions, status: 'confirmed', minutesAgo: 480 },
  { studentId: SEED.students.yuki, trialClassId: SEED.classes.fractions, status: 'confirmed', minutesAgo: 120 },

  { studentId: SEED.students.idris, trialClassId: SEED.classes.magnets, status: 'confirmed', minutesAgo: 900 },
  { studentId: SEED.students.mia, trialClassId: SEED.classes.magnets, status: 'confirmed', minutesAgo: 700 },
  { studentId: SEED.students.adam, trialClassId: SEED.classes.magnets, status: 'confirmed', minutesAgo: 400 },
  { studentId: SEED.students.sofia, trialClassId: SEED.classes.magnets, status: 'confirmed', minutesAgo: 200 },
];

/** Start time in UTC for a class held `daysAhead` days after `now`, at `sgtHour`:00 Singapore time (UTC+8). */
function classStart(now: Date, daysAhead: number, sgtHour: number): string {
  const sgt = new Date(now.getTime() + 8 * 3600_000);
  return new Date(
    Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate() + daysAhead, sgtHour - 8),
  ).toISOString();
}

export function isDatabaseEmpty(db: Db): boolean {
  return queryOne<{ n: number }>(db, 'SELECT count(*) AS n FROM parents')!.n === 0;
}

export function hasUpcomingClasses(db: Db, now: Date): boolean {
  return (
    queryOne<{ n: number }>(db, 'SELECT count(*) AS n FROM trial_classes WHERE starts_at > :now', {
      now: now.toISOString(),
    })!.n > 0
  );
}

/** Deletes every row and inserts the demo data again (one transaction). */
export function resetDemoData(db: Db, now: Date): void {
  withWriteLock(db, () => {
    for (const table of ['payment_attempts', 'bookings', 'trial_classes', 'students', 'parents']) {
      execute(db, `DELETE FROM ${table}`);
    }
    insertDemoData(db, now);
  });
}

export function seedDemoData(db: Db, now: Date): void {
  withWriteLock(db, () => insertDemoData(db, now));
}

function insertDemoData(db: Db, now: Date): void {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  for (const parent of PARENTS) {
    execute(db, 'INSERT INTO parents (id, name, email) VALUES (:id, :name, :email)', parent);
  }
  for (const student of STUDENTS) {
    execute(
      db,
      'INSERT INTO students (id, parent_id, name, level) VALUES (:id, :parentId, :name, :level)',
      student,
    );
  }
  for (const c of CLASSES) {
    execute(
      db,
      `INSERT INTO trial_classes
         (id, subject, title, teacher_name, starts_at, duration_minutes, capacity, price_cents, currency)
       VALUES (:id, :subject, :title, :teacher, :startsAt, 60, 4, :priceCents, 'SGD')`,
      {
        id: c.id,
        subject: c.subject,
        title: c.title,
        teacher: c.teacher,
        startsAt: classStart(now, c.daysAhead, c.sgtHour),
        priceCents: PRICE_CENTS,
      },
    );
  }

  BOOKINGS.forEach((booking, index) => {
    const n = String(index + 1).padStart(2, '0');
    const at = ago(booking.minutesAgo);
    const confirmed = booking.status === 'confirmed';
    execute(
      db,
      `INSERT INTO bookings (id, student_id, trial_class_id, status, created_at, updated_at, confirmed_at)
       VALUES (:id, :studentId, :trialClassId, :status, :at, :at, :confirmedAt)`,
      {
        id: `bkg_seed_${n}`,
        studentId: booking.studentId,
        trialClassId: booking.trialClassId,
        status: booking.status,
        at,
        confirmedAt: confirmed ? at : null,
      },
    );
    execute(
      db,
      `INSERT INTO payment_attempts
         (id, booking_id, amount_cents, currency, payment_method, status, provider_ref, failure_code,
          created_at, updated_at)
       VALUES (:id, :bookingId, :amountCents, 'SGD', :method, :status, :providerRef, :failureCode, :at, :at)`,
      {
        id: `pay_seed_${n}`,
        bookingId: `bkg_seed_${n}`,
        amountCents: PRICE_CENTS,
        method: confirmed ? 'pm_card_visa' : 'pm_card_declined',
        status: confirmed ? 'captured' : 'declined',
        providerRef: confirmed ? `auth_seed_${n}` : null,
        failureCode: confirmed ? null : 'insufficient_funds',
        at,
      },
    );
  });
}
