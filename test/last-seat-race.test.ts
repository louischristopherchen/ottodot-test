import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { SEED } from '../src/db/seed.ts';
import { queryAll } from '../src/db/sql.ts';
import { createBooking, payForBooking } from '../src/domain/bookings.ts';
import { findTrialClass, getRoster } from '../src/domain/queries.ts';
import { MockPaymentProvider } from '../src/payments/mock-provider.ts';
import { GatedPaymentProvider } from './support/gated-provider.ts';
import { addFamilies, confirmedStudentIds, paymentAttemptStatuses, setupTestDb, type TestContext } from './support/fixtures.ts';

// "Fractions with pizza" is seeded with exactly 3 of 4 seats confirmed.
const { parents, students, classes } = SEED;
const LAST_SEAT_CLASS = classes.fractions;

let ctx: TestContext;
afterEach(() => ctx.close());

describe('last-seat race', () => {
  test('the scenario from the brief: B pays first while A is still paying, so only B gets the seat and A is not charged', async () => {
    const provider = new GatedPaymentProvider();
    ctx = setupTestDb({ payments: provider });

    // User A selects the last available seat and moves to payment.
    const bookingA = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: LAST_SEAT_CLASS }).booking;
    provider.hold(bookingA.id);
    const paymentA = payForBooking(ctx.deps, parents.aisha, bookingA.id, 'pm_card_visa');
    await provider.waitForAuthorization(bookingA.id); // A's card authorization is in flight

    // User B selects the same seat and completes payment first.
    const bookingB = createBooking(ctx.deps, parents.chloe, { studentId: students.ethan, trialClassId: LAST_SEAT_CLASS }).booking;
    const resultB = await payForBooking(ctx.deps, parents.chloe, bookingB.id, 'pm_card_visa');
    assert.equal(resultB.outcome, 'confirmed');

    // User A's payment now completes.
    provider.release(bookingA.id);
    const resultA = await paymentA;

    assert.equal(resultA.outcome, 'class_full');
    assert.equal(resultA.booking.status, 'cancelled');
    assert.equal(resultA.booking.cancelReason, 'class_full');
    assert.equal(resultA.paymentAttempt?.status, 'voided', "A's authorization is released, never captured");

    const roster = getRoster(ctx.db, LAST_SEAT_CLASS);
    assert.equal(roster.confirmed.length, 4);
    assert.ok(roster.confirmed.some((entry) => entry.studentId === students.ethan));
    assert.ok(!roster.confirmed.some((entry) => entry.studentId === students.zara));
    assert.deepEqual(provider.calls, { authorize: 2, capture: 1, void: 1 });
  });

  test('if A only tries to pay after B has confirmed, A is refused before the card is touched', async () => {
    const provider = new GatedPaymentProvider();
    ctx = setupTestDb({ payments: provider });
    const bookingA = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: LAST_SEAT_CLASS }).booking;
    const bookingB = createBooking(ctx.deps, parents.chloe, { studentId: students.ethan, trialClassId: LAST_SEAT_CLASS }).booking;

    await payForBooking(ctx.deps, parents.chloe, bookingB.id, 'pm_card_visa');
    const resultA = await payForBooking(ctx.deps, parents.aisha, bookingA.id, 'pm_card_visa');

    assert.equal(resultA.outcome, 'class_full');
    assert.equal(resultA.paymentAttempt, null);
    assert.equal(provider.calls.authorize, 1, 'only B was authorized');
    assert.equal(findTrialClass(ctx.db, LAST_SEAT_CLASS)!.confirmedCount, 4);
  });

  test('a crowd of parents paying for the last seat at the same moment: exactly one wins, nobody else is charged', async () => {
    ctx = setupTestDb({ payments: new MockPaymentProvider({ latencyMs: 25 }) });
    const families = addFamilies(ctx.db, 12);
    const bookings = families.map(({ parentId, studentId }) => ({
      parentId,
      bookingId: createBooking(ctx.deps, parentId, { studentId, trialClassId: LAST_SEAT_CLASS }).booking.id,
    }));

    const results = await Promise.all(
      bookings.map(({ parentId, bookingId }) => payForBooking(ctx.deps, parentId, bookingId, 'pm_card_visa')),
    );

    const outcomes = results.map((result) => result.outcome);
    assert.equal(outcomes.filter((outcome) => outcome === 'confirmed').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome === 'class_full').length, 11);
    assert.equal(confirmedStudentIds(ctx.db, LAST_SEAT_CLASS).length, 4);

    // Every loser got past the early check (all were authorized) and was
    // stopped by the seat claim; every one of those holds was voided.
    const attempts = queryAll<{ status: string }>(
      ctx.db,
      `SELECT pa.status FROM payment_attempts pa JOIN bookings b ON b.id = pa.booking_id
        WHERE b.trial_class_id = :trialClassId AND b.student_id LIKE 'stu_extra_%'`,
      { trialClassId: LAST_SEAT_CLASS },
    ).map((row) => row.status);
    assert.equal(attempts.filter((status) => status === 'captured').length, 1);
    assert.equal(attempts.filter((status) => status === 'voided').length, 11);
    assert.equal(attempts.length, 12);
  });

  test('a double-submitted payment for one booking confirms once and charges once', async () => {
    ctx = setupTestDb({ payments: new MockPaymentProvider({ latencyMs: 10 }) });
    const { booking } = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: LAST_SEAT_CLASS });

    const results = await Promise.all([
      payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_visa'),
      payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_visa'),
    ]);

    assert.deepEqual(results.map((result) => result.outcome).sort(), ['already_confirmed', 'confirmed']);
    assert.deepEqual(paymentAttemptStatuses(ctx.db, booking.id).sort(), ['captured', 'voided']);
    assert.equal(findTrialClass(ctx.db, LAST_SEAT_CLASS)!.confirmedCount, 4);
  });
});
