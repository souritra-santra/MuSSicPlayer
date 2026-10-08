import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { recordSearch, searchLocalTracks, type Database } from '@/services/database';
import { unifiedSearch } from '@/services/search';
import { useSettingsStore } from '@/store/settings';
import type { UnifiedSearchResults } from '@/types';
import { normalizeText, tokenSimilarity } from '@/utils/normalize';

import { useReadyDatabase } from './useDatabase';
import { useCacheTracks } from './useLibrary';
import { queryKeys } from './useQueryKeys';

/**
 * Unified search hook.
 *
 * Combines live provider results with the local SQLite cache: cached rows are
 * merged in so a previously-searched track shows instantly (and stays available
 * offline), while the provider results refine the ranking.
 */

export type SearchResponse = UnifiedSearchResults & {
  /** Rows sourced from the local cache rather than a live provider. */
  localMatchCount: number;
};

export function useUnifiedSearch(query: string) {
  const db = useReadyDatabase();
  const queryClient = useQueryClient();
  const cacheSearchResults = useSettingsStore((state) => state.cacheSearchResults);
  const excludeExplicit = useSettingsStore((state) => state.excludeExplicit);
  const cacheTracks = useCacheTracks();

  const normalized = normalizeText(query);

  const queryResult = useQuery({
    queryKey: queryKeys.search(query, { excludeExplicit }),
    enabled: Boolean(db) && normalized.length > 0,
    queryFn: async (): Promise<SearchResponse> => {
      const handle = db as Database;

      // Fan out to providers first so their results anchor the ranking; the
      // local cache is additive and never blocks on the network.
      const remote = await unifiedSearch({ query, options: { limit: 20 } });
      const local = await searchLocalTracks(handle, normalized, 20);

      const remoteTrackIds = new Set(
        remote.sections.flatMap((section) => section.tracks.map((entry) => entry.track.id)),
      );
      const localOnly = local.filter((track) => !remoteTrackIds.has(track.id));

      // Persist what we saw so the next visit of the same query is instant.
      const allRemoteTracks = remote.sections.flatMap((section) => section.tracks.map((e) => e.track));
      if (cacheSearchResults) cacheTracks(allRemoteTracks);

      void recordSearch(handle, query, remote.sections.reduce((n, s) => n + s.tracks.length, 0)).catch(
        () => undefined,
      );

      const sections = excludeExplicit
        ? remote.sections.map((section) => ({
            ...section,
            tracks: section.tracks.filter((entry) => entry.track.explicit !== true),
          }))
        : remote.sections;

      return {
        ...remote,
        sections,
        localMatchCount: localOnly.length,
      };
    },
  });

  // The recent-searches chip row lives on the same screen, so refresh it as
  // soon as a query lands. Done in an effect rather than a query callback
  // because `onSuccess` was removed from `useQuery` in TanStack Query v5.
  useEffect(() => {
    if (!queryResult.isSuccess) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.recentSearches() });
  }, [queryResult.isSuccess, queryResult.dataUpdatedAt, queryClient]);

  return queryResult;
}

/**
 * Quick local-only suggestions for the search box. Deliberately synchronous
 * against SQLite so the dropdown does not flash while providers respond.
 */
export function useLocalSuggestions(query: string, limit = 6) {
  const db = useReadyDatabase();
  const normalized = normalizeText(query);

  return useQuery({
    queryKey: ['search', 'local', normalized, limit],
    enabled: Boolean(db) && normalized.length >= 2,
    queryFn: async () => {
      const tracks = await searchLocalTracks(db as Database, normalized, limit * 3);
      return tracks
        .map((track) => ({
          track,
          score: tokenSimilarity(normalized.split(' '), [
            ...track.title.toLowerCase().split(' '),
            ...track.artistNames.join(' ').toLowerCase().split(' '),
          ]),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  });
}