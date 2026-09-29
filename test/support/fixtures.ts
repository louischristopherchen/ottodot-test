import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, withWriteLock, type Db } from '../../src/db/database.ts';
import { seedDemoData } from '../../src/db/seed.ts';
import { execute, queryAll } from '../../src/db/sql.ts';
import type { Deps } from '../../src/domain/types.ts';
import { MockPaymentProvider } from '../../src/payments/mock-provider.ts';
import type { PaymentProvider } from '../../src/payments/provider.ts';

/** Fixed clock for tests. Seeded classes start 1 to 4 days after this. */
export const TEST_NOW = new Date('2026-10-05T01:00:00.000Z');

export interface TestContext {
  db: Db;
  dbPath: string;
  deps: Deps;
  clock: { now: Date };
  close(): void;
}

/** A fresh, seeded database file per test, so tests can run in parallel. */
export function setupTestDb(options: { payments?: PaymentProvider; now?: Date } = {}): TestContext {
  const dir = mkdtempSync(join(tmpdir(), 'trial-booking-test-'));
  const dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  const clock = { now: options.now ?? TEST_NOW };
  seedDemoData(db, clock.now);
  const deps: Deps = {
    db,
    payments: options.payments ?? new MockPaymentProvider({ latencyMs: 0 }),
    now: () => clock.now,
  };
  return {
    db,
    dbPath,
    deps,
    clock,
    close() {
      // Every test also checks that no code path left a transaction open on
      // the shared connection (for example an error thrown without a ROLLBACK).
      const leftOpen = db.isTransaction;
      db.close();
      rmSync(dir, { recursive: true, force: true });
      if (leftOpen) throw new Error('A transaction was left open on the connection');
    },
  };
}

export function confirmedStudentIds(db: Db, trialClassId: string): string[] {
  return queryAll<{ studentId: string }>(
    db,
    `SELECT student_id AS studentId FROM bookings
      WHERE trial_class_id = :trialClassId AND status = 'confirmed' ORDER BY student_id`,
    { trialClassId },
  ).map((row) => row.studentId);
}

export function paymentAttemptStatuses(db: Db, bookingId: string): string[] {
  return queryAll<{ status: string }>(
    db,
    'SELECT status FROM payment_attempts WHERE booking_id = :bookingId ORDER BY created_at, rowid',
    { bookingId },
  ).map((row) => row.status);
}

/** Adds `count` extra families with one child each, for crowd tests. */
export function addFamilies(db: Db, count: number): { parentId: string; studentId: string }[] {
  return withWriteLock(db, () =>
    Array.from({ length: count }, (_, index) => {
      const parentId = `par_extra_${index}`;
      const studentId = `stu_extra_${index}`;
      execute(db, 'INSERT INTO parents (id, name, email) VALUES (:id, :name, :email)', {
        id: parentId,
        name: `Parent ${index}`,
        email: `parent${index}@example.com`,
      });
      execute(db, 'INSERT INTO students (id, parent_id, name, level) VALUES (:id, :parentId, :name, 4)', {
        id: studentId,
        parentId,
        name: `Child ${index}`,
      });
      return { parentId, studentId };
    }),
  );
}
