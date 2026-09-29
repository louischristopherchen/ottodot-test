import type { SQLInputValue } from 'node:sqlite';
import type { Db } from './database.ts';

// Thin typed wrappers over node:sqlite. Every query uses bound parameters;
// SQL strings are never built from user input.

type Params = Record<string, SQLInputValue>;

export function queryOne<T>(db: Db, sql: string, params: Params = {}): T | undefined {
  return db.prepare(sql).get(params) as unknown as T | undefined;
}

export function queryAll<T>(db: Db, sql: string, params: Params = {}): T[] {
  return db.prepare(sql).all(params) as unknown as T[];
}

/** Runs a write and returns the number of rows it changed. */
export function execute(db: Db, sql: string, params: Params = {}): number {
  return Number(db.prepare(sql).run(params).changes);
}
