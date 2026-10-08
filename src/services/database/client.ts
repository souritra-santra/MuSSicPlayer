import * as SQLite from 'expo-sqlite';

import { runMigrations } from './migrations';

/** Kept in sync with the highest entry in `MIGRATIONS`. */
export const SCHEMA_VERSION = 2;

export const DATABASE_NAME = 'musicplayer.db';

export type Database = SQLite.SQLiteDatabase;

/**
 * Single shared handle. `openDatabaseAsync` is comparatively expensive, and
 * Expo Router remounts layouts on fast refresh, so the promise is cached at
 * module scope.
 */
let databasePromise: Promise<Database> | null = null;

async function open(): Promise<Database> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  // Pragmas first: WAL roughly triples concurrent read throughput and these are
  // connection-scoped, so they must be set before the first query.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -2048;
  `);

  await runMigrations(db, SCHEMA_VERSION);
  return db;
}

/** Opens (once) and returns the migrated database. */
export function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = open().catch((error) => {
      // Allow a later retry instead of caching a rejected promise forever.
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

/** Closes the handle. Only used by tests / a future "reset library" action. */
export async function closeDatabase(): Promise<void> {
  if (!databasePromise) return;
  const db = await databasePromise.catch(() => null);
  databasePromise = null;
  await db?.closeAsync();
}
