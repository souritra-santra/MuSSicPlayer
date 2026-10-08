import type { SearchResult, Track } from '@/types';
import { uniqueBy } from '@/utils/common';

import { isSameRecording } from './rank';

/**
 * Cross-provider duplicate detection.
 *
 * Two providers rarely agree on ids, so duplicates are found by comparing
 * recordings, not keys. The winner is the higher-scoring result; the losers are
 * kept as `alternates` so the row can offer "also on <provider>" without
 * losing the user's ability to pick a different encode/bitrate.
 */

export type DedupeOptions = {
  /** Drop later results that are the same recording as an earlier one. */
  readonly keepAlternates?: boolean;
};

/**
 * Collapses duplicates. O(n²) in the worst case, which is fine: candidate
 * pools are capped at a few hundred and the inner check short-circuits on the
 * cheap title comparison inside `isSameRecording`.
 */
export function dedupeResults(
  results: readonly SearchResult[],
  options: DedupeOptions = {},
): SearchResult[] {
  const keepAlternates = options.keepAlternates ?? true;
  const winners: SearchResult[] = [];
  const merged = new Map<Track['id'], SearchResult>();

  for (const candidate of results) {
    const existingIndex = winners.findIndex((winner) => isSameRecording(winner.track, candidate.track));

    if (existingIndex === -1) {
      winners.push(candidate);
      merged.set(candidate.track.id, candidate);
      continue;
    }

    const winner = winners[existingIndex];

    // Prefer the higher score; break ties in favour of a playable provider so
    // the primary row is the one the user can actually listen to.
    const shouldSwap =
      candidate.score > winner.score ||
      (candidate.score === winner.score && winner.track.streamUrl === undefined && candidate.track.streamUrl !== undefined);

    const primary = shouldSwap ? candidate : winner;
    const secondary = shouldSwap ? winner : candidate;

    if (shouldSwap) {
      winners[existingIndex] = primary;
      merged.set(primary.track.id, primary);
    }

    if (!keepAlternates) continue;

    const current = merged.get(primary.track.id) ?? primary;
    const alternates = [
      ...(current.alternates ?? []),
      { provider: secondary.track.provider, track: secondary.track },
    ];
    merged.set(primary.track.id, { ...current, alternates });
  }

  // Re-attach merged alternates.
  return winners.map((entry) => merged.get(entry.track.id) ?? entry);
}

/** Cheap first-pass filter on the composite provider key. */
export function dedupeExactKeys(results: readonly SearchResult[]): SearchResult[] {
  return uniqueBy(results, (entry) => `${entry.track.provider}:${entry.track.externalId}`);
}

/**
 * Caps alternates per row so a popular song found on five providers does not
 * bloat every list item.
 */
export function trimAlternates(results: readonly SearchResult[], max = 3): SearchResult[] {
  return results.map((entry) =>
    entry.alternates && entry.alternates.length > max
      ? { ...entry, alternates: entry.alternates.slice(0, max) }
      : entry,
  );
}