import type { Database } from './client';

/**
 * Full-text search over the local track cache.
 *
 * Uses an FTS5 *external content* table (`content='tracks'`): the index stores
 * only the inverted index, not a second copy of the titles, which matters when
 * the library grows. Synchronization is handled by triggers so no repository
 * code has to remember to update the index.
 *
 * FTS5 availability is detected at runtime. The bundled Android SQLite ships it
 * (the `expo-sqlite` config plugin sets `enableFTS: true`), but some platform
 * builds and the web/wasm target do not — so every entry point degrades to
 * indexed `LIKE` prefix matching rather than failing.
 */

export type FtsSupport = {
  readonly available: boolean;
  readonly reason?: string;
};

let support: FtsSupport | null = null;

const CREATE_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
    title,
    artist_names,
    content='tracks',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  );
`;

const CREATE_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS tracks_fts_ai AFTER INSERT ON tracks BEGIN
    INSERT INTO tracks_fts(rowid, title, artist_names)
    VALUES (new.id, new.title, new.artist_names);
  END;

  CREATE TRIGGER IF NOT EXISTS tracks_fts_ad AFTER DELETE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist_names)
    VALUES ('delete', old.id, old.title, old.artist_names);
  END;

  CREATE TRIGGER IF NOT EXISTS tracks_fts_au AFTER UPDATE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist_names)
    VALUES ('delete', old.id, old.title, old.artist_names);
    INSERT INTO tracks_fts(rowid, title, artist_names)
    VALUES (new.id, new.title, new.artist_names);
  END;
`;

export async function getFtsSupport(db: Database): Promise<FtsSupport> {
  if (support) return support;
  try {
    await db.execAsync(CREATE_FTS);
    await db.execAsync(CREATE_TRIGGERS);
    support = { available: true };
  } catch (error) {
    support = {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return support;
}

/** Rebuilds the index from `tracks` — call after a bulk import. */
export async function rebuildFtsIndex(db: Database): Promise<boolean> {
  const { available } = await getFtsSupport(db);
  if (!available) return false;
  await db.execAsync(`INSERT INTO tracks_fts(tracks_fts) VALUES ('rebuild');`);
  return true;
}

/**
 * Builds an FTS5 MATCH expression from free-text input.
 *
 * Tokens are already normalized (lowercase alphanumerics) by
 * `utils/normalize`, but punctuation is stripped again here so a raw user
 * string can never inject FTS operators (`NEAR`, `*`, `^`, `:`).
 */
export function buildFtsMatchExpression(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return null;

  const prefixTokens = tokens.map((token) => `${token}*`);
  // Prefer AND (all tokens present), fall back to OR (any token present) so a
  // long query string still returns something useful.
  return prefixTokens.length > 1
    ? `(${prefixTokens.join(' AND ')}) OR (${prefixTokens.join(' OR ')})`
    : prefixTokens[0];
}

/**
 * Returns track ids ordered by FTS relevance. Callers re-rank and slice, so the
 * limit is a safety bound rather than the page size.
 */
export async function searchTrackIds(
  db: Database,
  query: string,
  limit = 200,
): Promise<number[]> {
  const { available } = await getFtsSupport(db);
  if (!available) return [];

  const match = buildFtsMatchExpression(query);
  if (!match) return [];

  try {
    const rows = await db.getAllAsync<{ track_id: number }>(
      `SELECT rowid AS track_id
         FROM tracks_fts
        WHERE tracks_fts MATCH ?
        ORDER BY rank
        LIMIT ?`,
      match,
      limit,
    );
    return rows.map((row) => row.track_id);
  } catch {
    // A malformed MATCH expression must never break search.
    return [];
  }
}