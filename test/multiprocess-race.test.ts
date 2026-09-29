import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPaymentsInParallelProcesses } from '../src/cli/pay-worker.ts';
import { SEED } from '../src/db/seed.ts';
import { queryAll } from '../src/db/sql.ts';
import { createBooking } from '../src/domain/bookings.ts';
import { findTrialClass } from '../src/domain/queries.ts';
import { addFamilies, setupTestDb } from './support/fixtures.ts';

test('10 separate processes race for the last seat: exactly one is confirmed', async (t) => {
  // Real clock: the worker processes use new Date() too.
  const ctx = setupTestDb({ now: new Date() });
  t.after(() => ctx.close());
  const lastSeatClass = SEED.classes.fractions; // 3 of 4 confirmed

  const jobs = addFamilies(ctx.db, 10).map(({ parentId, studentId }) => ({
    parentId,
    bookingId: createBooking(ctx.deps, parentId, { studentId, trialClassId: lastSeatClass }).booking.id,
  }));

  const results = await runPaymentsInParallelProcesses(ctx.dbPath, jobs);

  assert.equal(new Set(results.map((result) => result.pid)).size, 10, 'each payment ran in its own process');
  assert.equal(results.filter((result) => result.outcome === 'confirmed').length, 1);
  assert.equal(results.filter((result) => result.outcome === 'class_full').length, 9);
  assert.equal(findTrialClass(ctx.db, lastSeatClass)!.confirmedCount, 4);

  const stillHeld = queryAll(
    ctx.db,
    `SELECT id FROM payment_attempts WHERE status IN ('processing', 'authorized')`,
  );
  assert.equal(stillHeld.length, 0, 'no payment is left authorized or in flight');

  const lostAfterAuthorization = results.filter((result) => result.attemptStatus === 'voided').length;
  t.diagnostic(
    `${lostAfterAuthorization} of 9 losers were authorized and then stopped by the seat claim; ` +
      `${9 - lostAfterAuthorization} were refused before authorization`,
  );
});
