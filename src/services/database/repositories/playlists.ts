import type { Playlist, Track } from '@/types';

import { runTransaction } from '../transaction';
import type { Database } from '../client';
import type { PlaylistRow, PlaylistWithCountRow } from '../rows';
import { getTrackRowIdByTrackId, getTracksByRowIds, parseTrackId } from './tracks';

function rowToPlaylist(row: PlaylistWithCountRow | PlaylistRow): Playlist {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description ?? undefined,
    artworkUrl: row.artwork_url ?? undefined,
    trackCount: 'track_count' in row ? row.track_count : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    system: row.system === 1,
  };
}

export async function createPlaylist(
  db: Database,
  name: string,
  description?: string,
): Promise<Playlist> {
  const now = Date.now();
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Playlist name cannot be empty');

  const result = await db.runAsync(
    'INSERT INTO playlists (name, description, system, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
    trimmed,
    description?.trim() || null,
    now,
    now,
  );
  return {
    id: String(result.lastInsertRowId),
    name: trimmed,
    description,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getPlaylists(db: Database): Promise<Playlist[]> {
  const rows = await db.getAllAsync<PlaylistWithCountRow>(
    `SELECT p.id, p.name, p.description, p.artwork_url, p.system, p.created_at, p.updated_at,
            (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
       FROM playlists p
      ORDER BY p.system DESC, p.updated_at DESC`,
  );
  return rows.map(rowToPlaylist);
}

export async function getPlaylistById(db: Database, id: string): Promise<Playlist | null> {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  const row = await db.getFirstAsync<PlaylistWithCountRow>(
    `SELECT p.id, p.name, p.description, p.artwork_url, p.system, p.created_at, p.updated_at,
            (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
       FROM playlists p
      WHERE p.id = ?`,
    numericId,
  );
  return row ? rowToPlaylist(row) : null;
}

export async function renamePlaylist(
  db: Database,
  id: string,
  name: string,
): Promise<boolean> {
  const numericId = Number(id);
  const trimmed = name.trim();
  if (!Number.isFinite(numericId) || trimmed.length === 0) return false;
  const result = await db.runAsync(
    'UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND system = 0',
    trimmed,
    Date.now(),
    numericId,
  );
  return result.changes > 0;
}

/** System playlists (Favourites, Recently added) cannot be deleted. */
export async function deletePlaylist(db: Database, id: string): Promise<boolean> {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return false;
  const result = await db.runAsync('DELETE FROM playlists WHERE id = ? AND system = 0', numericId);
  return result.changes > 0;
}

export async function countPlaylists(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM playlists');
  return row?.count ?? 0;
}

/**
 * Appends a track. Position is assigned as max+1 so the ordering survives
 * without renumbering the whole table.
 */
export async function addTrackToPlaylist(
  db: Database,
  playlistId: string,
  trackId: string,
): Promise<boolean> {
  const numericPlaylistId = Number(playlistId);
  const trackRowId = await getTrackRowIdByTrackId(db, trackId);
  if (!Number.isFinite(numericPlaylistId) || !trackRowId) return false;

  let added = false;
  await runTransaction(db, async (txn) => {
    const existing = await txn.getFirstAsync<{ id: number }>(
      'SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      numericPlaylistId,
      trackRowId,
    );
    if (existing) return;

    const row = await txn.getFirstAsync<{ next: number | null }>(
      'SELECT MAX(position) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?',
      numericPlaylistId,
    );
    const position = row?.next ?? 0;
    await txn.runAsync(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)',
      numericPlaylistId,
      trackRowId,
      position,
      Date.now(),
    );
    await txn.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?', Date.now(), numericPlaylistId);
    added = true;
  });
  return added;
}

export async function removeTrackFromPlaylist(
  db: Database,
  playlistId: string,
  trackId: string,
): Promise<boolean> {
  const numericPlaylistId = Number(playlistId);
  const trackRowId = await getTrackRowIdByTrackId(db, trackId);
  if (!Number.isFinite(numericPlaylistId) || !trackRowId) return false;

  let removed = false;
  await runTransaction(db, async (txn) => {
    const result = await txn.runAsync(
      'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      numericPlaylistId,
      trackRowId,
    );
    if (result.changes > 0) {
      await txn.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?', Date.now(), numericPlaylistId);
      removed = true;
    }
  });
  return removed;
}

/** Playlist contents in user-defined order. */
export async function getPlaylistTracks(
  db: Database,
  playlistId: string,
  limit = 500,
): Promise<Track[]> {
  const numericPlaylistId = Number(playlistId);
  if (!Number.isFinite(numericPlaylistId)) return [];
  const rows = await db.getAllAsync<{ track_id: number }>(
    `SELECT track_id FROM playlist_tracks
      WHERE playlist_id = ?
      ORDER BY position ASC
      LIMIT ?`,
    numericPlaylistId,
    limit,
  );
  return getTracksByRowIds(
    db,
    rows.map((row) => row.track_id),
    limit,
  );
}

/**
 * Persists a full ordering after a drag-and-drop reorder. Runs in one
 * transaction so the playlist is never observed in a half-moved state.
 */
export async function reorderPlaylistTracks(
  db: Database,
  playlistId: string,
  orderedTrackIds: readonly string[],
): Promise<boolean> {
  const numericPlaylistId = Number(playlistId);
  if (!Number.isFinite(numericPlaylistId)) return false;

  const entries = orderedTrackIds
    .map(parseTrackId)
    .filter((value): value is { provider: string; externalId: string } => value !== null);

  if (entries.length === 0) return false;

  let reordered = false;
  await runTransaction(db, async (txn) => {
    for (const [index, entry] of entries.entries()) {
      await txn.runAsync(
        `UPDATE playlist_tracks
            SET position = ?
          WHERE playlist_id = ?
            AND track_id = (SELECT id FROM tracks WHERE provider = ? AND external_id = ?)`,
        index,
        numericPlaylistId,
        entry.provider,
        entry.externalId,
      );
    }
    await txn.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?', Date.now(), numericPlaylistId);
    reordered = true;
  });
  return reordered;
}