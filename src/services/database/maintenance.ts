import type { LibraryStats } from '@/types';

import { runTransaction } from './transaction';
import type { Database } from './client';
import { getFtsSupport, rebuildFtsIndex } from './fts';
import { countAlbums, countArtists } from './repositories/catalog';
import { countFavorites, pruneOrphanFavorites } from './repositories/favorites';
import { countHistoryEntries, pruneHistory } from './repositories/history';
import { clearCacheEntries, pruneCacheEntries } from './repositories/kv';
import { countPlaylists } from './repositories/playlists';
import { pruneSearchHistory } from './repositories/searchHistory';
import { countTracks } from './repositories/tracks';

/**
 * Retention limits. Everything unbounded in the app is bounded here: a music
 * player that appends to `play_history` forever will eventually hit the storage
 * wall on a 64 GB phone and start thrashing.
 */
export const HISTORY_RETENTION_LIMIT = 2000;
export const SEARCH_HISTORY_LIMIT = 50;

export type MaintenanceReport = {
  readonly ranAt: number;
  readonly prunedHistory: number;
  readonly prunedSearchHistory: number;
  readonly prunedCache: number;
  readonly orphanFavorites: number;
  readonly ftsRebuilt: boolean;
  readonly ftsAvailable: boolean;
  readonly durationMs: number;
};

/**
 * Startup housekeeping: trims rolling tables, drops expired cache entries and
 * refreshes the FTS index.
 *
 * Deliberately cheap (a handful of indexed queries) and idempotent, so it can
 * run on every cold start without a separate worker.
 */
export async function runMaintenance(
  db: Database,
  options: { rebuildFts?: boolean } = {},
): Promise<MaintenanceReport> {
  const startedAt = Date.now();

  const prunedHistory = await pruneHistory(db);
  const prunedSearchHistory = await pruneSearchHistory(db);
  const prunedCache = await pruneCacheEntries(db);
  const orphanFavorites = await pruneOrphanFavorites(db);

  const fts = await getFtsSupport(db);
  let ftsRebuilt = false;
  // Rebuilding is the expensive part, so it only runs when explicitly asked
  // (e.g. after a bulk import in Phase 2) rather than on every cold start.
  if (fts.available && options.rebuildFts) {
    ftsRebuilt = await rebuildFtsIndex(db);
  }

  return {
    ranAt: startedAt,
    prunedHistory,
    prunedSearchHistory,
    prunedCache,
    orphanFavorites,
    ftsRebuilt,
    ftsAvailable: fts.available,
    durationMs: Date.now() - startedAt,
  };
}

export async function getLibraryStats(db: Database): Promise<LibraryStats> {
  const [tracks, artists, albums, favorites, playlists, historyEntries] = await Promise.all([
    countTracks(db),
    countArtists(db),
    countAlbums(db),
    countFavorites(db),
    countPlaylists(db),
    countHistoryEntries(db),
  ]);

  let databaseBytes: number | undefined;
  try {
    const row = await db.getFirstAsync<{ bytes: number }>('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()');
    databaseBytes = row?.bytes;
  } catch {
    // `pragma_page_count()` table-valued syntax is unavailable on some builds.
    databaseBytes = undefined;
  }

  return {
    tracks,
    artists,
    albums,
    favorites,
    playlists,
    historyEntries,
    databaseBytes,
  };
}

/**
 * Wipes user data but keeps the catalogue cache. Exposed through Settings in a
 * later phase; implemented here so the destructive path is testable in
 * isolation rather than wired straight into a button.
 */
export async function resetUserData(db: Database): Promise<void> {
  await runTransaction(db, async (txn) => {
    await txn.execAsync(`
      DELETE FROM play_history;
      DELETE FROM play_stats;
      DELETE FROM artist_stats;
      DELETE FROM genre_stats;
      DELETE FROM favorites;
      DELETE FROM playlist_tracks;
      DELETE FROM queue_items;
      DELETE FROM search_history;
      DELETE FROM cache_entries;
      DELETE FROM playlists WHERE system = 0;
    `);
  });
}

export async function resetEverything(db: Database): Promise<void> {
  await resetUserData(db);
  await clearCacheEntries(db);
  await db.runAsync('DELETE FROM tracks');
  await db.runAsync('DELETE FROM albums');
  await db.runAsync('DELETE FROM artists');
}