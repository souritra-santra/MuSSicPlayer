import type { ProviderId, UnifiedSearchResults } from '@/types';
import { mapWithConcurrency, withTimeout } from '@/utils/common';

import {
  describeProviderError,
  type MusicProvider,
  type ProviderSearchQuery,
  type ProviderSearchResult,
} from './types';

/**
 * Provider registry.
 *
 * Providers self-register on import (see `./providers/index.ts`), so adding a
 * source means dropping in a module — no edits to search, storage or UI.
 */

const registry = new Map<ProviderId, MusicProvider>();

export function registerProvider(provider: MusicProvider): void {
  if (registry.has(provider.id)) {
    throw new Error(`Provider "${provider.id}" is already registered`);
  }
  registry.set(provider.id, provider);
}

export function getProvider(id: ProviderId): MusicProvider | undefined {
  return registry.get(id);
}

export function getAllProviders(): MusicProvider[] {
  return Array.from(registry.values());
}

export function getEnabledProviders(): MusicProvider[] {
  return getAllProviders().filter((provider) => provider.isEnabled());
}

/** Drops every registration. Test-only. */
export function clearRegistry(): void {
  registry.clear();
}

export type ProviderFanOut = {
  /** Providers that answered, keyed by provider id. */
  readonly results: ReadonlyMap<ProviderId, ProviderSearchResult>;
  /** Providers that threw, with a displayable reason. */
  readonly failures: readonly { provider: ProviderId; reason: string }[];
  readonly tookMs: number;
};

/** A single upstream that never answers must not hang the whole search screen. */
const SEARCH_TIMEOUT_MS = 12_000;

/**
 * Queries every enabled provider concurrently with a bounded fan-out.
 *
 * A provider that fails is recorded and skipped rather than failing the whole
 * search: partial results are far better than an error screen when one of four
 * upstreams is down.
 */
export async function searchAllProviders(
  query: ProviderSearchQuery,
  options: { concurrency?: number; providers?: readonly MusicProvider[] } = {},
): Promise<ProviderFanOut> {
  const startedAt = Date.now();
  // An empty query has nothing to fan out to; providers would return their
  // generic "trending" feeds instead of matches.
  const candidates = query.query.trim().length === 0 ? [] : (options.providers ?? getEnabledProviders());

  const settled = await mapWithConcurrency(candidates, options.concurrency ?? 4, (provider) =>
    withTimeout(
      provider.search(query),
      SEARCH_TIMEOUT_MS,
      `${provider.displayName} timed out after ${SEARCH_TIMEOUT_MS / 1000}s`,
    ),
  );

  const results = new Map<ProviderId, ProviderSearchResult>();
  const failures: { provider: ProviderId; reason: string }[] = [];

  settled.forEach((outcome, index) => {
    const provider = candidates[index];
    if (outcome.status === 'fulfilled') {
      results.set(provider.id, outcome.value);
    } else {
      failures.push({ provider: provider.id, reason: describeProviderError(outcome.reason) });
    }
  });

  return { results, failures, tookMs: Date.now() - startedAt };
}

/** Fills in the shell of a failed unified search so callers always get a shape. */
export function emptySearchResults(query: string): UnifiedSearchResults {
  return { query, sections: [], failedProviders: [], tookMs: 0 };
}