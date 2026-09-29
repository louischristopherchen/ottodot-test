# Ottodot trial booking

The smallest working slice of trial class booking: a parent picks a child and a
trial class, pays (mock card), and sees the booking status; staff see the
roster. Trial classes have 4 seats, and the system keeps that true under
duplicate submissions, declined payments and two parents paying for the last
seat at the same time.

The backend is the focus: an Express API over SQLite with the booking rules
enforced twice, once in a locked transaction in the application and once in the
database schema. The browser page is deliberately plain.

## Run it

Requires Node 24.2 or later (`nvm use` picks up Node 24 from `.nvmrc`; on an
older Node, `npm install` stops with a clear message). No database server,
Docker or build step: SQLite ships with Node 24, and Node runs the TypeScript
files directly.

```bash
npm install
npm start            # http://localhost:3000 (seeds demo data on first run)
npm test             # 47 tests, a few seconds
npm run demo:race    # narrated last-seat race in the terminal
npm run roster       # rosters as text (npm run roster -- cls_fractions for one class)
npm run db:reset     # fresh demo data; class times are relative to "now"
npm run typecheck
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/trial-booking.db` | SQLite file |
| `MOCK_PAYMENT_LATENCY_MS` | `800` | Time the mock provider takes to authorize a card |
| `MOCK_PAYMENT_SLOW_LATENCY_MS` | `10000` | Same, for the slow test card used to demo the race |

## Demo guide

The top bar has a "Signed in as" switcher (mock auth). Each window can also be
opened as a specific user with `?as=<id>`, which is how you get two parents
side by side.

| Case from the brief | Seed data | How to see it |
| --- | --- | --- |
| Class with seats | "Sink or float?" has 1 of 4 confirmed | Any parent, any free child: book, pay with Visa 4242, status becomes Confirmed |
| Exactly 3 confirmed | "Fractions with pizza" has Noah, Lucas and Yuki | Shown as "Last seat" |
| Full class | "Magnets: push and pull" has 4 of 4 | Disabled in the page; the API answers `409 class_full` |
| Duplicate booking | Leo is confirmed in "Sink or float?" | Sign in as Ben Carter (`?as=par_ben`), pick Leo and that class: "Leo Carter already has a confirmed seat in this class." |
| Payment failure | Sofia's card was declined for "Sink or float?" | Staff roster lists her under "Not on the roster". Live: pay with Visa 0002, status becomes Payment failed, then retry with Visa 4242 |
| Last-seat race | "Fractions with pizza" | See below |

Last-seat race in the browser:

1. Window 1: `http://localhost:3000/?as=par_aisha`, pick Zara and "Fractions with pizza", Continue to payment.
2. Window 2: `http://localhost:3000/?as=par_chloe`, pick Ethan and the same class, Continue to payment.
   Both bookings exist; neither holds the seat yet.
3. Window 1: pay with Visa 1881 (the slow card, 10 seconds).
4. Window 2, within those 10 seconds: pay with Visa 4242. Ethan is confirmed.
5. Window 1 then shows: "The last seat was taken while your payment was processing. The hold on your card was released, so you were not charged."
6. Staff view (`?as=staff_ops`, View roster): 4 of 4 confirmed, Zara under "Not on the roster" as Cancelled (class full), not charged.

`npm run demo:race` shows the same scenario in the terminal, then 10 separate
OS processes paying for one last seat at once, then the database rejecting raw
SQL that tries to overbook.

## What I built

- **API** (Express 5, `src/app.ts`) for listing classes, creating a booking,
  paying for it, reading bookings, and a staff roster.
- **Booking and payment logic** (`src/domain/bookings.ts`): the booking state
  machine and the payment flow (authorize, claim seat, capture or void).
- **Schema** (`src/db/schema.sql`) with the invariants as constraints and
  triggers, plus synthetic seed data (`src/db/seed.ts`).
- **Mock payment provider** (`src/payments/`) with an authorize / capture /
  void interface and three test cards: approves, declines, approves slowly.
