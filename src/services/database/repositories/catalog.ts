import type { Album, Artist } from '@/types';
import { normalizeText } from '@/utils/normalize';

import { runTransaction } from '../transaction';
import type { Database } from '../client';
import type { AlbumRow, ArtistRow, CountRow } from '../rows';
import { rowToAlbum, rowToArtist } from './tracks';

/** Columns fetched for an artist. */
const ARTIST_COLUMNS = `id, provider, external_id, name, norm_name, artwork_url, external_url, follower_count, created_at, updated_at`;
const ALBUM_COLUMNS = `id, provider, external_id, title, norm_title, artist_id, artist_name, artwork_url, external_url, year, created_at, updated_at`;

export async function upsertArtist(db: Database, artist: Artist): Promise<number> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO artists (
        provider, external_id, name, norm_name, artwork_url, external_url,
        follower_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, external_id) DO UPDATE SET
        name           = excluded.name,
        norm_name      = excluded.norm_name,
        artwork_url    = COALESCE(excluded.artwork_url, artists.artwork_url),
        external_url   = COALESCE(excluded.external_url, artists.external_url),
        follower_count = COALESCE(excluded.follower_count, artists.follower_count),
        updated_at     = excluded.updated_at`,
    artist.provider,
    artist.id,
    artist.name,
    normalizeText(artist.name),
    artist.artworkUrl ?? null,
    artist.externalUrl ?? null,
    artist.followers ?? null,
    now,
    now,
  );

  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM artists WHERE provider = ? AND external_id = ?',
    artist.provider,
    artist.id,
  );
  return row?.id ?? 0;
}

export async function upsertArtists(db: Database, artists: readonly Artist[]): Promise<void> {
  if (artists.length === 0) return;
  await runTransaction(db, async (txn) => {
    for (const artist of artists) await upsertArtist(txn, artist);
  });
}

export async function getArtistByProviderId(
  db: Database,
  provider: string,
  externalId: string,
): Promise<Artist | null> {
  const row = await db.getFirstAsync<ArtistRow>(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE provider = ? AND external_id = ?`,
    provider,
    externalId,
  );
  return row ? rowToArtist(row) : null;
}

export async function countArtists(db: Database): Promise<number> {
  const row = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM artists');
  return row?.count ?? 0;
}

/**
 * Top artists by play count â€” feeds "Artists you play" and the artist-affinity
 * half of the recommender.
 */
export async function getTopArtists(
  db: Database,
  limit = 20,
): Promise<{ artist: Artist; playCount: number }[]> {
  const rows = await db.getAllAsync<ArtistRow & { play_count: number }>(
    `SELECT ${ARTIST_COLUMNS.split(', ')
      .map((column) => `a.${column.trim()}`)
      .join(', ')}, s.play_count AS play_count
       FROM artist_stats s
       JOIN artists a ON a.id = s.artist_id
      WHERE s.play_count > 0
      ORDER BY s.play_count DESC
      LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({ artist: rowToArtist(row), playCount: row.play_count }));
}

export async function upsertAlbum(db: Database, album: Album): Promise<number> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO albums (
        provider, external_id, title, norm_title, artist_id, artist_name,
        artwork_url, external_url, year, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, external_id) DO UPDATE SET
        title        = excluded.title,
        norm_title   = excluded.norm_title,
        artist_id    = COALESCE(excluded.artist_id, albums.artist_id),
        artist_name  = COALESCE(NULLIF(excluded.artist_name, ''), albums.artist_name),
        artwork_url  = COALESCE(excluded.artwork_url, albums.artwork_url),
        external_url = COALESCE(excluded.external_url, albums.external_url),
        year         = COALESCE(excluded.year, albums.year),
        updated_at   = excluded.updated_at`,
    album.provider,
    album.id,
    album.title,
    normalizeText(album.title),
    album.artistId ? Number(album.artistId) || null : null,
    album.artistName,
    album.artworkUrl ?? null,
    album.externalUrl ?? null,
    album.year ?? null,
    now,
    now,
  );

  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM albums WHERE provider = ? AND external_id = ?',
    album.provider,
    album.id,
  );
  return row?.id ?? 0;
}

export async function upsertAlbums(db: Database, albums: readonly Album[]): Promise<void> {
  if (albums.length === 0) return;
  await runTransaction(db, async (txn) => {
    for (const album of albums) await upsertAlbum(txn, album);
  });
}

export async function getAlbumByProviderId(
  db: Database,
  provider: string,
  externalId: string,
): Promise<Album | null> {
  const row = await db.getFirstAsync<AlbumRow>(
    `SELECT ${ALBUM_COLUMNS} FROM albums WHERE provider = ? AND external_id = ?`,
    provider,
    externalId,
  );
  return row ? rowToAlbum(row) : null;
}

export async function countAlbums(db: Database): Promise<number> {
  const row = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM albums');
  return row?.count ?? 0;
}

/** Recent albums from the local cache (album_id is set on cached tracks). */
export async function getRecentAlbums(db: Database, limit = 12): Promise<Album[]> {
  const rows = await db.getAllAsync<AlbumRow>(
    `SELECT ${ALBUM_COLUMNS}
       FROM albums
      WHERE id IN (SELECT album_id FROM tracks WHERE album_id IS NOT NULL)
      ORDER BY updated_at DESC
      LIMIT ?`,
    limit,
  );
  return rows.map(rowToAlbum);
}