import type { Album, Artist, Track } from '@/types';

import { runTransaction } from '../transaction';
import type { Database } from '../client';
import { searchTrackIds } from '../fts';
import type { AlbumRow, ArtistRow, CountRow, TrackRow } from '../rows';
import { normalizeArtist, normalizeTitle } from '@/utils/normalize';
import { chunk, dedupeKey, trackSignature } from '@/utils/common';

/** Columns fetched for a track; keeps row objects small on memory-constrained devices. */
export const TRACK_COLUMNS = `
  id, provider, external_id, title, norm_title, artist_names, norm_artist, artist_ids,
  album_id, album_title, duration_ms, duration_bucket, artwork_url, external_url,
  stream_url, stream_expires_at, isrc, kind, genres, year, explicit, signature,
  created_at, updated_at
`;

/** Splits a comma-joined column, dropping empties. */
function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Domain model -> database row. */
export function rowToTrack(row: TrackRow): Track {
  return {
    id: dedupeKey(row.provider, row.external_id),
    provider: row.provider,
    externalId: row.external_id,
    title: row.title,
    artistIds: splitList(row.artist_ids),
    artistNames: splitList(row.artist_names),
    albumId: row.album_id ? String(row.album_id) : undefined,
    albumTitle: row.album_title ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    artworkUrl: row.artwork_url ?? undefined,
    externalUrl: row.external_url ?? undefined,
    streamUrl: row.stream_url ?? undefined,
    isrc: row.isrc ?? undefined,
    kind: (row.kind as Track['kind']) ?? 'unknown',
    genres: splitList(row.genres),
    year: row.year ?? undefined,
    explicit: row.explicit === 1,
  };
}

export function rowToArtist(row: ArtistRow): Artist {
  return {
    id: dedupeKey(row.provider, row.external_id),
    provider: row.provider,
    name: row.name,
    artworkUrl: row.artwork_url ?? undefined,
    externalUrl: row.external_url ?? undefined,
    followers: row.follower_count ?? undefined,
  };
}

export function rowToAlbum(row: AlbumRow): Album {
  return {
    id: dedupeKey(row.provider, row.external_id),
    provider: row.provider,
    title: row.title,
    artistId: row.artist_id ? String(row.artist_id) : undefined,
    artistName: row.artist_name,
    artworkUrl: row.artwork_url ?? undefined,
    externalUrl: row.external_url ?? undefined,
    year: row.year ?? undefined,
  };
}

/**
 * Inserts or updates a track by `(provider, external_id)`.
 *
 * Stream URLs are intentionally *not* overwritten by later catalogue writes: a
 * resolved URL is short-lived and a stale one is worse than none. They are only
 * set through `setTrackStream`.
 */
export async function upsertTrack(db: Database, track: Track): Promise<number> {
  const now = Date.now();
  const normTitle = normalizeTitle(track.title);
  const artistNames = track.artistNames.join(', ');
  const normArtist = normalizeArtist(...track.artistNames);
  const durationBucket =
    typeof track.durationMs === 'number' ? Math.round(track.durationMs / 1000 / 5) : null;

  await db.runAsync(
    `INSERT INTO tracks (
        provider, external_id, title, norm_title, artist_names, norm_artist, artist_ids,
        album_id, album_title, duration_ms, duration_bucket, artwork_url, external_url,
        isrc, kind, genres, year, explicit, signature, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, external_id) DO UPDATE SET
        title          = excluded.title,
        norm_title     = excluded.norm_title,
        artist_names   = excluded.artist_names,
        norm_artist    = excluded.norm_artist,
        artist_ids     = excluded.artist_ids,
        album_id       = COALESCE(excluded.album_id, tracks.album_id),
        album_title    = COALESCE(excluded.album_title, tracks.album_title),
        duration_ms    = COALESCE(excluded.duration_ms, tracks.duration_ms),
        duration_bucket= COALESCE(excluded.duration_bucket, tracks.duration_bucket),
        artwork_url    = COALESCE(excluded.artwork_url, tracks.artwork_url),
        external_url   = COALESCE(excluded.external_url, tracks.external_url),
        isrc           = COALESCE(excluded.isrc, tracks.isrc),
        kind           = excluded.kind,
        genres         = excluded.genres,
        year           = COALESCE(excluded.year, tracks.year),
        explicit       = excluded.explicit,
        signature      = excluded.signature,
        updated_at     = excluded.updated_at`,
    track.provider,
    track.externalId,
    track.title,
    normTitle,
    artistNames,
    normArtist,
    track.artistIds.join(', '),
    track.albumId ? Number(track.albumId) || null : null,
    track.albumTitle ?? null,
    track.durationMs ?? null,
    durationBucket,
    track.artworkUrl ?? null,
    track.externalUrl ?? null,
    track.isrc ?? null,
    track.kind,
    track.genres.join(', '),
    track.year ?? null,
    track.explicit ? 1 : 0,
    trackSignature(normTitle, normArtist, track.durationMs),
    now,
    now,
  );

  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM tracks WHERE provider = ? AND external_id = ?',
    track.provider,
    track.externalId,
  );
  return row?.id ?? 0;
}

