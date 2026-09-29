# Architecture

Trial class booking. Parents book and pay for a trial class (4 seats), staff see the roster.
The API contract below is the source of truth for `apps/web`; types live in `packages/shared`.

## Apps and ports

| Workspace | What | Dev port | E2E port |
| --- | --- | --- | --- |
| `apps/web` | React 19 SPA, Rspack, Tailwind 3 | 4000 | 4100 |
| `apps/api` | Express 4 API (`src/index.ts`) and background worker (`src/worker.ts`) | 4001 | 4101 |
| `apps/payments-sandbox` | Fake card provider (authorize, capture, void) | 4002 | 4102 |
| `packages/shared` | Constants, DTO types, zod validators (build first) | | |
| `packages/ui` | Radix + cva components, `cn` helper (raw TS) | | |

Production: nginx serves `apps/web/dist` and proxies `/api` and `/health` to the API on loopback.
PM2 runs `api`, `worker` and `payments-sandbox`. No Docker.

## API

Base path `/api`. Every response uses the envelope:

- success: `{ "success": true, "data": ... }`
- error: `{ "success": false, "error": { "code": "CLASS_FULL", "message": "...", "details": { "field": ["..."] } } }`

Error codes and their HTTP status are in `ERROR_STATUS` (`packages/shared/src/constants.ts`).

### Auth

Access token: JWT (HS256, 30 minutes), sent as `Authorization: Bearer <token>`, kept in memory by the SPA only.
Refresh token: opaque, rotated on every use, in an httpOnly cookie `tb_refresh` (`SameSite=Strict`, `Path=/api/auth`, `Secure` in production). The SPA never reads it.

| Method and path | Body | Success `data` | Errors |
| --- | --- | --- | --- |
| `POST /api/auth/login` | `{ email, password }` | `SessionDto` (+ sets cookie) | 400 `VALIDATION_ERROR`, 401 `INVALID_CREDENTIALS`, 429 `ACCOUNT_LOCKED` / `RATE_LIMITED` |
| `POST /api/auth/refresh` | none (cookie) | `SessionDto` (+ rotates cookie) | 401 `UNAUTHORIZED` (cookie cleared) |
| `POST /api/auth/logout` | none (cookie) | `{ loggedOut: true }` (cookie cleared) | |
| `GET /api/auth/me` | | `UserDto` | 401 |

SPA flow: on load, call `POST /api/auth/refresh`; 200 means signed in, 401 means show the login page.
On any 401 with code `TOKEN_EXPIRED` or `UNAUTHORIZED` from another endpoint, refresh once (single flight) and retry the request with the same headers (including `Idempotency-Key`); if the refresh fails, go to the login page.

### Parent endpoints (role `parent`)

| Method and path | Body / headers | Success `data` | Errors |
| --- | --- | --- | --- |
| `GET /api/students` | | `StudentDto[]` (own children) | |
| `GET /api/trial-classes` (any role) | | `TrialClassDto[]` upcoming, soonest first | |
| `POST /api/bookings` | `{ studentId, trialClassId }` | `CreateBookingResultDto`; HTTP 201 when created, 200 when the child's unpaid booking was resumed | 404 `NOT_FOUND`, 409 `ALREADY_BOOKED`, `CLASS_FULL`, `BOOKING_CLOSED` |
| `GET /api/bookings` | | `BookingDto[]` newest first | |
| `GET /api/bookings/:id` | | `BookingDto` | 404 |
| `POST /api/bookings/:id/payments` | `{ paymentMethod }`, header `Idempotency-Key: <uuid>` | `PaymentResultDto` (HTTP 200 for every outcome) | 404, 409 `NOT_PAYABLE`, 409 `REQUEST_IN_PROGRESS`, 422 `IDEMPOTENCY_KEY_REUSED` |

`PaymentResultDto.outcome` is one of `confirmed`, `payment_declined`, `class_full`, `booking_closed`, `already_confirmed`; `message` is a sentence to show the parent as is.

### Staff endpoints (role `staff`)

| Method and path | Success `data` |
| --- | --- |
| `GET /api/staff/trial-classes/:id/roster` | `RosterDto` |

### Health

`GET /health` liveness, `GET /health/ready` checks the database. Not under `/api`.

## Environment

`apps/api` (validated by zod in `src/config/env.ts`; see `.env.example`):
`NODE_ENV`, `PORT` (4001), `BIND_HOST` (127.0.0.1), `DATABASE_URL`, `JWT_SECRET` (32+ chars), `JWT_ACCESS_TTL` (30m), `REFRESH_TTL_DAYS` (7),
`CORS_ORIGIN` (comma separated), `COOKIE_SECURE`, `TRUST_PROXY`, `PAYMENT_PROVIDER_URL`, `PAYMENT_PROVIDER_API_KEY`, `PAYMENT_PROVIDER_TIMEOUT_MS`,
`LOG_LEVEL`, `BCRYPT_COST`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX`, `PAYMENT_RATE_LIMIT_MAX`,
`UNPAID_BOOKING_TTL_MINUTES`, `WORKER_INTERVAL_MS`, `PAYMENT_JOB_MAX_ATTEMPTS`, `RECONCILE_AFTER_SECONDS`.

`apps/payments-sandbox`: `SANDBOX_PORT` (4002), `SANDBOX_BIND_HOST`, `SANDBOX_API_KEY` (same value as `PAYMENT_PROVIDER_API_KEY`), `SANDBOX_LATENCY_MS` (800), `SANDBOX_SLOW_LATENCY_MS` (10000).

`apps/web` (build time): `WEB_PORT` (4000), `API_URL` (dev proxy target, default `http://127.0.0.1:4001`), `SHOW_DEMO_ACCOUNTS` (`true` shows the seeded demo logins on the login page).

## Data and concurrency

Postgres via Sequelize. The last seat is decided in one transaction that locks the class row
(`TrialClass.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE })`) and re-checks the seat count.
`trial_classes.confirmed_count` is maintained by a trigger and guarded by `CHECK (confirmed_count <= capacity)`,
so the database refuses a fifth confirmed seat whatever code path writes it. A partial unique index allows one live booking per child and class.

Payment: authorize (no transaction open) → claim seat (locked transaction, also writes a capture or void job to the `payment_jobs` outbox) → run the job inline; the worker retries failed jobs, reconciles stuck attempts and expires stale unpaid bookings.
