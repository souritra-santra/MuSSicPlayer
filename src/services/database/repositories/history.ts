import type { ListeningEvent, PlayContext, Track, TrackStats } from '@/types';
import { normalizeText } from '@/utils/normalize';

import { runTransaction } from '../transaction';
import type { Database } from '../client';
import { HISTORY_RETENTION_LIMIT } from '../maintenance';
import type { CountRow, TrackRow, TrackStatsRow } from '../rows';
import {
  getTrackRowIdByTrackId,
  getTracksByRowIds,
  rowToTrack,
  TRACK_COLUMNS,
} from './tracks';

/** Select list for `tracks` aliased as `t` (used in JOIN queries). */
export const TRACK_COLUMNS_T = TRACK_COLUMNS.split(',')
  .map((column) => `t.${column.trim()}`)
  .join(', ');

/** A play counts as completed once past 50% (or 30s, whichever is smaller). */
export function isCompletedPlay(playMs: number, durationMs?: number): boolean {
  if (typeof durationMs !== 'number' || durationMs <= 0) return false;
  const threshold = Math.min(durationMs * 0.5, 30_000);
  return playMs >= threshold;
}

/**
 * Records a listening event: appends to `play_history` and folds the increment
 * into the `play_stats` / `artist_stats` / `genre_stats` rollups in a single
 * transaction, so the recommender can read aggregates without scanning history.
 */
