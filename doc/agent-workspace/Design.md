# Design

No supplied design: neutral shadcn/ui style on Tailwind 3 (house default). Light theme first; dark tokens via `class` strategy.
Clean, calm, functional. No marketing copy, no emoji, no em dashes in any UI text.

## Tokens

CSS variables in `apps/web/src/styles/globals.css`, consumed by `tailwind.config.cjs` (shadcn convention, HSL triplets):
`--background`, `--foreground`, `--card`, `--card-foreground`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`,
`--primary` (blue, 221 83% 53%), `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--destructive`, `--destructive-foreground`,
plus status tokens `--success` / `--success-foreground`, `--warning` / `--warning-foreground`. `--radius: 0.625rem`.
Font: system UI stack. Body 15px. Content max width 64rem, 16px side gutter on phones.

## Components (`packages/ui/src/components/`, kebab-case files, Radix + cva)

`button` (default, secondary, outline, ghost, destructive; sizes sm, default), `card` (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter),
`badge` (default, secondary, success, warning, destructive, outline), `input`, `label`, `alert` (default, success, warning, destructive; `role="status"` or `role="alert"` for destructive),
`table` (Table, TableHeader, TableBody, TableRow, TableHead, TableCell), `toast` (Radix Toast provider + `useToast`), `spinner`.
`cn` in `packages/ui/src/lib/utils.ts` (clsx + tailwind-merge).

## Pages (`apps/web/src/pages/`, PascalCase, lazy loaded)

All pages share a top bar: product name "Trial booking" on the left; on the right the signed-in user's name, role badge and a "Sign out" button.

### LoginPage (`/login`)
Card titled "Sign in". Fields "Email" and "Password" (react-hook-form + zod `loginSchema`), button "Sign in".
Errors from the API are shown in a destructive alert. When `SHOW_DEMO_ACCOUNTS` is true, a secondary card "Demo accounts" lists the seeded logins
(name, email, role) with a "Use" button per row that fills the form; the shared password is shown once.

### BookPage (`/book`, parents)
1. Card "Book a trial class".
   - "1. Child": radio group of the parent's children (name + "P3" style level). Preselect when there is only one child.
   - "2. Trial class": radio list of upcoming classes. Each row: subject in small caps, title, "Thu 1 Oct, 5:00 pm SGT · Teacher · SGD 20.00", and a seats badge on the right:
     `3 of 4 seats left` (success), `Last seat` (warning), `Full` (secondary; the radio is disabled).
   - Button "Continue to payment" (disabled until both are chosen). API errors appear in a destructive alert under the button, using the API message as is.
   - If a selected class becomes full on refresh, clear the selection.
2. Card "Payment" (after a booking is created or "Pay" is clicked in the list):
   - Summary list: Child, Class, Starts, Amount, Status (status badge).
   - When payable (`pending_payment` or `payment_failed`): "Test card" radio list from `TEST_CARDS` (label + description), then a button `Pay SGD 20.00`
     (amount from the booking). While the request runs the button reads "Processing payment..." and every input is disabled.
   - Otherwise a secondary button "Book another class".
   - The payment result `message` is shown in an alert: success tone for `confirmed`, destructive for `payment_declined`, `class_full`, `booking_closed`, default for `already_confirmed`.
   - Every Pay click sends a fresh `Idempotency-Key` (crypto.randomUUID()).
3. Card "Your bookings": table Child, Class, Starts, Status, Payment, action (`Pay` or `Retry payment` for payable rows).

Status badge text: `Pending payment` (warning), `Payment failed` (destructive), `Confirmed` (success), `Cancelled (class full)`, `Cancelled (class started)`, `Cancelled (expired)` (secondary).
Payment column text: `None yet`, `Processing`, `Authorized`, `Declined (insufficient funds)`, `Paid`, `Not charged (hold released)`, `Capture failed`.

### StaffClassesPage (`/staff`, staff)
Card "Upcoming trial classes": table Class (subject + title), Starts, Teacher, Confirmed (`3 of 4`), button "View roster" linking to `/staff/classes/:id`.

### RosterPage (`/staff/classes/:id`, staff)
Card "Roster: <class title>" with "<starts> with <teacher>. 3 of 4 seats confirmed."
Table of confirmed children: #, Child, Level, Parent, Email, Confirmed at. Then heading "Not on the roster" and a table: Child, Parent, Booking (status badge), Last payment. Empty states: "Nobody is confirmed yet." / "None."
Back link "All classes".

## Behaviour

- TanStack Query for server state; classes, bookings and roster refetch every 3 seconds so two windows racing for the last seat stay current.
- zustand store for the session (access token and user) in memory only, never localStorage.
- Routing: `/` redirects to `/book` for parents and `/staff` for staff; a parent opening a staff route is sent to `/book` and vice versa.
- Times in Singapore time (`Asia/Singapore`) with an `SGT` suffix; money with `Intl.NumberFormat`.
- Accessibility: every radio has a visible label, buttons have text, alerts use `role="status"` or `role="alert"`, focus rings visible, WCAG AA contrast.