/**
 * Batch upsert used when committing a page of search results.
 *
 * Runs in a single exclusive transaction: 200 individual round-trips to the
 * SQLite bridge would visibly stutter the UI.
 */
export async function upsertTracks(db: Database, tracks: readonly Track[]): Promise<number> {
  if (tracks.length === 0) return 0;
  await runTransaction(db, async (txn) => {
    for (const track of tracks) {
      await upsertTrack(txn, track);
    }
  });
  return tracks.length;
}

/** Local row id for a `provider:externalId` pair. */
export async function getTrackRowId(
  db: Database,
  provider: string,
  externalId: string,
): Promise<number | null> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM tracks WHERE provider = ? AND external_id = ?',
    provider,
    externalId,
  );
  return row?.id ?? null;
}

export async function getTrackByProviderId(
  db: Database,
  provider: string,
  externalId: string,
): Promise<Track | null> {
  const row = await db.getFirstAsync<TrackRow>(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE provider = ? AND external_id = ?`,
    provider,
    externalId,
  );
  return row ? rowToTrack(row) : null;
}

/**
 * Splits a composite track id (`provider:externalId`) back into its parts.
 * Provider ids never contain `:`, so the first colon is the separator; the
 * remainder is returned intact because external ids may contain colons.
 */
export function parseTrackId(trackId: string): { provider: string; externalId: string } | null {
  const separator = trackId.indexOf(':');
  if (separator <= 0 || separator === trackId.length - 1) return null;
  return { provider: trackId.slice(0, separator), externalId: trackId.slice(separator + 1) };
}

export async function getTrackById(db: Database, trackId: string): Promise<Track | null> {
  const parsed = parseTrackId(trackId);
  if (!parsed) return null;
  return getTrackByProviderId(db, parsed.provider, parsed.externalId);
}

/**
 * Batch fetch preserving the caller's order; missing ids are skipped.
 * Uses a single row-value `IN` query rather than one round-trip per id.
 */
/**
 * SQLite's compiled-in variable ceiling is the hard limit here: each id costs
 * two bind parameters, so batches are sized against the *lowest* limit any
 * supported Android build ships with rather than the platform default.
 */
const ID_LOOKUP_BATCH = 400;

export async function getTracksByIds(db: Database, ids: readonly string[]): Promise<Track[]> {
  const parsed = Array.from(
    new Map(
      ids
        .map(parseTrackId)
        .filter((value): value is { provider: string; externalId: string } => value !== null)
        .map((value) => [dedupeKey(value.provider, value.externalId), value]),
    ).values(),
  );

  if (parsed.length === 0) return [];

  const rows: TrackRow[] = [];
  for (const batch of chunk(parsed, ID_LOOKUP_BATCH)) {
    const valuesPlaceholders = batch.map(() => '(?, ?)').join(', ');
    const params: (string | number)[] = [];
    for (const entry of batch) params.push(entry.provider, entry.externalId);

    rows.push(
      ...(await db.getAllAsync<TrackRow>(
        `SELECT ${TRACK_COLUMNS}
           FROM tracks
          WHERE (provider, external_id) IN (VALUES ${valuesPlaceholders})`,
        params,
      )),
    );
  }

  const byKey = new Map(rows.map((row) => [dedupeKey(row.provider, row.external_id), row]));
  return parsed
    .map((entry) => byKey.get(dedupeKey(entry.provider, entry.externalId)))
    .filter((row): row is TrackRow => Boolean(row))
    .map(rowToTrack);
}

/** Resolves the numeric row id for a composite track id. */
export async function getTrackRowIdByTrackId(
  db: Database,
  trackId: string,
): Promise<number | null> {
  const parsed = parseTrackId(trackId);
  if (!parsed) return null;
  return getTrackRowId(db, parsed.provider, parsed.externalId);
}

/**
 * Stores a freshly resolved stream URL. Always short-lived: the player
 * re-resolves on demand rather than trusting a persisted URL.
 */
export async function setTrackStream(
  db: Database,
  trackId: string,
  url: string | null,
  expiresAt?: number,
): Promise<void> {
  const rowId = await getTrackRowIdByTrackId(db, trackId);
  if (!rowId) return;
  await db.runAsync(
    'UPDATE tracks SET stream_url = ?, stream_expires_at = ?, updated_at = ? WHERE id = ?',
    url,
    expiresAt ?? null,
    Date.now(),
    rowId,
  );
}

/**
 * Local search over cached tracks: FTS5 when available, otherwise indexed
 * prefix `LIKE`. Ordered by best match so callers can slice a page.
 */
export async function searchLocalTracks(
  db: Database,
  query: string,
  limit = 50,
): Promise<Track[]> {
  const normalized = normalizeTitle(query);
  if (normalized.length === 0) return [];

  const ftsIds = await searchTrackIds(db, normalized, limit);
  if (ftsIds.length > 0) {
    return getTracksByRowIds(db, ftsIds, limit);
  }

  const rows = await db.getAllAsync<TrackRow>(
    `SELECT ${TRACK_COLUMNS}
       FROM tracks
      WHERE norm_title LIKE ? OR norm_artist LIKE ?
      ORDER BY norm_title
      LIMIT ?`,
    `${normalized}%`,
    `${normalized}%`,
    limit,
  );
  return rows.map(rowToTrack);
}

/** Fetches by numeric row id, preserving the given order. */
export async function getTracksByRowIds(
  db: Database,
  rowIds: readonly number[],
  limit = 50,
): Promise<Track[]> {
  const ids = Array.from(new Set(rowIds)).slice(0, limit);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync<TrackRow>(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE id IN (${placeholders})`,
    ids,
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is TrackRow => Boolean(row)).map(rowToTrack);
}

