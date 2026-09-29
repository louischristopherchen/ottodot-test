# AI usage

## Tools

- **Claude Code** (Anthropic's command-line coding agent) running Claude Opus
  5.5, in a single session. It could run shell commands, edit files, and drive
  a real Chrome window through the Claude in Chrome extension.
- **A second Claude Code agent** acting as a read-only code reviewer, started
  with a fresh context (it had not seen the design discussion) and asked to
  look for correctness holes in the invariants.

No other AI tools were used.

## What I used AI for

- Turning the brief into a design: the booking statuses, where the one binding
  seat check lives, authorize / capture / void around it, and what to leave out.
- Writing the code, the tests, the seed data and the first drafts of the README
  and this file.
- Running everything: the type checker, the test suite, the race demo, and the
  page itself in Chrome with two parents racing for the last seat.
- An independent review of the finished code.

## One place where AI made me faster

The concurrency tests. The brief's scenario is an ordering problem ("B finishes
paying while A is still paying"), and a test that relies on sleeps would be
flaky. The agent wrote a test double for the payment provider that pauses one
booking's authorization until the test releases it, which makes the scenario an
exact sequence. It then wrote a worker that pays from a separate OS process, so
10 processes with their own database connections can race for one seat. Both
were written, run and passing within minutes.

The same goes for proving the tests mean something. Breaking the seat check on
purpose, running the race tests and reverting took one command each, and gave
the numbers quoted in the README (without the check and the triggers: 5 of 4
seats, then 12 and 10 children confirmed into a single seat).

## Where AI output was corrected or rejected

- **The race was not demoable in the browser as first built.** The slow test
  card approved after 6 seconds. When the two-window race was actually run in
  Chrome, the first parent's payment completed before the second window could
  pay, so the page correctly showed the class as full but the scenario from the
  brief could not be shown. The slow card now takes 10 seconds and the delay is
  configurable.
- **A UI bug no test caught.** After pressing Pay, the page jumped back to the
  top: the page re-renders on every change, and a smooth scroll was running at
  the same time as the 3-second refresh. Found by measuring the scroll position
  in the browser, fixed by keeping the scroll position across re-renders and
  dropping the smooth scrolling.
- **The independent review found real gaps, and they were fixed.** The
  reviewer agent found no way to break the invariants (it probed double
  submits, a decline racing a success in both orders, the class starting
  mid-payment, and capture failure), but it found two things that mattered.
  First, a failed capture gave the seat back but left the hold on the parent's
  card. Second, no test would notice if `withWriteLock` stopped rolling back,
  which would leave the shared connection stuck in a transaction after the
  first 404. It also showed that removing the lock entirely was only caught by
  the multi-process test some of the time (5 of 6 runs). The fixes: void the
  hold after a failed capture; make every test fail if it leaves a transaction
  open; add a deterministic two-connection test for the lock; add tests for
  the overlapping payments it listed. Each new test was then checked by
  breaking the code it protects and watching it fail.
- **One review suggestion was declined.** The reviewer proposed answering a
  repeated payment for an already-confirmed booking with `200` instead of
  `409`. It stays `409`: that request did not create a payment, "the booking
  is already confirmed" is a conflict with the resource's state, and the body
  still carries the confirmed booking, so a client can show the right screen
  either way. The proper fix for safe client retries is an `Idempotency-Key`
  header that replays the original `200`, which is listed under next steps in
  the README.

## What I would change about the workflow next time

- **Write the race tests before the booking service.** Here they came straight
  after it. Starting from a failing race test would have made the mutation
  check the first step rather than a later one.
- **Drive the real page earlier.** Both UI problems above were invisible to a
  fully passing test suite and only showed up in the browser.
- **Run the independent review right after the backend commit**, while changes
  were cheap, instead of after the UI was built.
- **Write the design section before the code.** The README's race section was
  written after the implementation. Drafting it first is the cheaper place to
  argue about seat holds versus a confirm-time check.

## How the final implementation was verified

- `npm run check`: TypeScript type check plus 47 tests, all passing. The tests
  cover every case in the brief, including the exact last-seat sequence, a
  crowd of 12 parents in one process, 10 separate OS processes, a
  double-submitted payment, overlapping payments on one booking, the write
  lock across two connections, and raw SQL that bypasses the application.
- Mutation checks: with the seat re-check removed, the database triggers still
  refused every extra seat; with the triggers removed as well, the race tests
  failed with 5 of 4, 12 and 10 confirmed. After the review, four more breaks
  (no `ROLLBACK`, a deferred `BEGIN`, no void after a failed capture, a late
  decline ignoring a cancellation) were each caught. All were reverted.
- `npm run demo:race`: the scenario from the brief with timings, the
  10-process race (1 confirmed, 9 refused and voided) and the rejected raw SQL.
- In Chrome: book, decline, retry; the duplicate booking message; the
  two-window race with the slow card (A cancelled as class full, not charged;
  B confirmed); the staff roster showing 4 of 4 with A under "Not on the
  roster". No console errors.
- An independent review by a second agent with a fresh context, which ran its
  own probes and deliberately broken copies of the code in a scratch folder.
  Its findings and what happened to them are listed above.
- A fresh clone of the repository installs with `npm ci`, passes the tests,
  and starts the server with seeded data on the first run.
