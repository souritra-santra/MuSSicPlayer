import type { Track } from '@/types';
import { getCacheEntry, setCacheEntry, type Database } from '@/services/database';
import { getEnabledProviders } from '@/services/providers';
import { mapWithConcurrency, uniqueBy, withTimeout } from '@/utils/common';

import type { RecommendedShelf } from './shelves';

/**
 * Provider-backed "Trending now".
 *
 * Providers with a real trending feed (`demo`, `jamendo`, `audius`) return
 * their popular tracks; the strongest responses are merged into one shelf.
 * Results are cached in SQLite for half an hour so returning home does not
 * re-hit three upstreams, and every provider call is bounded by a timeout so a
 * slow upstream degrades the shelf, not the screen.
 */

export const TRENDING_CACHE_KEY = 'recommendations:trending:v1';
export const TRENDING_TTL_MS = 30 * 60 * 1000;
export const TRENDING_TIMEOUT_MS = 8_000;
export const TRENDING_LIMIT = 12;

type ProviderPick = { readonly provider: string; readonly tracks: Track[] };

/**
 * Returns the merged trending shelf, or `null` when no enabled provider has a
 * feed (offline with an empty cache, or every call failed).
 */
export async function fetchTrendingShelves(db: Database): Promise<RecommendedShelf | null> {
  const cached = await getCacheEntry<RecommendedShelf>(db, TRENDING_CACHE_KEY);
  if (cached && cached.tracks.length > 0) return cached;

  const providers = getEnabledProviders().filter((provider) => provider.capabilities.hasRecommendations);

  const settled = await mapWithConcurrency(providers, 4, async (provider) => {
    const recommendations = await withTimeout(
      provider.getRecommendations(),
      TRENDING_TIMEOUT_MS,
      `${provider.displayName} timed out`,
    );
    return {
      provider: provider.displayName,
      tracks: uniqueBy(
        recommendations.flatMap((recommendation) => recommendation.tracks.map((entry) => entry.track)),
        (track) => track.id,
      ).slice(0, TRENDING_LIMIT),
    } satisfies ProviderPick;
  });

  const picks = settled
    .filter((outcome): outcome is PromiseFulfilledResult<ProviderPick> => outcome.status === 'fulfilled')
    .map((outcome) => outcome.value)
    .filter((pick) => pick.tracks.length > 0)
    .sort((a, b) => b.tracks.length - a.tracks.length);

  if (picks.length === 0) return null;

  const sources = picks.map((pick) => pick.provider);
  const shelf: RecommendedShelf = {
    id: 'trending',
    title: 'Trending now',
    reason: `Popular right now on ${sources.join(' and ')}`,
    tracks: uniqueBy(picks.flatMap((pick) => pick.tracks), (track) => track.id).slice(0, TRENDING_LIMIT),
  };

  await setCacheEntry(db, TRENDING_CACHE_KEY, shelf, TRENDING_TTL_MS, sources[0]).catch(
    () => undefined,
  );
  return shelf;
}