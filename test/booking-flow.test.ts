import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { SEED } from '../src/db/seed.ts';
import { queryOne } from '../src/db/sql.ts';
import { createBooking, payForBooking } from '../src/domain/bookings.ts';
import { findTrialClass, getRoster, listUpcomingTrialClasses } from '../src/domain/queries.ts';
import { MockPaymentProvider } from '../src/payments/mock-provider.ts';
import { GatedPaymentProvider } from './support/gated-provider.ts';
import { TEST_NOW, confirmedStudentIds, paymentAttemptStatuses, setupTestDb, type TestContext } from './support/fixtures.ts';

const { parents, students, classes } = SEED;

let ctx: TestContext;
let provider: GatedPaymentProvider;

beforeEach(() => {
  provider = new GatedPaymentProvider();
  ctx = setupTestDb({ payments: provider });
});
afterEach(() => ctx.close());

const seatsLeft = (trialClassId: string) => findTrialClass(ctx.db, trialClassId)!.seatsLeft;

describe('seed data', () => {
  test('covers the cases the brief asks for', () => {
    const occupancy = Object.fromEntries(
      listUpcomingTrialClasses(ctx.db, TEST_NOW).map((c) => [c.id, `${c.confirmedCount}/${c.capacity}`]),
    );
    assert.deepEqual(occupancy, {
      [classes.float]: '1/4', // seats available (plus a declined payment)
      [classes.fractions]: '3/4', // exactly 3 confirmed: the last-seat case
      [classes.magnets]: '4/4', // full
      [classes.patterns]: '0/4',
    });
  });

  test('the seeded payment failure is not on the roster', () => {
    const roster = getRoster(ctx.db, classes.float);
    assert.deepEqual(roster.confirmed.map((entry) => entry.studentId), [students.leo]);
    assert.deepEqual(
      roster.notOnRoster.map(({ studentName, status, lastPaymentStatus, lastPaymentFailureCode }) => ({
        studentName,
        status,
        lastPaymentStatus,
        lastPaymentFailureCode,
      })),
      [
        {
          studentName: 'Sofia Petrova',
          status: 'payment_failed',
          lastPaymentStatus: 'declined',
          lastPaymentFailureCode: 'insufficient_funds',
        },
      ],
    );
  });
});

describe('creating a booking', () => {
  test('creates a pending_payment booking that does not take a seat yet', () => {
    const { booking, created } = createBooking(ctx.deps, parents.aisha, {
      studentId: students.zara,
      trialClassId: classes.float,
    });
    assert.equal(created, true);
    assert.equal(booking.status, 'pending_payment');
    assert.equal(seatsLeft(classes.float), 3);
  });

  test('booking the same child and class twice resumes the unpaid booking instead of duplicating it', () => {
    const input = { studentId: students.zara, trialClassId: classes.float };
    const first = createBooking(ctx.deps, parents.aisha, input);
    const second = createBooking(ctx.deps, parents.aisha, input);
    assert.equal(second.created, false);
    assert.equal(second.booking.id, first.booking.id);
  });

  test('rejects a duplicate when the child already has a confirmed seat', () => {
    // Seed: Leo is confirmed in the buoyancy class.
    assert.throws(
      () => createBooking(ctx.deps, parents.ben, { studentId: students.leo, trialClassId: classes.float }),
      { code: 'already_booked' },
    );
    const count = queryOne<{ n: number }>(
      ctx.db,
      `SELECT count(*) AS n FROM bookings WHERE student_id = :studentId AND trial_class_id = :trialClassId`,
      { studentId: students.leo, trialClassId: classes.float },
    )!.n;
    assert.equal(count, 1);
  });

  test("rejects booking another family's child", () => {
    assert.throws(
      () => createBooking(ctx.deps, parents.aisha, { studentId: students.leo, trialClassId: classes.patterns }),
      { code: 'not_found' },
    );
  });

  test('rejects a full class', () => {
    assert.throws(
      () => createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.magnets }),
      { code: 'class_full' },
    );
  });

  test('rejects a class that has already started', () => {
    ctx.clock.now = new Date(findTrialClass(ctx.db, classes.float)!.startsAt);
    assert.throws(
      () => createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.float }),
      { code: 'booking_closed' },
    );
  });
});

