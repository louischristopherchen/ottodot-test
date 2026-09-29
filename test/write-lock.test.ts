import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { withWriteLock } from '../src/db/database.ts';
import { execute, queryOne } from '../src/db/sql.ts';
import { setupTestDb, type TestContext } from './support/fixtures.ts';

// withWriteLock is what makes "count the seats, then confirm" atomic across
// connections and processes. The race tests elsewhere run in one process, so
// they cannot tell a real lock from no lock; these tests can.

let ctx: TestContext;
let otherConnection: DatabaseSync;

beforeEach(() => {
  ctx = setupTestDb();
  otherConnection = new DatabaseSync(ctx.dbPath);
  otherConnection.exec('PRAGMA busy_timeout = 0'); // fail at once instead of waiting
});

afterEach(() => {
  otherConnection.close();
  ctx.close();
});

const addParent = (db: DatabaseSync, id: string) =>
  execute(db, 'INSERT INTO parents (id, name, email) VALUES (:id, :id, :email)', { id, email: `${id}@example.com` });

const parentExists = (id: string) =>
  queryOne<{ n: number }>(ctx.db, 'SELECT count(*) AS n FROM parents WHERE id = :id', { id })!.n === 1;

describe('withWriteLock', () => {
  test('holds the write lock from its first statement, so no other connection can write in between', () => {
    withWriteLock(ctx.db, () => {
      // Only a read so far. A deferred BEGIN would not hold the lock yet.
      queryOne(ctx.db, 'SELECT count(*) FROM bookings');
      assert.throws(() => addParent(otherConnection, 'par_intruder'), /database is locked/);
    });
    addParent(otherConnection, 'par_after_commit');
    assert.ok(parentExists('par_after_commit'));
  });

  test('rolls back and closes the transaction when the work throws', () => {
    assert.throws(
      () =>
        withWriteLock(ctx.db, () => {
          addParent(ctx.db, 'par_rolled_back');
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.equal(ctx.db.isTransaction, false);
    assert.equal(parentExists('par_rolled_back'), false);
    addParent(otherConnection, 'par_next_writer'); // the lock was released
  });

  test('refuses asynchronous work, which would hold the lock across an await', () => {
    assert.throws(() => withWriteLock(ctx.db, async () => {}), /must be synchronous/);
    assert.equal(ctx.db.isTransaction, false);
  });
});
