import { useQuery } from '@tanstack/react-query';

import { fetchTrendingShelves, type RecommendedShelf } from '@/services/recommendations';
import type { Database } from '@/services/database';
import { useSettingsStore } from '@/store/settings';

import { useConnectivity } from './useConnectivity';
import { useReadyDatabase } from './useDatabase';
import { queryKeys } from './useQueryKeys';

/**
 * Provider-backed "Trending now" shelf for the home screen.
 *
 * Deliberately a separate query from `useHomeData`: the local shelves must
 * render instantly and offline, while this one may hit the network, so it is
 * allowed to arrive later and is cached in SQLite by the service.
 */
export function useTrendingShelf(): { shelf: RecommendedShelf | null; loading: boolean } {
  const db = useReadyDatabase();
  const { isOnline } = useConnectivity();
  const revision = useSettingsStore((state) => state.revision);

  const query = useQuery({
    queryKey: queryKeys.trending(revision),
    enabled: Boolean(db) && isOnline,
    // Provider feeds are near-static over the day; half an hour between
    // refetches keeps the rail fresh without spamming upstreams.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async (): Promise<RecommendedShelf | null> => {
      // The query is disabled until the database is open, so the cast is safe
      // by construction here.
      return fetchTrendingShelves(db as Database);
    },
  });

  return { shelf: query.data ?? null, loading: query.isFetching && query.data === undefined };
}