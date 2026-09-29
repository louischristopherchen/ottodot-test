# Ottodot trial booking

Parents book and pay for a trial class for their child; staff see an accurate roster before the
class starts. Every trial class has 4 seats, and the system keeps that true under duplicate
submissions, declined or failed payments, and two parents paying for the last seat at the same time.

The brief asked for the smallest working slice. That version (SQLite, one package, about an hour of
work) is kept at the git tag [`take-home-slice`](../../tree/take-home-slice). `main` takes the same
design to production level: Postgres with row locks, real authentication, a payment outbox with a
background worker, hardening, three test layers and a deploy pipeline.

## Quick start

Requires Node 24 and PostgreSQL 14 or later (the server binaries, for a project-local database, or
any reachable Postgres through `DATABASE_URL`). No Docker.

```bash
npm install
npm run setup      # .env with random secrets, local Postgres on 127.0.0.1:55432, migrations, demo data
npm run dev        # payments sandbox :4002, API :4001, worker, web :4000
```

Open http://localhost:4000 and pick a demo account on the sign-in page. Every demo account uses the
password `trial-demo-2026`.

| Command | What it does |
| --- | --- |
| `npm run test:unit` | 101 unit tests, no database (shared, API, sandbox, web) |
| `npm run test:integration` | 62 API tests against a real Postgres (`npm run db:start` first) |
| `npx playwright install chromium` then `npm run test:e2e` | 11 browser tests; starts its own stack on ports 4100 to 4102 |
| `npm run lint`, `npm run lint:prose`, `npm run typecheck` | ESLint, a check for em dashes and filler words, TypeScript |
| `npm run db:reset` | Wipe and reseed the demo data (class times are relative to now) |
| `npm run db:start`, `npm run db:stop` | Project-local Postgres in `.pgdata/` (git-ignored, loopback only) |
| `npm run build` | Production build of every app |

## Demo guide

| Case from the brief | Seed data | How to see it |
| --- | --- | --- |
| Class with seats | "Sink or float?" has 1 of 4 confirmed | Any parent books a free child and pays with Visa 4242 |
| Exactly 3 confirmed | "Fractions with pizza": Noah, Lucas, Yuki | Shown as "Last seat" |
| Full class | "Magnets: push and pull" has 4 of 4 | Disabled in the page; the API answers `409 CLASS_FULL` |
| Duplicate booking | Leo is confirmed in "Sink or float?" | Sign in as Ben Carter, pick Leo and that class: "Leo Carter already has a confirmed seat in this class." |
| Payment failure | Sofia's card was declined for "Sink or float?" | Staff roster lists her under "Not on the roster". Live: pay with Visa 0002, then retry with Visa 4242 |
| Capture failure | none | Pay with Visa 0341: the seat is released and the hold voided |

The last-seat race in the browser (use a private window for the second parent, because a browser
keeps one session cookie):

1. Window 1, Aisha Rahman: pick Zara and "Fractions with pizza", Continue to payment.
2. Window 2, Chloe Tan: pick Ethan and the same class, Continue to payment. Neither booking holds the seat yet.
3. Window 1: pay with Visa 1881, the slow test card (about 10 seconds).
4. Window 2, within those 10 seconds: pay with Visa 4242. Ethan is confirmed.
5. Window 1 then shows: "The last seat was taken while your payment was processing. The hold on your card is released, so you were not charged."
6. Sign in as staff: the roster shows 4 of 4, with Zara under "Not on the roster", cancelled (class full).

## What is in the repo

| Workspace | What |
| --- | --- |
| `apps/api` | Express 4 API (`src/index.ts`) and background worker (`src/worker.ts`); Sequelize 6 on Postgres; migrations in `migrations/` |
| `apps/web` | React 19 SPA bundled with Rspack; TanStack Query, zustand, react-hook-form, Tailwind 3 |
| `apps/payments-sandbox` | Fake card provider with manual capture: authorize, capture, void, lookup by idempotency key |
| `packages/shared` | Constants, DTO types and zod validators shared by the API and the web app |
| `packages/ui` | Radix and cva components with the `cn` helper |
| `e2e/` | Playwright tests |
| `.deploy/`, `ecosystem.config.cjs`, `.github/workflows/` | nginx, VPS provisioning and runbook, PM2, CI and deploy |
| `doc/agent-workspace/` | Architecture (API contract) and Design (UI spec) |

## The last-seat race

### Approach

A seat is taken only when a booking becomes `confirmed`, and only one step does that. Payment runs
in four steps (`apps/api/src/modules/payments/payments.service.ts`):

