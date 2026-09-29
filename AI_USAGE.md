# AI usage

The work happened in two phases on the same day: the scoped take-home slice (tag
`take-home-slice`), then a rebuild of the same design to production level on `main`.

## Tools

- **Claude Code** (Anthropic's command-line coding agent) running Claude Opus 5.5, in one session.
  It ran shell commands, edited files, and drove Chrome through the Claude in Chrome extension.
- **Specialist sub-agents** from my own Claude Code agent team, each started with a written brief:
  - a researcher that read my other projects and reported the modules, versions and conventions I
    normally use, so the rebuild would match my house style;
  - a frontend engineer that built `apps/web` and `packages/ui` against a written API contract and
    design spec;
  - a production engineer that wrote the PM2, nginx, VPS setup, CI and deploy files;
  - code reviewers (one for the slice, one for the rebuild) and a security auditor, each with a fresh
    context, read-only, asked to verify findings before reporting them.

No other AI tools were used.

## What I used AI for

- Turning the brief into a design and, later, into a production architecture: where the one binding
  seat check lives, authorize / capture / void around it, the outbox, the auth model.
- Writing the code, tests, seed data and the first drafts of the documents.
- Running everything: type checks, three test layers, the page in a real browser.
- Independent review: a correctness review and a security audit of the finished code.

## One place where AI made me faster

Contract-first parallel work. Before any feature code, the API contract (`doc/agent-workspace/Architecture.md`)
and the UI spec (`Design.md`) were written down. The frontend and the deploy setup were then built
by separate agents at the same time as the backend, against those documents, and fitted together
with small adjustments (a staff display name, the radio buttons' stacking order and two dev-server settings). The research agent
also mapped my conventions across six of my repositories in a few minutes, down to the exact
versions, the `ApiError` shape and the lock idiom I use (`findByPk(id, { lock: transaction.LOCK.UPDATE })`),
which the rebuild then used for the seat claim.

## Where AI output was corrected or rejected

From the slice:

- The slow test card first approved after 6 seconds; driving the two-window race in Chrome showed
  that was too short to demonstrate, so it became 10 seconds and configurable.
- A page that jumped back to the top after paying was found by measuring the scroll position in the
  browser, not by any test.
- The slice's reviewer found that a failed capture left the card hold in place, and that no test
  would notice a missing `ROLLBACK`. Both were fixed, with tests.

From the rebuild:

- **My own house style was overridden in one place on purpose.** My usual projects keep tokens in
  localStorage, and my own code comments there say that is not for internet-facing apps. Here the
  refresh token is an httpOnly cookie and the access token lives only in memory.
- **A router bug** (a parents-only check mounted without a path, which blocked staff routes) was
  caught by the first integration test run and fixed by moving to one router per resource.
- **A race in the payments sandbox** (an `await` between looking up and registering an idempotency
  key) was spotted in reading the code before any test ran.
- **The first e2e run failed six tests and took 5.7 minutes.** The cause was the dev server: content
  hashed file names plus lazy compilation made a hot update ask for a CSS file that no longer existed,
  so pages sat on "Loading". A label overlay also covered the radio buttons. Neither showed up in unit
  or integration tests.
- **A dependency fix that only looked fixed:** after the first `npm overrides` attempt `npm audit`
  reported 0 vulnerabilities because the dev server had been silently removed. Checking `npm ls`
  instead of trusting the summary caught it.
- **The rebuild's reviews found real problems, all fixed with a test each:**
  - the correctness review showed an outage during capture could give the seat away after retries,
    even when the money had been taken (the response was lost), and that marking the job failed and
    releasing the seat were not atomic; it also found that a refresh in one tab cut off the other
    tabs, that the expiry job could race a payment, and three smaller issues;
  - the security audit found that the login limiter did not stop password spraying, that the account
    lockout let anyone lock a parent out and revealed which emails exist, that sessions could be
    extended forever, that the VPS setup script could be abused through symlinks on a re-run, and six
    smaller items. It found no SEV1 or SEV2 issue.
  After the fixes, each bug was put back on purpose to confirm its new test fails.
- **One review suggestion was declined** in the slice: answering a repeated payment for an already
  confirmed booking with `200` instead of `409`. The rebuild settled it differently: every processed
  payment now returns `200` with an `outcome`, and repeated requests are handled by `Idempotency-Key`.

## What I would change about the workflow next time

- **Run the e2e suite and the reviews earlier.** The dev-server bug, the overlay and every review
  finding appeared after the code looked finished; each was cheap to fix, but earlier is cheaper.
- **Write the failure-mode tests first for anything that touches money.** The outage and
  lost-response cases were found by review, not by the first test plan.
- **Keep the contract-first split.** It is what made parallel agents work without collisions; the
  rule that only one agent installs dependencies avoided lockfile fights.
- **Verify tool output, not summaries:** `npm ls` over the audit count, the page snapshot over the
  test name.

## How the final implementation was verified

- **Automated:** 107 unit tests (shared, API, sandbox, web), 75 integration tests against a real
  Postgres, 11 Playwright end-to-end tests against the real stack; ESLint, a prose check (no em dashes,
  no filler words), TypeScript in every workspace, and a production build.
- **Mutation checks:** in the slice, removing the seat re-check and the database backstop made the
  race tests confirm 5 of 4, 12 of 1 and 10 of 1 seats. In the rebuild, reintroducing each reviewed
  bug made its test fail.
- **Live runs:** the full flow over HTTP against the real sandbox (booking, decline, idempotent
  replay, the last-seat race, a refused capture); the compiled API, worker and sandbox started as PM2
  would start them, reported ready, and shut down cleanly on SIGTERM.
- **Reviews:** two correctness reviews and one security audit by agents with fresh contexts, which
  ran their own probes; every finding was checked against the code before it was fixed or declined.
- **Clean install:** the slice was checked from a fresh clone; `npm audit` reports no vulnerabilities.
