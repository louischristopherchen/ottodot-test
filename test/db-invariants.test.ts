import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { SEED } from '../src/db/seed.ts';
import { execute } from '../src/db/sql.ts';
import { setupTestDb, type TestContext } from './support/fixtures.ts';

// These tests skip the application code and write SQL directly, the way a
// buggy code path or a manual ops fix would. The schema alone must hold the line.

const { students, classes } = SEED;
const NOW = '2026-10-05T01:00:00.000Z';

let ctx: TestContext;
beforeEach(() => {
  ctx = setupTestDb();
});
afterEach(() => ctx.close());

function insertBooking(id: string, studentId: string, trialClassId: string, status: string, cancelReason: string | null = null) {
  execute(
    ctx.db,
    `INSERT INTO bookings (id, student_id, trial_class_id, status, cancel_reason, created_at, updated_at, confirmed_at)
     VALUES (:id, :studentId, :trialClassId, :status, :cancelReason, :now, :now, :confirmedAt)`,
    { id, studentId, trialClassId, status, cancelReason, now: NOW, confirmedAt: status === 'confirmed' ? NOW : null },
  );
}

describe('database invariants', () => {
  test('a second live booking for the same child and class violates the partial unique index', () => {
    // Seed: Leo already holds a confirmed seat in the buoyancy class.
    assert.throws(() => insertBooking('bkg_dup', students.leo, classes.float, 'pending_payment'), /UNIQUE constraint failed/);
    assert.throws(() => insertBooking('bkg_dup', students.leo, classes.float, 'confirmed'), /UNIQUE constraint failed/);
  });

  test('cancelled bookings are history and do not block a new booking', () => {
    insertBooking('bkg_old', students.zara, classes.patterns, 'cancelled', 'class_full');
    insertBooking('bkg_new', students.zara, classes.patterns, 'pending_payment');
  });

  test('confirming a fifth student in a four-seat class is rejected by the capacity trigger', () => {
    insertBooking('bkg_extra', students.zara, classes.magnets, 'pending_payment'); // magnets is 4/4
    assert.throws(
      () =>
        execute(ctx.db, `UPDATE bookings SET status = 'confirmed', confirmed_at = :now WHERE id = 'bkg_extra'`, {
          now: NOW,
        }),
      /class_full/,
    );
  });

  test('inserting a confirmed booking straight into a full class is rejected', () => {
    assert.throws(() => insertBooking('bkg_extra', students.zara, classes.magnets, 'confirmed'), /class_full/);
  });

  test('the last seat can be confirmed, but not the one after it', () => {
    insertBooking('bkg_4th', students.zara, classes.fractions, 'confirmed'); // 3/4 -> 4/4
    assert.throws(() => insertBooking('bkg_5th', students.ethan, classes.fractions, 'confirmed'), /class_full/);
  });

  test('capacity cannot be lowered below the number of confirmed students', () => {
    assert.throws(
      () => execute(ctx.db, `UPDATE trial_classes SET capacity = 2 WHERE id = :id`, { id: classes.fractions }),
      /capacity_below_confirmed/,
    );
    assert.throws(
      () => execute(ctx.db, `UPDATE trial_classes SET capacity = 5 WHERE id = :id`, { id: classes.fractions }),
      /CHECK constraint failed/,
    );
  });

  test('CHECK constraints reject impossible booking rows', () => {
    assert.throws(() => insertBooking('bkg_bad', students.zara, classes.patterns, 'waitlisted'), /CHECK constraint failed/);
    // A cancelled booking must say why.
    assert.throws(() => insertBooking('bkg_bad', students.zara, classes.patterns, 'cancelled'), /CHECK constraint failed/);
  });
});