1. **Start** (short transaction, booking row locked): check the booking belongs to the parent and is
   payable. If the class is full or has started, cancel the booking before touching the card.
   Otherwise record a `processing` payment attempt; its id is the provider idempotency key.
2. **Authorize** the card. No transaction is open during this slow external call, and this is the
   window in which another parent can take the last seat.
3. **Claim the seat**: in one transaction, lock the class row
   (`TrialClass.findByPk(id, { lock: transaction.LOCK.UPDATE })`), then the booking row, re-read the
   confirmed count and decide (`decideSeatClaim` in `booking-rules.ts`). The same transaction writes
   a `capture` or `void` job to the `payment_jobs` outbox.
4. **Move the money**: run that job at once. If it cannot finish, the worker retries it.

The brief's scenario:

| Step | What happens | State |
| --- | --- | --- |
| A picks the last seat and moves to payment | Booking A `pending_payment`; A's authorization starts | 3 of 4. Unpaid bookings hold no seat |
| B picks the same seat | Booking B is allowed: 3 < 4 | Two unpaid bookings for one seat |
| B completes payment first | B authorized; the claim locks the class, sees 3 of 4, confirms B; capture | 4 of 4 |
| A's payment completes | A authorized; the claim waits for B's lock, then sees 4 of 4: A cancelled (`class_full`), void | A is told the seat went and that the card was not charged |

If A only presses Pay after B is confirmed, step 1 refuses before the card is touched.

The database refuses the fifth seat on its own. `trial_classes.confirmed_count` is maintained by a
trigger on `bookings` and guarded by `CHECK (confirmed_count BETWEEN 0 AND capacity)`. The trigger's
update takes the class row lock, so two transactions confirming at once are serialized per class
even under READ COMMITTED, and the second one fails the CHECK. A buggy code path or a manual SQL fix
cannot overbook.

### Why this approach

- **The rule is checked where it becomes true.** "At most 4 confirmed" can only break at the moment
  of confirmation, so the one binding check sits there, under a lock. Seat counts in the page and the
  early refusal in step 1 are conveniences that can be stale.
- **Per-class lock.** Locking the class row serializes confirmations for that class only; other
  classes are not affected.
- **Authorize first, capture after.** The parent who loses the race only ever had a hold, which is
  released at once. No refunds.
- **Outbox, not "call the provider after commit and hope".** The capture or void is committed with
  the seat decision, so the money always ends up matching the seat even if the process dies right
  after the commit.
- **No seat holds.** With 4 seats, one abandoned checkout would block a quarter of the class until the
  hold expires, and holds still need the confirm-time check for payments that finish late. They can
  be added on top later if the race-loss metric says parents hit it.

### Trade-offs accepted

- A parent can reach the payment step and still lose the seat, when two parents pay for the same last
  seat within seconds. The loser gets a clear message and is not charged.
- Between the claim and the capture, a booking is `confirmed` with the money only authorized. A
  temporary capture failure is retried with backoff; if the capture is refused for good, the seat is
  released, the booking goes back to `payment_failed` and the hold is voided.
- Seats are never granted in the background. If an authorization is found after its request died,
  reconciliation voids it and the parent pays again.

## Backend design

### Data model

```
users (parents, staff) 1──* students 1──* bookings *──1 trial_classes
users 1──* sessions                         bookings 1──* payment_attempts 1──* payment_jobs
users 1──* idempotency_keys
```

| Table | Key columns | Guarantees |
| --- | --- | --- |
| `users` | email (unique, case-insensitive), role `parent` or `staff`, password_hash, failed_login_count, locked_until | |
| `sessions` | family_id, refresh_token_hash (unique), replaced_by_id, expires_at, revoked_at, revoked_reason | Only the SHA-256 of a refresh token is stored |
| `students` | parent_id, name, level (Primary 1 to 6) | CHECK on level |
| `trial_classes` | subject, title, teacher_name, starts_at, capacity (1 to 4), confirmed_count, price_cents, currency | CHECK `confirmed_count BETWEEN 0 AND capacity` |
| `bookings` | student_id, trial_class_id, status, cancel_reason, confirmed_at | Partial unique index: one live booking per child and class; trigger keeps confirmed_count exact; CHECKs tie cancel_reason and confirmed_at to the status |
| `payment_attempts` | booking_id, amount_cents, currency, payment_method (a token, never a card number), status, provider_ref, failure_code | |
| `payment_jobs` | payment_attempt_id, kind `capture` or `void`, status, attempts, run_after, locked_until | Unique per attempt and kind |
| `idempotency_keys` | user_id, key, request_hash, state, response | Unique per user and key |

