import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { STAFF_USER_ID, createApp } from '../src/app.ts';
import { SEED } from '../src/db/seed.ts';
import { setupTestDb, type TestContext } from './support/fixtures.ts';

const { parents, students, classes } = SEED;

let ctx: TestContext;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  ctx = setupTestDb();
  server = createApp(ctx.deps).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  ctx.close();
});

type Json = Record<string, any>;

async function call(
  method: string,
  path: string,
  options: { user?: string; body?: unknown; rawBody?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.user) headers['x-user-id'] = options.user;
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  return { status: response.status, body: (await response.json()) as Json };
}

const book = (user: string, studentId: string, trialClassId: string) =>
  call('POST', '/api/bookings', { user, body: { studentId, trialClassId } });

const pay = (user: string, bookingId: string, paymentMethod: string) =>
  call('POST', `/api/bookings/${bookingId}/payments`, { user, body: { paymentMethod } });

const roster = (trialClassId: string, user: string = STAFF_USER_ID) =>
  call('GET', `/api/staff/trial-classes/${trialClassId}/roster`, { user });

describe('HTTP API', () => {
  test('happy path: list classes, book, pay, see the status, appear on the roster', async () => {
    const list = await call('GET', '/api/trial-classes');
    assert.equal(list.status, 200);
    assert.equal(list.body.trialClasses.find((c: Json) => c.id === classes.fractions).seatsLeft, 1);

    const created = await book(parents.aisha, students.zara, classes.fractions);
    assert.equal(created.status, 201);
    assert.equal(created.body.booking.status, 'pending_payment');

    const paid = await pay(parents.aisha, created.body.booking.id, 'pm_card_visa');
    assert.equal(paid.status, 200);
    assert.equal(paid.body.outcome, 'confirmed');
    assert.equal(paid.body.paymentAttempt.status, 'captured');

    const fetched = await call('GET', `/api/bookings/${created.body.booking.id}`, { user: parents.aisha });
    assert.equal(fetched.body.booking.status, 'confirmed');

    const staffView = await roster(classes.fractions);
    assert.equal(staffView.status, 200);
    assert.equal(staffView.body.confirmed.length, 4);
    assert.ok(staffView.body.confirmed.some((entry: Json) => entry.studentName === 'Zara Rahman'));
  });

  test('booking twice for the same child and class returns the same unpaid booking', async () => {
    const first = await book(parents.aisha, students.zara, classes.float);
    const second = await book(parents.aisha, students.zara, classes.float);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.booking.id, first.body.booking.id);
  });

  test('a duplicate of a confirmed booking is rejected with 409 already_booked', async () => {
    const response = await book(parents.ben, students.leo, classes.float);
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'already_booked');
  });

  test('a declined card returns 402 and the child stays off the roster', async () => {
    const created = await book(parents.aisha, students.zara, classes.fractions);
    const paid = await pay(parents.aisha, created.body.booking.id, 'pm_card_declined');
    assert.equal(paid.status, 402);
    assert.equal(paid.body.outcome, 'payment_declined');
    assert.equal(paid.body.booking.status, 'payment_failed');

    const staffView = await roster(classes.fractions);
    assert.equal(staffView.body.confirmed.length, 3);
    assert.equal(staffView.body.notOnRoster[0].status, 'payment_failed');
  });

  test('the parent who pays after the last seat is gone gets 409 class_full', async () => {
    const a = await book(parents.aisha, students.zara, classes.fractions);
    const b = await book(parents.chloe, students.ethan, classes.fractions);
    assert.equal((await pay(parents.chloe, b.body.booking.id, 'pm_card_visa')).status, 200);

    const late = await pay(parents.aisha, a.body.booking.id, 'pm_card_visa');
    assert.equal(late.status, 409);
    assert.equal(late.body.outcome, 'class_full');
    assert.equal(late.body.booking.status, 'cancelled');
  });

  test('a full class cannot be booked', async () => {
    const response = await book(parents.aisha, students.zara, classes.magnets);
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'class_full');
  });

  test('booking requires a signed-in parent', async () => {
    assert.equal((await call('POST', '/api/bookings', { body: {} })).status, 401);
    assert.equal((await book(STAFF_USER_ID, students.zara, classes.float)).status, 403);
    assert.equal((await book('par_nobody', students.zara, classes.float)).status, 401);
  });

  test('rosters are for staff only', async () => {
    assert.equal((await roster(classes.float, parents.aisha)).status, 403);
    assert.equal((await call('GET', `/api/staff/trial-classes/${classes.float}/roster`)).status, 401);
    assert.equal((await roster('cls_missing')).status, 404);
  });

  test("a parent cannot see or pay for another family's booking", async () => {
    const created = await book(parents.aisha, students.zara, classes.float);
    const bookingId = created.body.booking.id;
    assert.equal((await call('GET', `/api/bookings/${bookingId}`, { user: parents.ben })).status, 404);
    assert.equal((await pay(parents.ben, bookingId, 'pm_card_visa')).status, 404);
  });

  test('invalid input is rejected with 400', async () => {
    const missing = await call('POST', '/api/bookings', { user: parents.aisha, body: { studentId: students.zara } });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'validation_error');

    const created = await book(parents.aisha, students.zara, classes.float);
    const badCard = await pay(parents.aisha, created.body.booking.id, 'pm_card_stolen');
    assert.equal(badCard.status, 400);

    const malformed = await call('POST', '/api/bookings', { user: parents.aisha, rawBody: '{"studentId":' });
    assert.equal(malformed.status, 400);
  });

  test('an oversized body is rejected with 413, not a server error', async () => {
    const response = await call('POST', '/api/bookings', {
      user: parents.aisha,
      rawBody: JSON.stringify({ studentId: 'x'.repeat(20_000), trialClassId: classes.float }),
    });
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'bad_request');
  });

  test('unknown API routes return a JSON 404', async () => {
    const response = await call('GET', '/api/nope');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'not_found');
  });
});
