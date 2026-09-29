# Trial booking monorepo

Parents book and pay for 4-seat trial classes; staff see rosters. See `README.md` for the design and
`doc/agent-workspace/Architecture.md` for the API contract.

## Layout

npm workspaces: `apps/api` (Express 4, Sequelize 6, Postgres; `src/index.ts` API, `src/worker.ts` jobs),
`apps/web` (React 19, Rspack, Tailwind 3), `apps/payments-sandbox`, `packages/shared` (built with tsc,
build it first), `packages/ui` (raw TS). E2E tests in `e2e/`, deploy in `.deploy/` and `.github/workflows/`.

## Commands

- `npm run setup` once: `.env` with random secrets, local Postgres on 127.0.0.1:55432, migrations, seed.
- `npm run dev`: sandbox 4002, API 4001, worker, web 4000. Demo password `trial-demo-2026`.
- `npm run test:unit`, `npm run test:integration` (needs `npm run db:start`), `npm run test:e2e`.
- `npm run lint`, `npm run lint:prose`, `npm run typecheck`, `npm run build`.
- New migration: `npm run migrate:create -w @trial-booking/api -- <name>` (writes a `.cjs` file).

## Invariants (do not weaken)

- Only step 3 of `PaymentsService.pay` (`payments.service.ts`) confirms a booking, with the class row
  locked first (`TrialClass.findByPk(..., { lock: LOCK.UPDATE })`), then the booking row. Keep that lock
  order everywhere (see the compensation in `payment-jobs.service.ts`) to avoid deadlocks.
- Never call the payment provider inside a database transaction. Capture and void go through the
  `payment_jobs` outbox written in the same transaction as the seat decision.
- `trial_classes.confirmed_count` is written only by the trigger in migration `20260929100200`.
- One live booking per child and class is enforced by the partial unique index; keep the API's
  idempotent "return the existing unpaid booking" behaviour in step with it.
- Another family's records answer `404`, not `403`.

## Conventions

- Tabs, single quotes, semicolons, trailing commas (`.editorconfig`, ESLint 9 flat config).
- API modules: `modules/<name>/<name>.{controller,service}.ts`, singleton services, `ApiError.of(code)`
  with codes from `packages/shared` `ERROR_STATUS`, envelope `{ success, data | error }`.
- Read configuration from `config/env.ts` (zod validated), never `process.env` in feature code.
  Log with `config/logger.ts` (JSON lines, credential keys redacted).
- Tests use `node:test` through tsx; names read `should <expected> when <condition>`.
- Writing: no em dashes and no filler words anywhere (enforced by `npm run lint:prose`).
- Commits: Conventional Commits, `type(scope): lowercase summary`.
