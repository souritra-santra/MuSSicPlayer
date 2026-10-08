/**
 * Provider registration entry point.
 *
 * Importing this module registers every provider exactly once. The app imports
 * it once during startup (`src/services/bootstrap.ts`) so the registry is ready
 * before any search runs.
 */

import { registerProvider } from './registry';

import { demoProvider } from './demo/provider';
import { youtubeProvider } from './youtube/provider';
import { jamendoProvider } from './jamendo/provider';
import { audiusProvider } from './audius/provider';
import { archiveProvider } from './archive/provider';

/**
 * Providers registered at boot.
 *
 * Phase 2 adds the real sources here (YouTube / Jamendo / Audius / Archive).
 * They are listed in priority order, which is also the order results are merged
 * in when two providers tie on score.
 */
const PROVIDERS = [demoProvider, youtubeProvider, jamendoProvider, audiusProvider, archiveProvider] as const;

let registered = false;

export function registerAllProviders(): void {
  if (registered) return;
  registered = true;
  for (const provider of PROVIDERS) registerProvider(provider);
}

export { demoProvider, youtubeProvider, jamendoProvider, audiusProvider, archiveProvider };
export {
  clearRegistry,
  emptySearchResults,
  getAllProviders,
  getEnabledProviders,
  getProvider,
  registerProvider,
  searchAllProviders,
  type ProviderFanOut,
} from './registry';
export {
  describeProviderError,
  ProviderNotConfiguredError,
  type MusicProvider,
  type ProviderSearchQuery,
  type ProviderSearchResult,
  type RecommendationSeed,
} from './types';