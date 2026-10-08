import { runTransaction } from './transaction';
import type { Database } from './client';

/**
 * Forward-only, versioned migrations.
 *
 * `PRAGMA user_version` is the single source of truth for the schema version â€”
 * no separate bookkeeping table, which keeps startup work to one integer read.
 * Never edit an applied migration: append a new one and bump `SCHEMA_VERSION`.
 */
export type Migration = {
  readonly version: number;
  readonly name: string;
  readonly up: (db: Database) => Promise<void>;
};

const v1: Migration = {
  version: 1,
  name: 'initial-library-schema',
  up: async (db) => {
    await db.execAsync(`
      ------------------------------------------------------------------
      -- Catalogue: artists / albums / tracks (metadata + references only,
      -- never audio bytes â€” see instruction.md "Store metadata").
      ------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS artists (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        provider       TEXT    NOT NULL,
        external_id    TEXT    NOT NULL,
        name           TEXT    NOT NULL,
        norm_name      TEXT    NOT NULL,
        artwork_url    TEXT,
        external_url   TEXT,
        follower_count INTEGER,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        UNIQUE (provider, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_artists_norm_name ON artists(norm_name);
      CREATE INDEX IF NOT EXISTS idx_artists_provider   ON artists(provider);

      CREATE TABLE IF NOT EXISTS albums (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        provider       TEXT    NOT NULL,
        external_id    TEXT    NOT NULL,
        title          TEXT    NOT NULL,
        norm_title     TEXT    NOT NULL,
        artist_id      INTEGER REFERENCES artists(id) ON DELETE SET NULL,
        artist_name    TEXT    NOT NULL DEFAULT '',
        artwork_url    TEXT,
        external_url   TEXT,
        year           INTEGER,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        UNIQUE (provider, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_albums_norm_title ON albums(norm_title);
      CREATE INDEX IF NOT EXISTS idx_albums_artist     ON albums(artist_id);

      CREATE TABLE IF NOT EXISTS tracks (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        provider       TEXT    NOT NULL,
        external_id    TEXT    NOT NULL,
        title          TEXT    NOT NULL,
        norm_title     TEXT    NOT NULL,
        artist_names   TEXT    NOT NULL DEFAULT '',
        norm_artist    TEXT    NOT NULL DEFAULT '',
        artist_ids     TEXT    NOT NULL DEFAULT '',
        album_id       INTEGER REFERENCES albums(id) ON DELETE SET NULL,
        album_title    TEXT,
        duration_ms    INTEGER,
        duration_bucket INTEGER,
        artwork_url    TEXT,
        external_url   TEXT,
        stream_url     TEXT,
        stream_expires_at INTEGER,
        isrc           TEXT,
        kind           TEXT    NOT NULL DEFAULT 'unknown',
        genres         TEXT    NOT NULL DEFAULT '',
        year           INTEGER,
        explicit       INTEGER NOT NULL DEFAULT 0,
        signature      TEXT    NOT NULL DEFAULT '',
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        UNIQUE (provider, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tracks_norm_title  ON tracks(norm_title);
      CREATE INDEX IF NOT EXISTS idx_tracks_norm_artist ON tracks(norm_artist);
      CREATE INDEX IF NOT EXISTS idx_tracks_signature   ON tracks(signature);
      CREATE INDEX IF NOT EXISTS idx_tracks_album       ON tracks(album_id);
      CREATE INDEX IF NOT EXISTS idx_tracks_kind        ON tracks(kind);

      ------------------------------------------------------------------
      -- User library
      ------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS favorites (
        track_id   INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_favorites_created ON favorites(created_at DESC);

      CREATE TABLE IF NOT EXISTS playlists (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT,
        artwork_url TEXT,
        system      INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        added_at    INTEGER NOT NULL,
        UNIQUE (playlist_id, track_id)
      );
      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position
        ON playlist_tracks(playlist_id, position);
      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track
        ON playlist_tracks(track_id);

      ------------------------------------------------------------------
      -- Listening signals (feed the local recommender in Phase 5)
      ------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS play_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        played_at  INTEGER NOT NULL,
        play_ms    INTEGER NOT NULL DEFAULT 0,
        completed  INTEGER NOT NULL DEFAULT 0,
        context    TEXT    NOT NULL DEFAULT 'library'
      );
      CREATE INDEX IF NOT EXISTS idx_play_history_time  ON play_history(played_at DESC);
      CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id);

      -- Rolling aggregates; play_history is pruned, these survive forever.
      CREATE TABLE IF NOT EXISTS play_stats (
        track_id        INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        play_count      INTEGER NOT NULL DEFAULT 0,
        skip_count      INTEGER NOT NULL DEFAULT 0,
        total_ms        INTEGER NOT NULL DEFAULT 0,
        first_played_at INTEGER,
        last_played_at  INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_play_stats_plays ON play_stats(play_count DESC);
      CREATE INDEX IF NOT EXISTS idx_play_stats_last  ON play_stats(last_played_at DESC);

      CREATE TABLE IF NOT EXISTS artist_stats (
        artist_id      INTEGER PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
        artist_name    TEXT    NOT NULL DEFAULT '',
        norm_name      TEXT    NOT NULL DEFAULT '',
        play_count     INTEGER NOT NULL DEFAULT 0,
        skip_count     INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_artist_stats_plays ON artist_stats(play_count DESC);

      CREATE TABLE IF NOT EXISTS genre_stats (
        genre          TEXT    PRIMARY KEY,
        play_count     INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_genre_stats_plays ON genre_stats(play_count DESC);

      ------------------------------------------------------------------
      -- Search / queue / cache / settings
      ------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS search_history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        query        TEXT    NOT NULL,
        norm_query   TEXT    NOT NULL,
        result_count INTEGER NOT NULL DEFAULT 0,
        searched_at  INTEGER NOT NULL,
        UNIQUE (query)
      );
      CREATE INDEX IF NOT EXISTS idx_search_history_time ON search_history(searched_at DESC);

      CREATE TABLE IF NOT EXISTS queue_items (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position   INTEGER NOT NULL,
        context    TEXT    NOT NULL DEFAULT 'queue',
        added_at   INTEGER NOT NULL,
        UNIQUE (track_id)
      );
      CREATE INDEX IF NOT EXISTS idx_queue_position ON queue_items(position);

      CREATE TABLE IF NOT EXISTS cache_entries (
        cache_key   TEXT    PRIMARY KEY,
        provider    TEXT    NOT NULL DEFAULT '',
        payload     TEXT    NOT NULL,
        expires_at  INTEGER NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(expires_at);

      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  },
};

const v2: Migration = {
  version: 2,
  name: 'recommender-support-indexes',
  up: async (db) => {
    await db.execAsync(`
      -- The local recommender scans the newest cache rows for candidates.
      CREATE INDEX IF NOT EXISTS idx_tracks_updated ON tracks(updated_at DESC);

      -- "Because you listened to" joins play_history to itself over a one-hour
      -- window per seed track; make that range probe cheap instead of scanning.
      CREATE INDEX IF NOT EXISTS idx_play_history_pair
        ON play_history(track_id, played_at);
    `);
  },
};

export const MIGRATIONS: readonly Migration[] = [v1, v2];

/**
 * Applies any migrations newer than `PRAGMA user_version`, each in its own
 * exclusive transaction so a failure leaves the version untouched and the next
 * launch retries cleanly.
 */
export async function runMigrations(db: Database, targetVersion: number): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current >= targetVersion) return;

  const pending = MIGRATIONS.filter((m) => m.version > current && m.version <= targetVersion)
    // Defensive: a broken manifest should not skip a version.
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await runTransaction(db, async (txn) => {
      await migration.up(txn);
      await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

/** Current schema version without opening a connection. */
export async function getSchemaVersion(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}