describe('paying for a booking', () => {
  test('a successful payment confirms the booking, captures the money and adds the child to the roster', async () => {
    const { booking } = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.float });

    const result = await payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_visa');

    assert.equal(result.outcome, 'confirmed');
    assert.equal(result.booking.status, 'confirmed');
    assert.equal(result.paymentAttempt?.status, 'captured');
    assert.ok(confirmedStudentIds(ctx.db, classes.float).includes(students.zara));
    assert.equal(seatsLeft(classes.float), 2);
  });

  test('a declined card leaves the child off the roster and the seat free', async () => {
    const { booking } = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.fractions });

    const result = await payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_declined');

    assert.equal(result.outcome, 'payment_declined');
    assert.equal(result.booking.status, 'payment_failed');
    assert.equal(result.paymentAttempt?.status, 'declined');
    assert.equal(result.paymentAttempt?.failureCode, 'insufficient_funds');
    assert.ok(!confirmedStudentIds(ctx.db, classes.fractions).includes(students.zara));
    assert.equal(seatsLeft(classes.fractions), 1);
    assert.equal(provider.calls.capture, 0);
  });

  test('the parent can retry with another card after a decline', async () => {
    const { booking } = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.fractions });
    await payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_declined');

    // Clicking "Book" again resumes the same booking rather than creating a second one.
    const resumed = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.fractions });
    assert.equal(resumed.booking.id, booking.id);

    const retry = await payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_visa');
    assert.equal(retry.outcome, 'confirmed');
    assert.deepEqual(paymentAttemptStatuses(ctx.db, booking.id), ['declined', 'captured']);
  });

  test('if the capture fails after the seat was claimed, the seat is released again', async (t) => {
    t.mock.method(console, 'error', () => {}); // the failure is logged on purpose
    class CaptureFailsProvider extends MockPaymentProvider {
      override async capture(): Promise<void> {
        throw new Error('acquirer unavailable');
      }
    }
    ctx.deps.payments = new CaptureFailsProvider({ latencyMs: 0 });
    const { booking } = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.fractions });

    const result = await payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_visa');

    assert.equal(result.outcome, 'payment_declined');
    assert.equal(result.booking.status, 'payment_failed');
    assert.equal(result.booking.confirmedAt, null);
    assert.equal(result.paymentAttempt?.status, 'capture_failed');
    assert.ok(!confirmedStudentIds(ctx.db, classes.fractions).includes(students.zara));
    assert.equal(seatsLeft(classes.fractions), 1);
  });

  test('paying after the class has started is refused before any money moves', async () => {
    const { booking } = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.float });
    ctx.clock.now = new Date(findTrialClass(ctx.db, classes.float)!.startsAt);

    const result = await payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_visa');

    assert.equal(result.outcome, 'booking_closed');
    assert.equal(result.booking.status, 'cancelled');
    assert.equal(result.booking.cancelReason, 'booking_closed');
    assert.equal(result.paymentAttempt, null);
    assert.equal(provider.calls.authorize, 0);
  });

  test('paying for an already confirmed booking does nothing and charges nothing', async () => {
    const result = await payForBooking(ctx.deps, parents.ben, 'bkg_seed_01', 'pm_card_visa'); // Leo's confirmed seat
    assert.equal(result.outcome, 'already_confirmed');
    assert.equal(result.paymentAttempt, null);
    assert.equal(provider.calls.authorize, 0);
    assert.deepEqual(paymentAttemptStatuses(ctx.db, 'bkg_seed_01'), ['captured']);
  });

  test("cannot pay for another family's booking", async () => {
    const { booking } = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.float });
    await assert.rejects(payForBooking(ctx.deps, parents.ben, booking.id, 'pm_card_visa'), { code: 'not_found' });
    assert.equal(provider.calls.authorize, 0);
  });

  test('cannot pay for a cancelled booking', async () => {
    const { booking } = createBooking(ctx.deps, parents.aisha, { studentId: students.zara, trialClassId: classes.float });
    ctx.clock.now = new Date(findTrialClass(ctx.db, classes.float)!.startsAt);
    await payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_visa'); // cancelled: booking_closed

    await assert.rejects(payForBooking(ctx.deps, parents.aisha, booking.id, 'pm_card_visa'), { code: 'not_payable' });
  });
});