- **Browser page** (`web/`, vanilla JS, no build) for parents and staff.
- **CLI tools**: roster printout and the narrated race demo.
- **Tests** (`test/`, Node's built-in runner): 47 tests, listed under
  [Verification](#tests-and-verification).

## The last-seat race

### Approach

A seat is taken only when a booking becomes `confirmed`, and exactly one
function does that: `claimSeat()` in `src/domain/bookings.ts`. It runs inside a
`BEGIN IMMEDIATE` transaction, which takes the database write lock before the
first read. Inside it, the function re-reads the booking and the class's
confirmed count, and confirms only if a seat is still free. The first
authorized payment to get there takes the seat; any later one is refused.

Payment is split around that step:

1. **Start** (short transaction): check the booking belongs to the parent and
   is payable. If the class is already full or has started, cancel the booking
   and stop before touching the card. Otherwise record a `processing` payment
   attempt.
2. **Authorize** the card with the provider. No transaction is open during
   this slow external call, and this is exactly the window in which another
   parent can take the last seat.
3. **Claim the seat** (`claimSeat()`, under the write lock).
4. **Capture** the money if the seat was claimed, otherwise **void** the
   authorization so the parent is never charged.

The brief's scenario, step by step:

| Step | What happens | Resulting state |
| --- | --- | --- |
| A picks the last seat and moves to payment | Booking A is created as `pending_payment`; A's card authorization starts | 3 of 4 confirmed. Unpaid bookings hold no seat |
| B picks the same seat | Booking B is created: 3 < 4, so booking is allowed | Two unpaid bookings for one seat |
| B completes payment first | B authorized, `claimSeat()` sees 3 < 4, B confirmed, money captured | 4 of 4 |
| A's payment completes | A authorized, `claimSeat()` sees 4 of 4, A cancelled (`class_full`), authorization voided | A is told the seat went while paying and that the card was not charged |

If A only presses Pay after B is confirmed, step 1 refuses before the card is
touched. Both variants are tests in `test/last-seat-race.test.ts`, and the
first one is deterministic: a test double pauses A's authorization until B has
finished, so the ordering is exact rather than timing-based.

Two database triggers back this up: any insert or update that would make a
fifth confirmed booking in a 4-seat class is aborted with `class_full`, whatever
code path it comes from.

### Why this approach

- **The rule is checked where it becomes true.** "At most 4 confirmed" can only
  break at the moment a booking is confirmed, so that is where the one binding
  check sits, under a lock. Seat counts shown in the page and the early refusal
  in step 1 are conveniences that can be stale; correctness does not depend on
  them.
- **Authorize first, capture after.** The parent who loses the race has only a
  hold on their card, which is released at once. No refunds, no support
  tickets about money taken for a class they are not in.
- **No seat holds.** Holding the seat while a parent pays is the other common
  design. I left it out: with 4 seats, one abandoned checkout blocks a quarter
  of the class until the hold expires, it needs an expiry job, and it still
  needs the confirm-time check for payments that finish after their hold
  expired. It is an addition on top of this design, not a replacement.

### Trade-offs I accepted

- A parent can reach the payment step and still lose the seat. It only happens
  when two parents pay for the same last seat within a few seconds of each
  other; the loser gets an immediate, clear message and is not charged. If
  monitoring shows it happening often, add a short seat hold in front.
- Between the seat claim and the capture, a booking is `confirmed` while the
  money is only authorized. With a real provider that window is well under a
  second. If the capture fails, the seat is released, the hold is voided and
  the booking moves to `payment_failed` (tested).
- SQLite has one writer at a time for the whole file. The locked transactions
  take a few milliseconds, which is fine at this scale, and the tests show it
  holds across processes. In Postgres the lock would be per class (below).

### The same design in Postgres

- Keep the partial unique index as is.
- In the claim transaction, lock the class row first:
  `SELECT capacity FROM trial_classes WHERE id = $1 FOR UPDATE`, then count and
  confirm. That serializes confirmations per class instead of per database.
- Replace the count-based trigger: under READ COMMITTED two transactions can
  both count 3 and both insert. Use a `confirmed_count` column with
  `CHECK (confirmed_count <= capacity)`, incremented with
  `UPDATE ... SET confirmed_count = confirmed_count + 1 WHERE id = $1 AND confirmed_count < capacity`.
  The row lock plus the re-check of the WHERE clause make it safe, and the
  CHECK is the backstop.
- On Supabase this becomes a SQL function called over RPC, because the claim
  has to be a single transaction.

## Backend design

### Data model

```
parents 1───* students 1───* bookings *───1 trial_classes
                                  1
                                  │
                                  * payment_attempts
```

| Table | Key columns | Notes |
| --- | --- | --- |
| `parents` | id, name, email (unique) | |
| `students` | id, parent_id, name, level (1 to 6) | Primary school levels |
| `trial_classes` | id, subject, title, teacher_name, starts_at (UTC), duration_minutes, capacity (default 4, CHECK 1 to 4), price_cents, currency | |
| `bookings` | id, student_id, trial_class_id, status, cancel_reason, created_at, updated_at, confirmed_at | Partial unique index and capacity triggers live here |
| `payment_attempts` | id, booking_id, amount_cents, currency, payment_method, status, provider_ref, failure_code | One row per attempt; the id is the provider idempotency key. Never stores card numbers |

The full schema, with the constraints and triggers, is `src/db/schema.sql`.

### Booking statuses

| Status | Meaning | Holds a seat | On roster |
| --- | --- | --- | --- |
| `pending_payment` | Booking started, not paid yet | No | No |
| `payment_failed` | Last payment attempt failed; the parent can retry | No | No |
| `confirmed` | Paid (authorized, then captured) and holding a seat | Yes | Yes |
| `cancelled` | Closed by the system. `cancel_reason` is `class_full` (lost the last seat) or `booking_closed` (class started first) | No | No |

```
pending_payment ──card declined──────────────────► payment_failed ──retry──► (same paths)
pending_payment ──authorized, seat claimed───────► confirmed
pending_payment ──class full or started──────────► cancelled (class_full | booking_closed)
confirmed       ──capture failed (rare)──────────► payment_failed   (seat released, hold voided)
```

Payment attempts: `processing` → `authorized` or `declined`; `authorized` →
`captured`, `voided` or `capture_failed`; `capture_failed` → `voided` once the
hold is released.

### API

Mock authentication: the caller sends `x-user-id` (a parent id, or
`staff_ops`). Authorization checks run on that id as they would on a real
session.

| Endpoint | Who | Purpose and responses |
| --- | --- | --- |
| `GET /api/trial-classes` | Anyone | Upcoming classes with `confirmedCount` and `seatsLeft` |
| `POST /api/bookings` `{studentId, trialClassId}` | Parent | `201` new booking; `200` the child's existing unpaid booking for that class; `409` `already_booked`, `class_full` or `booking_closed`; `404` if the child is not the parent's |
| `GET /api/bookings`, `GET /api/bookings/:id` | Parent | Own bookings with their payment attempts; another family's booking is a `404` |
| `POST /api/bookings/:id/payments` `{paymentMethod}` | Parent | Every payment outcome returns `{outcome, message, booking, paymentAttempt}`: `200` confirmed; `402` declined; `409` class full, booking closed, or already confirmed (nothing charged). Requests that cannot be processed at all (validation, another family's booking, a cancelled booking) return `{error}` with `400`, `404` or `409 not_payable` |
| `GET /api/staff/trial-classes/:id/roster` | Staff | Confirmed children (the roster), plus every other booking for the class under `notOnRoster` |
| `GET /api/demo/users` | Demo only | Feeds the sign-in switcher and test cards |

The backend functions behind these are `createBooking`, `payForBooking`
(with `claimSeat`) and `getRoster` in `src/domain/`.

### How duplicates are prevented

- **Application:** `createBooking` looks for a live booking for the same child
  and class. A confirmed one is `409 already_booked`. An unpaid one is returned
  instead of creating another, which makes booking idempotent: a double click,
  a second tab, or coming back after a declined card all land on the same
  booking.
- **Database:** partial unique index `bookings_one_live_per_student_class` on
  `(student_id, trial_class_id)` for `pending_payment`, `payment_failed` and
  `confirmed`. Cancelled rows are excluded so a child can book again later.
- **Double payment:** two payments for the same booking can both be
  authorized, but only one can confirm it; the other sees `confirmed` in
  `claimSeat()` and is voided. Charged once (tested).

### How payment failure is handled

- **Declined card:** the attempt becomes `declined`, the booking
  `payment_failed`. The roster only ever reads `confirmed` bookings, and unpaid
  bookings never held a seat, so there is nothing to undo. The parent can retry.
- **Provider error or timeout:** treated as a decline (`provider_error`) so the
  parent can retry. A timeout can hide a successful authorization; the attempt
  id is sent as the idempotency key so a reconciliation job can find and void it.
- **Capture fails after the seat was claimed:** the seat is released, the
  booking goes to `payment_failed`, and the authorization is voided so a retry
  does not stack a second hold on the card. The attempt keeps
  `failure_code = capture_failed`. With a real provider a capture error can be
  ambiguous (a timeout after the money moved), so the reconciliation job checks
  these attempts with the provider before anyone retries or refunds.
- **Void fails:** the attempt keeps its status (`authorized`, or
  `capture_failed` after a failed capture) and the error is logged; the hold
  lapses at the issuer, and the reconciliation job would void it sooner.

### Where each check lives

| Layer | Checks |
| --- | --- |
| UI | Disables full classes, shows seats left, locks buttons while a request runs. Convenience only; the data can be stale by the time the parent clicks |
| Backend | Parent owns the child and the booking (else `404`); request validation (zod); class not started; advisory seat check when booking; refusal before payment if the class is full; the binding seat claim under the write lock; guarded state transitions; capture or void to match the outcome |
| Database | Partial unique index (duplicates), capacity triggers (overbooking), CHECK constraints on statuses, amounts and capacity, foreign keys |
| Background jobs (not built) | Expire unpaid bookings after a while; reconcile payment attempts stuck in `processing` or `authorized`; send confirmations; send the final roster to the teacher before class; periodic invariant checks |

## Tests and verification

`npm test` runs 47 tests with Node's built-in runner. Each test gets its own
temporary database, and every test fails if it leaves a transaction open on
the connection.

| File | Covers |
| --- | --- |
| `last-seat-race.test.ts` | The brief's scenario in exact order; A paying after B; 12 parents paying at once (1 confirmed, 11 voided); a double-submitted payment charged once |
| `multiprocess-race.test.ts` | 10 separate OS processes, each with its own connection, pay for the last seat at the same instant: exactly 1 confirmed, nothing left authorized |
| `write-lock.test.ts` | With two connections to one file: `withWriteLock` blocks other writers from its first statement (a deferred `BEGIN` fails this), rolls back on errors, refuses async work |
| `booking-flow.test.ts` | Seed cases, idempotent booking, duplicates, another family's child, full and started classes, success, decline and retry, capture failure, paying after start, paying twice; overlapping payments: the class starting mid-authorization, a decline and a success on one booking in both orders, a decline arriving after a cancellation |
| `db-invariants.test.ts` | Raw SQL that skips the application: duplicate live booking, fifth confirmed seat (insert and update), lowering capacity, invalid statuses |
| `api.test.ts` | HTTP status codes, auth and ownership, staff-only roster, validation (including a 413 for an oversized body), the race and decline over HTTP |

To check that the race tests can fail, I broke the code on purpose and ran
them (then reverted):

- **Seat re-check removed from `claimSeat()`, triggers kept:** the triggers
  rejected every extra confirmation (`class_full` constraint errors). No class
  was overbooked, but the requests errored, so 3 race tests failed.
- **Re-check and triggers both removed** (the naive "check before paying"
  design): the brief's scenario confirmed A as well (5 of 4), the in-process
  crowd confirmed 12 children into one seat, and the 10-process test confirmed
  10. All 3 race tests failed.
- **After the code review** (see AI_USAGE.md), four more deliberate breaks
  were each caught by a test: dropping the `ROLLBACK`, using a deferred
  `BEGIN` instead of `BEGIN IMMEDIATE`, not voiding the hold after a failed
  capture, and a late decline ignoring a cancelled booking.

I also ran the two-window race, the duplicate case and the staff roster in a
real browser.

## Assumptions

- A child can have at most one live booking per class, but can book trials in
  different classes (Ottodot offers trials in both Math and Science).
- Booking closes when the class starts. A real cut-off (for example 2 hours
  before, so teachers get a final roster) is a product decision and a
  one-line change.
- A trial costs SGD 20 in the seed data; times are shown in Singapore time.
- Card payments go through a provider that supports manual capture
  (authorize, then capture or void), as Stripe, Adyen and most acquirers do.
- Parents are authenticated upstream. The `x-user-id` header stands in for a
  session.
- Capacity is stored per class (default 4) so ops can run a smaller class; the
  schema caps it at 4.

## What I cut

- Real authentication, staff roles and teacher-specific rosters.
- A real payment provider, webhooks and refunds.
- Cancellation by parents or staff, and a waitlist.
- Seat holds during checkout (see the race section for why).
- Emails and notifications.
- Admin screens to create or edit classes.
- Rate limiting, pagination, deployment.
- Browser end-to-end tests (the UI flows were checked in Chrome instead; see
  Verification).

## What I would monitor after release

- **Invariant alarms that should always read zero:** classes with more
  confirmed bookings than capacity; children with two live bookings for one
  class; confirmed bookings without a captured payment after a few minutes;
  payment attempts stuck in `processing` or `authorized`.
- **Race losses:** how often a parent is authorized and then refused with
  `class_full`, per class. This is the number that decides whether seat holds
  are worth building.
- **Payments:** decline rate, provider latency and error rate, capture and void
  failures.
- **Funnel:** bookings created versus paid; unpaid bookings abandoned.
- **Database:** lock wait time and busy errors, latency of the claim
  transaction.
- **Roster accuracy:** roster sent to the teacher versus attendance at class
  start.

## What I would do next

1. Move to Postgres with the per-class row lock and counter described above,
   and run this same test suite against a real Postgres in CI.
2. Integrate a real provider: webhooks with idempotency keys, and capture or
   void through an outbox so a crash between commit and capture is retried.
   Accept an `Idempotency-Key` header on the payment endpoint too, so a client
   retry replays the original response instead of getting `409 already confirmed`.
3. Add the reconciliation job for stuck payment attempts and an expiry job for
   old unpaid bookings.
4. Add seat holds only if the race-loss metric says parents are hitting it.
5. Cancellation with refunds, and a waitlist that offers the freed seat.
6. Real authentication and roles; teachers only see their own classes.
7. A Playwright test for the two-window race.

## Time spent

About 1 hour of wall-clock time on 29 September 2026, in one Claude Code
session (details in AI_USAGE.md). Roughly 15 minutes for the design, backend
and tests; 10 minutes for the page, the CLI tools and checking the race in a
real browser; 25 minutes for an independent review, the fixes it led to, and
these documents. Reading through the code myself and recording the
walkthrough are not included.

## Project layout

```
src/
  app.ts                 HTTP routes, mock auth, error mapping
  server.ts              entry point: open DB, seed on first run, listen
  db/schema.sql          tables, constraints, triggers
  db/database.ts         connection setup and withWriteLock (BEGIN IMMEDIATE)
  db/seed.ts             synthetic demo data
  domain/bookings.ts     createBooking, payForBooking, claimSeat
  domain/queries.ts      read side: classes, bookings, roster
  payments/              provider interface and mock provider
  cli/                   roster, db reset, race demo, multi-process pay worker
web/                     browser page (vanilla JS, no build)
test/                    node:test suites and helpers
```