### Statuses

| Booking status | Meaning | Holds a seat | On roster |
| --- | --- | --- | --- |
| `pending_payment` | Booking started, not paid | No | No |
| `payment_failed` | Last attempt failed; the parent can retry | No | No |
| `confirmed` | Seat claimed, funds authorized then captured | Yes | Yes |
| `cancelled` | Closed by the system: `class_full`, `booking_closed` (class started) or `expired` (unpaid too long) | No | No |

```
pending_payment --declined---------------------> payment_failed --retry--> (same paths)
pending_payment --authorized, seat claimed-----> confirmed
pending_payment --class full or started--------> cancelled (class_full | booking_closed)
pending_payment --unpaid for 30 minutes--------> cancelled (expired)            [worker]
confirmed       --capture refused for good-----> payment_failed (seat released, hold voided)
```

Payment attempts: `processing` to `authorized` or `declined`; `authorized` to `captured` or `voided`;
`capture_failed` then `voided`. Payment jobs: `pending` to `done`, or `failed` after the retries.

### API

Base path `/api`, response envelope `{ success, data }` or `{ success: false, error: { code, message, details? } }`.
The full contract is in `doc/agent-workspace/Architecture.md`.

| Endpoint | Who | Notes |
| --- | --- | --- |
| `POST /api/auth/login`, `/refresh`, `/logout`, `GET /api/auth/me` | Public / signed in | Access token in the body, refresh token only in an httpOnly cookie |
| `GET /api/trial-classes` | Signed in | Upcoming classes with seats left |
| `GET /api/students` | Parent | Own children |
| `POST /api/bookings`, `GET /api/bookings`, `GET /api/bookings/:id` | Parent | `201` new or `200` the existing unpaid booking; `409 ALREADY_BOOKED`, `CLASS_FULL`, `BOOKING_CLOSED`; another family's records are `404` |
| `POST /api/bookings/:id/payments` | Parent | Optional `Idempotency-Key`; `200` with `outcome` for every processed payment (`confirmed`, `payment_declined`, `class_full`, `booking_closed`, `already_confirmed`) |
| `GET /api/staff/trial-classes/:id/roster` | Staff | Confirmed children, plus everything else under `notOnRoster` |
| `GET /health`, `GET /health/ready` | Public | Liveness, and readiness with a database check |

### Duplicates

- **API:** booking the same child and class again returns the existing unpaid booking (double click,
  second tab, retry after a decline); a confirmed one is `409 ALREADY_BOOKED`.
- **Database:** partial unique index on `(student_id, trial_class_id)` for the live statuses. Two
  identical requests at the same moment produce one booking (tested); the loser of the insert gets
  the existing booking back.
- **Double payment:** two payments for one booking can both be authorized, but only one confirms; the
  other sees `confirmed` under the lock and is voided. With an `Idempotency-Key`, a retry replays the
  first response instead of running again, and a concurrent retry gets `409 REQUEST_IN_PROGRESS`.

### Payment failure

| Failure | What happens |
| --- | --- |
| Card declined | Attempt `declined`, booking `payment_failed`, seat untouched (it was never held); the parent can retry |
| Provider timeout or 5xx while authorizing | Booking `payment_failed` so the parent can retry at once; the attempt stays `processing` and the worker's reconciliation asks the provider later and voids any authorization it finds |
| Capture fails briefly | Seat kept; the capture job retries with backoff (10 s, 20 s, 40 s and so on) |
| Capture refused for good, or retries exhausted | Seat released (booking `payment_failed`), attempt `capture_failed`, then the hold is voided |
| Void fails | Logged at error level for an alert; the hold lapses at the issuer |

### Where each check lives

