import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Connects the UI kit and screens to the database handle.
 *
 * The database is opened lazily and can fail (corrupt file, permission issue on
 * a locked device), so screens get either a working handle or an explicit error
 * rather than a suspended tree that hangs on a splash screen forever.
 */

export type DatabaseState =
  | { status: 'loading'; db: null; error: null }
  | { status: 'ready'; db: import('@/services/database').Database; error: null }
  | { status: 'error'; db: null; error: Error };

export type DatabaseContextValue = DatabaseState & {
  /** Convenience accessor that throws when used outside the ready state. */
  requireDb: () => import('@/services/database').Database;
};

let cache: DatabaseContextValue | null = null;
const listeners = new Set<(state: DatabaseContextValue) => void>();

function emit(next: DatabaseContextValue) {
  cache = next;
  for (const listener of listeners) listener(next);
}

/**
 * Module-level singleton wrapper around `getDatabase()`.
 *
 * Kept outside React so non-component code (store actions, services) can await
 * the same handle without duplicating the loading logic.
 */
export function subscribeDatabase(listener: (state: DatabaseContextValue) => void) {
  listeners.add(listener);
  if (cache) listener(cache);
  return () => {
    listeners.delete(listener);
  };
}

export async function ensureDatabase(): Promise<DatabaseContextValue> {
  if (cache?.status === 'ready') return cache;
  if (cache?.status === 'loading') return cache;

  const loading: DatabaseContextValue = { status: 'loading', db: null, error: null, requireDb: throwNotReady };
  emit(loading);

  try {
    const { getDatabase } = await import('@/services/database');
    const db = await getDatabase();
    const ready: DatabaseContextValue = {
      status: 'ready',
      db,
      error: null,
      requireDb: () => db,
    };
    emit(ready);
    return ready;
  } catch (error) {
    const failed: DatabaseContextValue = {
      status: 'error',
      db: null,
      error: error instanceof Error ? error : new Error(String(error)),
      requireDb: throwNotReady,
    };
    emit(failed);
    return failed;
  }
}

function throwNotReady(): never {
  throw new Error('Database is not ready');
}

/** React binding for `ensureDatabase`. */
export function useDatabase(): DatabaseContextValue {
  const [state, setState] = useState<DatabaseContextValue>(
    cache ?? { status: 'loading', db: null, error: null, requireDb: throwNotReady },
  );

  useEffect(() => {
    const unsubscribe = subscribeDatabase(setState);
    if (cache?.status === 'loading') void ensureDatabase();
    return unsubscribe;
  }, []);

  return state;
}

/**
 * For components that can only render when data is available.
 * Returns `null` while loading, which screens render as a skeleton.
 */
export function useReadyDatabase(): import('@/services/database').Database | null {
  const { status, db } = useDatabase();
  return status === 'ready' ? db : null;
}

/**
 * Runs `loader` whenever `deps` change (and again as soon as the database
 * becomes ready).
 *
 * State is keyed by an internal "run" counter rather than a boolean, so the
 * effect body never has to call `setState` synchronously — it only writes from
 * the promise callbacks, which keeps React from cascading a render on every
 * dep change.
 */
export function useDatabaseLoader<T>(
  loader: (db: import('@/services/database').Database) => Promise<T>,
  deps: readonly unknown[],
): { data: T | null; error: Error | null; loading: boolean; reload: () => void } {
  const db = useReadyDatabase();
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{ data: T; run: number } | null>(null);
  const [failure, setFailure] = useState<{ error: Error; run: number } | null>(null);

  const reload = useCallback(() => setRun((value) => value + 1), []);

  useEffect(() => {
    if (!db) return;

    let cancelled = false;

    loader(db)
      .then((value) => {
        if (cancelled) return;
        setResult({ data: value, run });
        setFailure(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setFailure({ error: cause instanceof Error ? cause : new Error(String(cause)), run });
        setResult(null);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, run, ...deps]);

  return useMemo(() => {
    // Data from a previous run is stale but still better than a blank screen, so
    // it is kept visible while the new run is in flight; the error is only
    // surfaced if it belongs to the current run.
    const settled = result?.run === run || failure?.run === run;
    return {
      data: result?.data ?? null,
      error: failure?.run === run ? failure.error : null,
      loading: db === null || !settled,
      reload,
    };
  }, [result, failure, run, db, reload]);
}