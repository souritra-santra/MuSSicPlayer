import Storage from 'expo-sqlite/kv-store';

import type { Database } from '../client';

/**
 * Small key/value settings store.
 *
 * Uses `expo-sqlite/kv-store`, which is backed by SQLite and also exposes
 * synchronous accessors. Zustand's `persist` middleware prefers a sync storage,
 * so settings survive app restarts without pulling in a second dependency
 * (and without AsyncStorage's extra native module).
 */

export async function getValue<T>(db: Database, key: string): Promise<T | null> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      key,
    );
    return row ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}

export async function setValue(db: Database, key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  await db.runAsync(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    serialized,
    Date.now(),
  );
}

export async function deleteValue(db: Database, key: string): Promise<boolean> {
  const result = await db.runAsync('DELETE FROM kv WHERE key = ?', key);
  return result.changes > 0;
}

/**
 * Synchronous reader used by the zustand persist storage adapter. The kv-store
 * is opened lazily by `Storage`, which is why this is safe to call at module
 * load inside a React tree.
 */
export function getItemSync(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
}

export function setItemSync(key: string, value: string): void {
  try {
    Storage.setItemSync(key, value);
  } catch {
    // Storage is unavailable only before SQLite is initialized; settings then
    // simply start from defaults.
  }
}

export function removeItemSync(key: string): void {
  try {
    Storage.removeItemSync(key);
  } catch {
    // ignored
  }
}

/** Cache-entry helpers: TTL'd provider payload cache. */
export async function getCacheEntry<T>(
  db: Database,
  key: string,
): Promise<T | null> {
  const row = await db.getFirstAsync<{ payload: string; expires_at: number }>(
    'SELECT payload, expires_at FROM cache_entries WHERE cache_key = ?',
    key,
  );
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await db.runAsync('DELETE FROM cache_entries WHERE cache_key = ?', key);
    return null;
  }
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export async function setCacheEntry(
  db: Database,
  key: string,
  payload: unknown,
  ttlMs: number,
  provider = '',
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO cache_entries (cache_key, provider, payload, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET
       payload    = excluded.payload,
       expires_at = excluded.expires_at,
       provider   = excluded.provider`,
    key,
    provider,
    JSON.stringify(payload),
    now + ttlMs,
    now,
  );
}

/** Deletes expired cache rows; called from startup maintenance. */
export async function pruneCacheEntries(db: Database): Promise<number> {
  const result = await db.runAsync('DELETE FROM cache_entries WHERE expires_at <= ?', Date.now());
  return result.changes;
}

export async function clearCacheEntries(db: Database): Promise<number> {
  const result = await db.runAsync('DELETE FROM cache_entries');
  return result.changes;
}

export async function countCacheEntries(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM cache_entries',
  );
  return row?.count ?? 0;
}