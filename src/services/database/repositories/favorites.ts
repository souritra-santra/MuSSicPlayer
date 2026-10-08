import type { Track } from '@/types';

import type { Database } from '../client';
import type { CountRow, TrackRow } from '../rows';
import { dedupeKey } from '@/utils/common';
import { TRACK_COLUMNS_T } from './history';
import {
  getTrackRowIdByTrackId,
  getTracksByRowIds,
  parseTrackId,
  rowToTrack,
} from './tracks';

/** Idempotent add. Returns true when the row was newly created. */
export async function addFavorite(db: Database, trackId: string): Promise<boolean> {
  const rowId = await getTrackRowIdByTrackId(db, trackId);
  if (!rowId) return false;
  const result = await db.runAsync(
    'INSERT OR IGNORE INTO favorites (track_id, created_at) VALUES (?, ?)',
    rowId,
    Date.now(),
  );
  return result.changes > 0;
}

export async function removeFavorite(db: Database, trackId: string): Promise<boolean> {
  const rowId = await getTrackRowIdByTrackId(db, trackId);
  if (!rowId) return false;
  const result = await db.runAsync('DELETE FROM favorites WHERE track_id = ?', rowId);
  return result.changes > 0;
}

export async function toggleFavorite(db: Database, trackId: string): Promise<boolean> {
  const removed = await removeFavorite(db, trackId);
  if (removed) return false;
  return addFavorite(db, trackId);
}

export async function countFavorites(db: Database): Promise<number> {
  const row = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM favorites');
  return row?.count ?? 0;
}

/** Favorites, newest first. Paginated so a large library never loads at once. */
export async function getFavoriteTracks(
  db: Database,
  limit = 100,
  offset = 0,
): Promise<Track[]> {
  const rows = await db.getAllAsync<{ track_id: number }>(
    `SELECT track_id FROM favorites
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
  return getTracksByRowIds(
    db,
    rows.map((row) => row.track_id),
    limit,
  );
}

/**
 * Set of favorite track ids in a single query — lets a list render heart states
 * for 100 rows with one round-trip instead of 100.
 */
export async function getFavoriteTrackIds(db: Database): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ provider: string; external_id: string }>(
    `SELECT t.provider, t.external_id
       FROM favorites f
       JOIN tracks t ON t.id = f.track_id`,
  );
  return new Set(rows.map((row) => dedupeKey(row.provider, row.external_id)));
}

export async function getFavoriteTrackIdsFor(
  db: Database,
  trackIds: readonly string[],
): Promise<Set<string>> {
  const parsed = trackIds.map(parseTrackId).filter((v) => v !== null);
  if (parsed.length === 0) return new Set();
  const placeholders = parsed.map(() => '(?, ?)').join(', ');
  const params: string[] = [];
  for (const entry of parsed) params.push(entry.provider, entry.externalId);

  const rows = await db.getAllAsync<{ provider: string; external_id: string }>(
    `SELECT t.provider, t.external_id
       FROM favorites f
       JOIN tracks t ON t.id = f.track_id
      WHERE (t.provider, t.external_id) IN (VALUES ${placeholders})`,
    params,
  );
  return new Set(rows.map((row) => dedupeKey(row.provider, row.external_id)));
}

/** Drops favorites whose tracks no longer exist (defensive; FK cascade covers it). */
export async function pruneOrphanFavorites(db: Database): Promise<number> {
  const result = await db.runAsync(
    'DELETE FROM favorites WHERE track_id NOT IN (SELECT id FROM tracks)',
  );
  return result.changes;
}

/** Tracks favorited and never played — used as a "backlog" signal. */
export async function getUnplayedFavorites(db: Database, limit = 20): Promise<Track[]> {
  const rows = await db.getAllAsync<TrackRow>(
    `SELECT ${TRACK_COLUMNS_T}
       FROM favorites f
       JOIN tracks t ON t.id = f.track_id
       LEFT JOIN play_stats s ON s.track_id = t.id
      WHERE COALESCE(s.play_count, 0) = 0
      ORDER BY f.created_at DESC
      LIMIT ?`,
    limit,
  );
  return rows.map(rowToTrack);
}