| Layer | Checks |
| --- | --- |
| Web app | Disables full classes, shows seats left, locks the form while a request runs, sends an Idempotency-Key per Pay click. Convenience only |
| API | Authentication and roles; ownership (`404` for another family's records); zod validation; class not started; advisory seat check at booking; refusal before authorizing a full class; the binding claim under the class row lock; guarded status transitions; idempotency keys; rate limits |
| Database | Partial unique index, trigger-maintained count with CHECK, status CHECKs, foreign keys |
| Worker (`apps/api/src/worker.ts`) | Retries payment jobs, reconciles attempts stuck in `processing`, expires unpaid bookings, purges old sessions and idempotency keys |

## Production concerns

- **Authentication:** JWT access token (30 minutes, `iss`, `aud` and `type` verified, session checked
  on every request so logout takes effect at once) kept in memory by the SPA, never in web storage.
  Refresh token in an httpOnly, `SameSite=Strict`, `Path=/api/auth` cookie, rotated on every use;
  reusing an old token revokes the whole session family, with a 10 second grace window for two tabs
  refreshing together. Origin allow-list on the cookie routes. bcryptjs with a dummy hash for unknown
  emails and a lockout ladder after five failures.
- **Hardening:** validated environment (the process refuses to start with a missing secret), helmet
  with a JSON-only CSP, CORS allow-list, rate limits (global, per IP and email for login, per user for
  payments), 16 KB body limit, `trust proxy` for nginx, 5xx messages masked.
- **Observability:** one JSON log line per request with a request id (also returned as `X-Request-Id`),
  credential-looking keys redacted; worker steps log counts; `/health` and `/health/ready`.
- **Operations:** graceful shutdown on SIGTERM and SIGINT for the API and the worker; the worker is
  safe to run on more than one host (jobs are claimed with `SKIP LOCKED` and a lease).
- **Deploy:** PM2 runs the API, the worker and the sandbox on loopback; nginx serves the SPA and
  proxies `/api`; `.deploy/README.md` is the runbook. CI runs lint, the prose check, typecheck, unit,
  integration (native Postgres on the runner) and e2e tests; deploy pins every action to a commit SHA
  and checks `/health/ready` after `pm2 startOrReload`.

## Tests

| Layer | Where | What it proves |
| --- | --- | --- |
| Unit (101) | `*/src/__tests__/` | Seat decisions, outcome messages, backoff, token claims, password lockout, provider error classification, error mapping, redaction, the web API client (refresh once, retry with the same Idempotency-Key), formatters |
| Integration (62) | `apps/api/src/__tests__/integration/` | Against Postgres: the brief's race in exact order (a fake provider pauses A until B finishes), 12 parents paying at once (1 confirmed), a double submit charged once, a proof that the claim waits on the class row lock, raw SQL that tries to overbook, auth rotation and reuse detection, idempotency, the worker's retries, reconciliation and expiry, and the sandbox client against the real sandbox process |
| End to end (11) | `e2e/` | Playwright against the real stack: sign-in and the httpOnly session, book and pay, decline then retry, duplicate refused, the race in two browsers, staff roster, role redirects |

The slice (tag `take-home-slice`) also recorded mutation checks: with the seat re-check and the
database backstop removed, the race tests confirmed 5 of 4, 12 of 1 and 10 of 1 seats and failed.

## Assumptions

- A child has at most one live booking per class, but can book trials in different classes.
- Booking closes when the class starts; a cut-off before class (for a final roster) is one line.
- A trial costs SGD 20 in the seed data; times are shown in Singapore time.
- The card provider supports manual capture (authorize, then capture or void), as Stripe and Adyen do.
  The sandbox stands in for it; a real adapter implements the same `PaymentProvider` interface.
- Parents and staff have accounts created by the business; there is no self sign-up.

## What I cut

- Self sign-up, password reset and email verification.
- A real payment provider adapter and its webhooks; refunds.
- Cancellation by parents or staff, and a waitlist.
- Seat holds during checkout (see above).
- Emails and notifications; admin screens for classes; teacher-specific rosters.
- Metrics export (Prometheus or similar) and alerting rules; the log lines are ready for them.

## What I would monitor after release

- **Invariants that should read zero:** classes with `confirmed_count` different from their confirmed
  bookings; confirmed bookings whose attempt is not `captured` after a few minutes; `payment_jobs` in
  `failed`; attempts stuck in `processing` past the reconcile window.
- **Race losses:** payments authorized and then refused with `class_full`, per class. This decides
  whether seat holds are worth building.
- **Payments:** decline rate, provider latency and errors, capture retries, void failures.
- **Security:** failed logins and lockouts, refresh-token reuse detections, 429s.
- **Funnel:** bookings created versus paid; bookings expired unpaid.
- **Database:** lock wait time on `trial_classes`, pool saturation, p95 of the claim transaction.

## What I would do next

1. A real provider adapter (for example Stripe with manual capture) and its webhooks, feeding the same outbox.
2. Metrics and alerts for the numbers above.
3. Cancellation with refunds, and a waitlist that offers a freed seat.
4. Password reset and email verification; admin screens for classes and teachers.
5. Seat holds, only if the race-loss metric shows parents hitting it.

## Time spent

TIME_SPENT_PLACEHOLDER

## AI usage

See [AI_USAGE.md](AI_USAGE.md).
