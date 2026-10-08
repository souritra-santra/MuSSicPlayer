import type { Database } from './client';

/**
 * Transactions on the shared connection.
 *
 * Lives in its own module — rather than beside `getDatabase` in `client.ts` — so
 * that `client` → `migrations` → `transaction` stays a type-only edge back to
 * `client`. A value import would close the cycle at runtime.
 */

/** Tail of the transaction queue; every run chains onto it. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` inside a serialised, exclusive write transaction.
 *
 * This deliberately does *not* use `expo-sqlite`'s
 * `withExclusiveTransactionAsync()`. That helper opens a **second**
 * `NativeDatabase` (`useNewConnection: true`) and closes it again in a
 * `finally`, and under WAL that second `sqlite3_close()` double-frees: the
 * process dies with
 *
 *     Abort message: 'Scudo ERROR: invalid chunk state when deallocating'
 *     #08 exsqlite3_finalize   libexpo-sqlite.so
 *     #18 SQLiteModule.closeDatabase
 *
 * Every write in this app went through that helper, so the first search — the
 * first thing that writes — killed the app outright. Reproduced on
 * Android 16 / API 36, expo-sqlite in SDK 57.
 *
 * Instead the work runs on the single shared connection, and two things restore
 * the isolation the helper was being used for:
 *
 * 1. `BEGIN IMMEDIATE` takes the write lock up front instead of upgrading
 *    halfway through, which is where `SQLITE_BUSY` comes from.
 * 2. Transactions are queued, so two read-modify-write transactions can never
 *    interleave on the shared connection the way they could under a plain
 *    `withTransactionAsync()`.
 *
 * Anything `task` awaits still joins the transaction — inherent to async work on
 * one SQLite connection — but since our own transactions are queued and writes
 * outside them are single statements, the blast radius is one extra statement
 * riding along.
 */
export function runTransaction<T>(db: Database, task: (txn: Database) => Promise<T>): Promise<T> {
  const result = queue.then(async () => {
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      const value = await task(db);
      await db.execAsync('COMMIT');
      return value;
    } catch (error) {
      // A rollback can itself fail (e.g. the connection died); the original
      // error is the one worth reporting.
      await db.execAsync('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });

  // Swallow on both branches: the queue exists to serialise, so one failed
  // transaction must not poison every transaction queued behind it.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