export async function countTracks(db: Database): Promise<number> {
  const row = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM tracks');
  return row?.count ?? 0;
}

/**
 * Catalogue scan for the local recommender, newest-updated first. Bounds the
 * working set so a large cache never loads into memory in one go.
 */
export async function getAllCachedTracks(db: Database, limit = 1500): Promise<Track[]> {
  const rows = await db.getAllAsync<TrackRow>(
    `SELECT ${TRACK_COLUMNS} FROM tracks ORDER BY updated_at DESC LIMIT ?`,
    limit,
  );
  return rows.map(rowToTrack);
}

/** Tracks of an album, in album order. */
export async function getAlbumTracks(db: Database, albumRowId: number): Promise<Track[]> {
  const rows = await db.getAllAsync<TrackRow>(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE album_id = ? ORDER BY id ASC LIMIT 500`,
    albumRowId,
  );
  return rows.map(rowToTrack);
}

/** True when the track is favorited. */
export async function isFavorite(db: Database, trackId: string): Promise<boolean> {
  const rowId = await getTrackRowIdByTrackId(db, trackId);
  if (!rowId) return false;
  const row = await db.getFirstAsync<CountRow>(
    'SELECT COUNT(*) AS count FROM favorites WHERE track_id = ?',
    rowId,
  );
  return (row?.count ?? 0) > 0;
}

/** Total tracks per provider, used by the Settings debug panel. */
export async function getTrackCountsByProvider(db: Database): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ provider: string; count: number }>(
    'SELECT provider, COUNT(*) AS count FROM tracks GROUP BY provider ORDER BY count DESC',
  );
  const out: Record<string, number> = {};
  for (const row of rows) out[row.provider] = row.count;
  return out;
}