export async function recordPlay(
  db: Database,
  event: ListeningEvent & { track: Track },
): Promise<void> {
  const trackRowId = await getTrackRowIdByTrackId(db, event.trackId);
  if (!trackRowId) return;

  const now = event.playedAt;
  const completed = event.completed;
  const skipDelta = completed ? 0 : 1;
  const playMs = Math.max(0, Math.round(event.playMs));

  await runTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO play_history (track_id, played_at, play_ms, completed, context)
       VALUES (?, ?, ?, ?, ?)`,
      trackRowId,
      now,
      playMs,
      completed ? 1 : 0,
      event.context satisfies PlayContext,
    );

    await txn.runAsync(
      `INSERT INTO play_stats (track_id, play_count, skip_count, total_ms, first_played_at, last_played_at)
       VALUES (?, 1, ?, ?, ?, ?)
       ON CONFLICT (track_id) DO UPDATE SET
         play_count      = play_stats.play_count + 1,
         skip_count      = play_stats.skip_count + excluded.skip_count,
         total_ms        = play_stats.total_ms + excluded.total_ms,
         first_played_at = COALESCE(play_stats.first_played_at, excluded.first_played_at),
         last_played_at  = excluded.last_played_at`,
      trackRowId,
      skipDelta,
      playMs,
      now,
      now,
    );

    // Artist affinity, matched on normalized name: artist row ids are
    // provider-scoped and a cached track may not have resolved its artist rows.
    for (const artistName of event.track.artistNames) {
      const norm = normalizeText(artistName);
      if (norm.length === 0) continue;

      const artistRow = await txn.getFirstAsync<{ id: number }>(
        'SELECT id FROM artists WHERE norm_name = ? ORDER BY updated_at DESC LIMIT 1',
        norm,
      );
      if (!artistRow) continue;

      await txn.runAsync(
        `INSERT INTO artist_stats (artist_id, artist_name, norm_name, play_count, skip_count, last_played_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT (artist_id) DO UPDATE SET
           play_count     = artist_stats.play_count + 1,
           skip_count     = artist_stats.skip_count + excluded.skip_count,
           last_played_at = excluded.last_played_at`,
        artistRow.id,
        artistName,
        norm,
        skipDelta,
        now,
      );
    }

    for (const genre of event.track.genres.slice(0, 4)) {
      await txn.runAsync(
        `INSERT INTO genre_stats (genre, play_count, last_played_at)
         VALUES (?, 1, ?)
         ON CONFLICT (genre) DO UPDATE SET
           play_count     = genre_stats.play_count + 1,
           last_played_at = excluded.last_played_at`,
        genre,
        now,
      );
    }
  });
}

function rowToStats(row: TrackStatsRow): TrackStats {
  return {
    trackId: String(row.track_id),
    playCount: row.play_count,
    skipCount: row.skip_count,
    totalMs: row.total_ms,
    firstPlayedAt: row.first_played_at ?? undefined,
    lastPlayedAt: row.last_played_at ?? undefined,
  };
}

export async function getTrackStats(db: Database, trackId: string): Promise<TrackStats | null> {
  const trackRowId = await getTrackRowIdByTrackId(db, trackId);
  if (!trackRowId) return null;
  const row = await db.getFirstAsync<TrackStatsRow>(
    `SELECT track_id, play_count, skip_count, total_ms, first_played_at, last_played_at
       FROM play_stats
      WHERE track_id = ?`,
    trackRowId,
  );
  return row ? rowToStats(row) : null;
}

/** Most played tracks ("Most Played" shelf). */
export async function getMostPlayedTracks(db: Database, limit = 20, minPlays = 1): Promise<Track[]> {
  const rows = await db.getAllAsync<{ track_id: number }>(
    `SELECT track_id FROM play_stats
      WHERE play_count >= ?
      ORDER BY play_count DESC, last_played_at DESC
      LIMIT ?`,
    minPlays,
    limit,
  );
  return getTracksByRowIds(
    db,
    rows.map((row) => row.track_id),
    limit,
  );
}

/** Recently played, newest first, deduplicated by track. */
export async function getRecentlyPlayedTracks(db: Database, limit = 20): Promise<Track[]> {
  const rows = await db.getAllAsync<{ track_id: number }>(
    `SELECT track_id, MAX(played_at) AS max_played_at
       FROM play_history
      GROUP BY track_id
      ORDER BY max_played_at DESC
      LIMIT ?`,
    limit,
  );
  return getTracksByRowIds(
    db,
    rows.map((row) => row.track_id),
    limit,
  );
}

/**
 * "Continue Listening": tracks that were started but never completed at least
 * once. Aggregated per track so a repeated skip does not multiply rows.
 */
export async function getContinueListeningTracks(db: Database, limit = 20): Promise<Track[]> {
  const rows = await db.getAllAsync<TrackRow & { last_played_at: number }>(
    `SELECT ${TRACK_COLUMNS_T}, MAX(h.played_at) AS last_played_at
       FROM play_history h
       JOIN tracks t ON t.id = h.track_id
      GROUP BY h.track_id
     HAVING SUM(h.completed) = 0
      ORDER BY last_played_at DESC
      LIMIT ?`,
    limit,
  );
  return rows.map(rowToTrack);
}

export type HistoryEntry = {
  readonly track: Track;
  readonly playedAt: number;
  readonly playMs: number;
  readonly completed: boolean;
};

/**
 * Paged history feed. Track rows are fetched in one batched query rather than
 * per-entry, keeping a 50-row page to two round-trips.
 */
export async function getHistoryPage(
  db: Database,
  limit = 30,
  offset = 0,
): Promise<HistoryEntry[]> {
  const rows = await db.getAllAsync<{
    track_id: number;
    played_at: number;
    play_ms: number;
    completed: number;
  }>(
    `SELECT track_id, played_at, play_ms, completed
       FROM play_history
      ORDER BY played_at DESC
      LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
  if (rows.length === 0) return [];

  const rowIds = Array.from(new Set(rows.map((row) => row.track_id)));
  const trackRows = await db.getAllAsync<TrackRow>(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE id IN (${rowIds.map(() => '?').join(', ')})`,
    rowIds,
  );
  const trackByRowId = new Map(trackRows.map((row) => [row.id, rowToTrack(row)]));

  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    const track = trackByRowId.get(row.track_id);
    if (!track) continue;
    entries.push({
      track,
      playedAt: row.played_at,
      playMs: row.play_ms,
      completed: row.completed === 1,
    });
  }
  return entries;
}

export async function countHistoryEntries(db: Database): Promise<number> {
  const row = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM play_history');
  return row?.count ?? 0;
}

/**
 * Trims `play_history` to the retention limit. Aggregate stats are untouched,
 * which is why the recommender reads `play_stats` rather than history.
 */
export async function pruneHistory(db: Database, keep = HISTORY_RETENTION_LIMIT): Promise<number> {
  const row = await db.getFirstAsync<{ cutoff: number | null }>(
    `SELECT MIN(id) AS cutoff
       FROM (
         SELECT id FROM play_history ORDER BY played_at DESC LIMIT -1 OFFSET ?
       )`,
    keep,
  );
  if (!row?.cutoff) return 0;
  const result = await db.runAsync('DELETE FROM play_history WHERE id <= ?', row.cutoff);
  return result.changes;
}

export async function clearHistory(db: Database): Promise<number> {
  const result = await db.runAsync('DELETE FROM play_history');
  return result.changes;
}

export type GenreAffinity = { readonly genre: string; readonly playCount: number };

export async function getTopGenres(db: Database, limit = 12): Promise<GenreAffinity[]> {
  const rows = await db.getAllAsync<{ genre: string; play_count: number }>(
    `SELECT genre, play_count FROM genre_stats
      WHERE play_count > 0
      ORDER BY play_count DESC
      LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({ genre: row.genre, playCount: row.play_count }));
}

export type CoOccurrence = {
  readonly trackId: string;
  readonly otherTrackId: string;
  readonly weight: number;
};

/**
 * Co-occurrence pairs from listening sessions (plays within an hour of each
 * other). Backs the "Because You Listened Toâ€¦" shelf in Phase 5.
 */
export async function getCoOccurrences(db: Database, limit = 200): Promise<CoOccurrence[]> {
  const rows = await db.getAllAsync<{ a: string; b: string; weight: number }>(
    `SELECT a.provider || ':' || a.external_id AS a,
            b.provider || ':' || b.external_id AS b,
            COUNT(*) AS weight
       FROM play_history pa
       JOIN play_history pb
         ON pb.track_id = pa.track_id
        AND pb.id > pa.id
        AND pb.played_at - pa.played_at < 3600000
       JOIN tracks a ON a.id = pa.track_id
       JOIN tracks b ON b.id = pb.track_id
      WHERE pa.track_id <> pb.track_id
      GROUP BY a, b
      ORDER BY weight DESC
      LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({ trackId: row.a, otherTrackId: row.b, weight: row.weight }));
}