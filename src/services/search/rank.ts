import type { SearchResult, Track } from '@/types';
import {
  detectTrackKind,
  normalizeArtist,
  normalizeTitle,
  significantTokens,
  tokenSimilarity,
  tokenize,
} from '@/utils/normalize';
import { round } from '@/utils/common';

/**
 * Ranking.
 *
 * Scores are in [0, 1] and deliberately interpretable — every factor is a
 * named weight so a bad result set can be diagnosed instead of guessed at.
 * Weights favour exact-ish title matches, because a music search where
 * "beatles abbey road" returns an unrelated trending track feels broken.
 */

export const WEIGHTS = {
  /** Title token overlap (most important signal). */
  title: 0.45,
  /** Artist token overlap. */
  artist: 0.25,
  /** Whole normalized title is a prefix of / equal to the query. */
  titlePrefix: 0.12,
  /** Exact normalized title match. */
  exactTitle: 0.08,
  /** Short title penalization: "Intro" should not outrank a full song title. */
  lengthPrior: 0.05,
  /** Provider-agnostic popularity prior (play stats), when known. */
  familiarity: 0.05,
} as const;

/** Extra weight applied when the provider explicitly marked the result as exact. */
const VARIANT_PENALTY = 0.12;

export type RankContext = {
  readonly query: string;
  /** Normalized play count per track id, used for the familiarity prior. */
  readonly familiarity?: ReadonlyMap<string, number>;
  /** When false, remix/cover/live variants are demoted. */
  readonly preferVariants?: boolean;
};

/** Scores a single track against the query. Returns [0, 1]. */
export function scoreTrack(track: Track, context: RankContext): number {
  const queryTokens = tokenize(context.query);
  if (queryTokens.length === 0) return 0;

  const titleTokens = significantTokens(tokenize(track.title));
  const artistTokens = significantTokens(tokenize(track.artistNames.join(' ')));
  const queryNormalized = normalizeTitle(context.query);
  const titleNormalized = normalizeTitle(track.title);

  let score = 0;
  score += tokenSimilarity(queryTokens, titleTokens) * WEIGHTS.title;
  score += tokenSimilarity(queryTokens, artistTokens) * WEIGHTS.artist;

  if (titleNormalized === queryNormalized) {
    score += WEIGHTS.exactTitle;
  } else if (titleNormalized.startsWith(queryNormalized)) {
    score += WEIGHTS.titlePrefix;
  }

  // Prefer fuller titles: a 5-char title matching every query token is usually a
  // worse answer than a 40-char title that matches them too.
  const lengthRatio = Math.min(1, titleNormalized.length / 24);
  score += lengthRatio * WEIGHTS.lengthPrior;

  const familiar = context.familiarity?.get(track.id) ?? 0;
  score += Math.min(1, Math.log1p(familiar) / 4) * WEIGHTS.familiarity;

  if (!context.preferVariants && track.kind !== 'song' && track.kind !== 'unknown') {
    score -= VARIANT_PENALTY;
  }

  return round(Math.max(0, Math.min(1, score)), 4);
}

/** Scores and sorts a candidate pool, dropping anything below `threshold`. */
export function rankTracks(
  tracks: readonly Track[],
  context: RankContext,
  threshold = 0.08,
): SearchResult[] {
  const scored = tracks
    .map((track) => ({ track, score: scoreTrack(track, context) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score || a.track.title.length - b.track.title.length);

  return scored;
}

/** Derives a normalized signature for cross-provider duplicate detection. */
export function signatureOf(track: Track): string {
  return [
    normalizeTitle(track.title),
    normalizeArtist(...track.artistNames),
    typeof track.durationMs === 'number' ? Math.round(track.durationMs / 1000 / 5) : 'x',
  ].join('|');
}

/** True when two tracks look like the same recording. */
export function isSameRecording(a: Track, b: Track): boolean {
  const titleA = normalizeTitle(a.title);
  const titleB = normalizeTitle(b.title);
  const artistA = normalizeArtist(...a.artistNames);
  const artistB = normalizeArtist(...b.artistNames);

  const titleMatch =
    titleA === titleB ||
    titleA.startsWith(titleB) ||
    titleB.startsWith(titleA) ||
    tokenSimilarity(tokenize(titleA), tokenize(titleB)) > 0.85;
  if (!titleMatch) return false;

  // An explicit version marker on one side only (remix vs original) means they
  // are *not* duplicates — the user wants to see both.
  const kindA = a.kind === 'unknown' ? detectTrackKind(a.title) : a.kind;
  const kindB = b.kind === 'unknown' ? detectTrackKind(b.title) : b.kind;
  if (kindA !== 'song' && kindB !== 'song' && kindA !== kindB) return false;
  if (kindA === kindB && kindA !== 'song') return true;

  if (artistA !== artistB && tokenSimilarity(tokenize(artistA), tokenize(artistB)) < 0.6) {
    return false;
  }

  // Durations must be within ~8 seconds (or unknown) to be the same recording.
  if (typeof a.durationMs === 'number' && typeof b.durationMs === 'number') {
    if (Math.abs(a.durationMs - b.durationMs) > 8_000) return false;
  }
  return true;
}