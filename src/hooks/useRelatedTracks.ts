import { useQuery } from '@tanstack/react-query';

import type { Track } from '@/types';
import { relatedToTrack, type RecommendedShelf } from '@/services/recommendations';
import type { Database } from '@/services/database';
import { shortHash } from '@/utils/common';

import { useReadyDatabase } from './useDatabase';
import { queryKeys } from './useQueryKeys';

/** Stable key for the exclude id list; bounded so the query key stays small. */
function excludeKey(ids: readonly string[]): string {
  const bounded = ids.slice(0, 80).sort().join('|');
  return bounded.length === 0 ? '-' : shortHash(bounded);
}

export type RelatedMusicResult = {
  readonly sameArtist: RecommendedShelf | null;
  readonly moreLikeThis: RecommendedShelf | null;
};

/**
 * Search-side suggestions ("More from this artist", "Related music") seeded by
 * a resolved search hit. Local catalogue only — instant, offline, and free of
 * any provider round-trip.
 */
export function useRelatedTracks(
  seed: Track | null,
  excludeIds: readonly string[],
): { related: RelatedMusicResult | null; loading: boolean } {
  const db = useReadyDatabase();

  const query = useQuery({
    queryKey: queryKeys.related(seed?.id ?? '', excludeKey(excludeIds)),
    enabled: Boolean(db) && Boolean(seed),
    staleTime: 15 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async (): Promise<RelatedMusicResult> => {
      // Guard for the nullable seed.
      if (!seed) return { sameArtist: null, moreLikeThis: null };
      return relatedToTrack(db as Database, seed, new Set(excludeIds));
    },
  });

  return { related: query.data ?? null, loading: query.isFetching && query.data === undefined };
}