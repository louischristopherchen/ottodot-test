-- Trial booking schema (SQLite).
--
-- The database enforces the booking invariants by itself, so a bug in the
-- application code or a manual fix run by ops cannot break them:
--   1. A child has at most one live booking per trial class (partial unique index).
--   2. A class never has more confirmed bookings than seats (triggers).
--   3. Statuses, money and capacity only hold valid values (CHECK constraints).
-- The application checks the same rules first so it can return clear errors;
-- these constraints are the backstop, not the primary mechanism.

CREATE TABLE IF NOT EXISTS parents (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS students (
  id        TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES parents (id),
  name      TEXT NOT NULL,
  level     INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6) -- Primary 1 to 6
);

CREATE INDEX IF NOT EXISTS students_parent_idx ON students (parent_id);

CREATE TABLE IF NOT EXISTS trial_classes (
  id               TEXT PRIMARY KEY,
  subject          TEXT NOT NULL CHECK (subject IN ('math', 'science')),
  title            TEXT NOT NULL,
  teacher_name     TEXT NOT NULL,
  starts_at        TEXT NOT NULL, -- ISO 8601 in UTC, e.g. 2026-10-01T09:00:00.000Z
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  capacity         INTEGER NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 1 AND 4),
  price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),
  currency         TEXT NOT NULL DEFAULT 'SGD'
);

CREATE TABLE IF NOT EXISTS bookings (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES students (id),
  trial_class_id TEXT NOT NULL REFERENCES trial_classes (id),
  status         TEXT NOT NULL
                 CHECK (status IN ('pending_payment', 'payment_failed', 'confirmed', 'cancelled')),
  cancel_reason  TEXT CHECK (cancel_reason IN ('class_full', 'booking_closed')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  confirmed_at   TEXT,
  CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL)),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);

-- Invariant 1: one live booking per child per class. A second click on
-- "Book" resumes the existing booking instead of creating another one.
-- Cancelled rows are history and do not count, so a child can book again
-- after a cancellation.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_live_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status IN ('pending_payment', 'payment_failed', 'confirmed');

CREATE INDEX IF NOT EXISTS bookings_class_status_idx ON bookings (trial_class_id, status);

-- Invariant 2: never more confirmed bookings than seats. SQLite allows one
-- writer at a time, so the count inside these triggers cannot go stale
-- between the check and the write. (Postgres needs a row lock or a counter
-- column with a CHECK instead; see the README.)
CREATE TRIGGER IF NOT EXISTS bookings_capacity_on_insert
BEFORE INSERT ON bookings
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'class_full')
  WHERE (SELECT count(*) FROM bookings
          WHERE trial_class_id = NEW.trial_class_id AND status = 'confirmed')
     >= (SELECT capacity FROM trial_classes WHERE id = NEW.trial_class_id);
END;

CREATE TRIGGER IF NOT EXISTS bookings_capacity_on_update
BEFORE UPDATE OF status, trial_class_id ON bookings
WHEN NEW.status = 'confirmed'
 AND (OLD.status <> 'confirmed' OR OLD.trial_class_id <> NEW.trial_class_id)
BEGIN
  SELECT RAISE(ABORT, 'class_full')
  WHERE (SELECT count(*) FROM bookings
          WHERE trial_class_id = NEW.trial_class_id AND status = 'confirmed')
     >= (SELECT capacity FROM trial_classes WHERE id = NEW.trial_class_id);
END;

CREATE TRIGGER IF NOT EXISTS trial_classes_capacity_not_below_confirmed
BEFORE UPDATE OF capacity ON trial_classes
BEGIN
  SELECT RAISE(ABORT, 'capacity_below_confirmed')
  WHERE (SELECT count(*) FROM bookings
          WHERE trial_class_id = NEW.id AND status = 'confirmed') > NEW.capacity;
END;

-- One row per attempt to pay for a booking. The id doubles as the
-- idempotency key sent to the payment provider.
--   processing  -> authorized | declined
--   authorized  -> captured   (seat claimed)
--               |  voided     (no seat: the hold on the card is released)
--               |  capture_failed (seat released again)
CREATE TABLE IF NOT EXISTS payment_attempts (
  id             TEXT PRIMARY KEY,
  booking_id     TEXT NOT NULL REFERENCES bookings (id),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency       TEXT NOT NULL,
  payment_method TEXT NOT NULL, -- a provider token, never a card number
  status         TEXT NOT NULL
                 CHECK (status IN ('processing', 'authorized', 'declined', 'captured', 'voided', 'capture_failed')),
  provider_ref   TEXT,          -- the provider's authorization id
  failure_code   TEXT,          -- e.g. insufficient_funds
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_attempts_booking_idx ON payment_attempts (booking_id);
