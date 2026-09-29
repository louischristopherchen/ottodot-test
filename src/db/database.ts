import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;   -- readers do not block the writer
    PRAGMA busy_timeout = 5000;  -- wait for the write lock instead of failing
    PRAGMA foreign_keys = ON;
  `);
  db.exec(schemaSql);
  return db;
}

/**
 * Runs `work` in a BEGIN IMMEDIATE transaction. IMMEDIATE takes the database
 * write lock before the first read, so a check-then-write sequence ("count the
 * confirmed seats, then confirm") is atomic across every connection and every
 * process that uses this database file. Other writers wait (busy_timeout)
 * instead of reading a count that is about to change.
 *
 * `work` must be synchronous. An `await` inside would keep the transaction
 * open while other requests run their statements on the same connection.
 */
export function withWriteLock<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    if (result instanceof Promise) {
      throw new Error('withWriteLock: work must be synchronous');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    // SQLite may already have rolled back on its own (e.g. disk full); a
    // second ROLLBACK would throw and hide the original error.
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
