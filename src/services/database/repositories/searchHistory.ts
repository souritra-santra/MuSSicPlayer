import type { Database } from '../client';
import { SEARCH_HISTORY_LIMIT } from '../maintenance';
import type { SearchHistoryRow } from '../rows';
import { normalizeText } from '@/utils/normalize';

/**
 * Upserts a search term. Re-searching an existing term bumps `searched_at`
 * rather than inserting a duplicate, which makes the row itself the frequency
 * signal for "what does this user usually look for".
 */
export async function recordSearch(
  db: Database,
  query: string,
  resultCount: number,
): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return;

  await db.runAsync(
    `INSERT INTO search_history (query, norm_query, result_count, searched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (query) DO UPDATE SET
       searched_at  = excluded.searched_at,
       result_count = excluded.result_count,
       norm_query   = excluded.norm_query`,
    trimmed,
    normalizeText(trimmed),
    resultCount,
    Date.now(),
  );
}

export async function getSearchHistory(db: Database, limit = 20): Promise<SearchHistoryRow[]> {
  return db.getAllAsync<SearchHistoryRow>(
    `SELECT id, query, norm_query, result_count, searched_at
       FROM search_history
      ORDER BY searched_at DESC
      LIMIT ?`,
    limit,
  );
}

export async function getRecentSearchQueries(db: Database, limit = 8): Promise<string[]> {
  const rows = await db.getAllAsync<SearchHistoryRow>(
    `SELECT query, norm_query, result_count, searched_at
       FROM search_history
      ORDER BY searched_at DESC
      LIMIT ?`,
    limit,
  );
  return rows.map((row) => row.query);
}

export async function removeSearchEntry(db: Database, query: string): Promise<boolean> {
  const result = await db.runAsync('DELETE FROM search_history WHERE query = ?', query);
  return result.changes > 0;
}

export async function clearSearchHistory(db: Database): Promise<number> {
  const result = await db.runAsync('DELETE FROM search_history');
  return result.changes;
}

/** Caps the table; run from maintenance on start. */
export async function pruneSearchHistory(
  db: Database,
  keep = SEARCH_HISTORY_LIMIT,
): Promise<number> {
  const row = await db.getFirstAsync<{ cutoff: number | null }>(
    `SELECT MIN(id) AS cutoff
       FROM (
         SELECT id FROM search_history ORDER BY searched_at DESC LIMIT -1 OFFSET ?
       )`,
    keep,
  );
  if (!row?.cutoff) return 0;
  const result = await db.runAsync('DELETE FROM search_history WHERE id <= ?', row.cutoff);
  return result.changes;
}

/**
 * Query completions for the search box: prefix matches on the normalized term,
 * ranked by recency and result count.
 */
export async function suggestQueries(
  db: Database,
  prefix: string,
  limit = 5,
): Promise<string[]> {
  const normalized = normalizeText(prefix);
  if (normalized.length === 0) return [];
  const rows = await db.getAllAsync<{ query: string }>(
    `SELECT query
       FROM search_history
      WHERE norm_query LIKE ? OR query LIKE ?
      ORDER BY searched_at DESC
      LIMIT ?`,
    `${normalized}%`,
    `${prefix}%`,
    limit,
  );
  return rows.map((row) => row.query);
}