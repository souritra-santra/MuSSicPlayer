import type { Track } from '@/types';
import { round } from '@/utils/common';
import { normalizeText } from '@/utils/normalize';

import type { UserProfile } from './profile';

/**
 * Recommendation scoring.
 *
 * Scores are in [0, 1] and built from named weights so a shelf can be
 * diagnosed instead of guessed at. The two signals the local rollups carry —
 * genre affinity and artist affinity — are the whole model; co-occurrence is
 * handled by the "Because you listened to" shelf directly rather than folded
 * into this generic score.
 */

export const RECOMMENDATION_WEIGHTS = {
  /** How much the track's genres match the genres the user plays most. */
  genre: 0.55,
  /** How much its artists match the artists the user plays most. */
  artist: 0.45,
} as const;

/** Affinity-based score of a candidate against the whole profile. [0, 1]. */
export function scoreTrackForProfile(track: Track, profile: UserProfile): number {
  const genreSum = track.genres.reduce(
    (sum, genre) => sum + (profile.genres.get(normalizeText(genre)) ?? 0),
    0,
  );
  const artistSum = track.artistNames.reduce(
    (sum, name) => sum + (profile.artists.get(normalizeText(name)) ?? 0),
    0,
  );

  const genreScore = Math.min(1, genreSum) * RECOMMENDATION_WEIGHTS.genre;
  // 1.5x: a single matching artist carries more identity than one shared genre.
  const artistScore = Math.min(1, artistSum * 1.5) * RECOMMENDATION_WEIGHTS.artist;

  return round(Math.max(0, Math.min(1, genreScore + artistScore)), 4);
}

/**
 * Similarity between a candidate and a single reference track (used for
 * "Similar to your favourites" and "Related music"). Genre overlap is measured
 * against the *reference's* genres so a sparse candidate still scores honestly.
 */
export function trackSimilarity(candidate: Track, reference: Track): number {
  if (candidate.id === reference.id) return 0;

  const referenceGenres = new Set(reference.genres.map((genre) => normalizeText(genre)));
  const candidateGenres = new Set(candidate.genres.map((genre) => normalizeText(genre)));
  let overlap = 0;
  for (const genre of referenceGenres) {
    if (candidateGenres.has(genre)) overlap += 1;
  }
  const genreScore = referenceGenres.size === 0 ? 0 : overlap / referenceGenres.size;

  const candidateArtists = new Set(candidate.artistNames.map((name) => normalizeText(name)));
  const sharesArtist = reference.artistNames.some((name) =>
    candidateArtists.has(normalizeText(name)),
  );

  return round(
    genreScore * RECOMMENDATION_WEIGHTS.genre + (sharesArtist ? RECOMMENDATION_WEIGHTS.artist : 0),
    4,
  );
}