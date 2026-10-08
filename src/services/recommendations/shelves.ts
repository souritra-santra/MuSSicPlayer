import type { Track } from '@/types';
import { getAllCachedTracks, type Database } from '@/services/database';
import { uniqueBy } from '@/utils/common';
import { normalizeText } from '@/utils/normalize';

import { buildUserProfile, type UserProfile } from './profile';
import { scoreTrackForProfile, trackSimilarity } from './score';

/**
 * Local shelf composition.
 *
 * Every shelf instruction.md puts on the home screen that can be answered from
 * on-device data is built here against the cached catalogue. The result feed is
 * deliberately additive: a shelf with nothing to say is omitted rather than
 * rendered empty, so a cold start looks like a cold start instead of a wall of
 * promises the engine cannot keep.
 */

export type RecommendedShelf = {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
  readonly tracks: readonly Track[];
};

/** Result of the personalized pass — feed between the history shelves. */
export type LocalRecommendations = {
  /** "Recommended for you" / "Because you listened to…" / "Similar to your favourites". */
  readonly personalized: readonly RecommendedShelf[];
  /** "Discover something new" — shown after the history shelves. */
  readonly discovery: RecommendedShelf | null;
};

const SHELF_LIMIT = 12;
/** Rows scanned for candidates — bounds memory on a shelf of thousands. */
const CATALOG_LIMIT = 1500;

/**
 * Builds the personalized home shelves. Pure local reads; no network.
 */
export async function buildLocalRecommendations(db: Database): Promise<LocalRecommendations> {
  const [profile, catalog] = await Promise.all([
    buildUserProfile(db),
    getAllCachedTracks(db, CATALOG_LIMIT),
  ]);

  // Without any listening signal there is nothing to personalize against.
  // Trending fills the home for a brand-new user instead.
  if (!profile.hasHistory) return { personalized: [], discovery: null };

  const personalized: RecommendedShelf[] = [];

  const recommended = recommendedForYou(profile, catalog);
  if (recommended) personalized.push(recommended);

  const because = becauseYouListenedTo(profile, catalog);
  if (because) personalized.push(because);

  const similar = similarToFavourites(profile, catalog);
  if (similar) personalized.push(similar);

  return { personalized, discovery: discoverSomethingNew(profile, catalog) };
}

/** Track ids to never re-suggest: already favourited, or being played now. */
type Exclusions = ReadonlySet<string>;

/**
 * Related-music shelves for the search screen ("More from this artist",
 * "Related music"), seeded by a resolved search hit. Local catalogue only.
 */
export async function relatedToTrack(
  db: Database,
  seed: Track,
  excludeIds: Exclusions,
): Promise<{ readonly sameArtist: RecommendedShelf | null; readonly moreLikeThis: RecommendedShelf | null }> {
  const catalog = await getAllCachedTracks(db, CATALOG_LIMIT);
  const seedArtists = new Set(seed.artistNames.map((name) => normalizeText(name)));
  const seedTitle = normalizeText(seed.title);

  const sameArtist = catalog.filter(
    (track) =>
      track.id !== seed.id &&
      !excludeIds.has(track.id) &&
      normalizeText(track.title) !== seedTitle &&
      track.artistNames.some((name) => seedArtists.has(normalizeText(name))),
  );

  const moreLikeThis = catalog
    .filter((track) => track.id !== seed.id && !excludeIds.has(track.id))
    .map((track) => ({ track, score: trackSimilarity(track, seed) }))
    .filter((entry) => entry.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHELF_LIMIT)
    .map((entry) => entry.track);

  const seedArtist = seed.artistNames[0];
  return {
    sameArtist:
      sameArtist.length === 0
        ? null
        : {
            id: 'related-artist',
            title: seedArtist ? `More from ${seedArtist}` : 'More from the artist',
            reason: seedArtist ? `Other tracks by ${seedArtist} in your library` : 'From the same artist in your library',
            tracks: sameArtist.slice(0, SHELF_LIMIT),
          },
    moreLikeThis:
      moreLikeThis.length === 0
        ? null
        : {
            id: 'related-more',
            title: 'Related music',
            reason: 'Similar genres and artists',
            tracks: moreLikeThis,
          },
  };
}

/** Top affinity scores among tracks the user has never played. */
function recommendedForYou(profile: UserProfile, catalog: readonly Track[]): RecommendedShelf | null {
  const scored = catalog
    .filter((track) => !profile.playedIds.has(track.id) && !profile.favoriteIds.has(track.id))
    .map((track) => ({ track, score: scoreTrackForProfile(track, profile) }))
    .filter((entry) => entry.score >= 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHELF_LIMIT);

  if (scored.length === 0) return null;
  return {
    id: 'recommended',
    title: 'Recommended for you',
    reason: 'Matched to the artists and genres you play most',
    tracks: scored.map((entry) => entry.track),
  };
}

/**
 * "Because you listened to {seed}" — the co-occurrence shelf. Walks from the
 * most recent seed that has co-listeners and surfaces the strongest pairs.
 */
function becauseYouListenedTo(profile: UserProfile, catalog: readonly Track[]): RecommendedShelf | null {
  const byId = new Map(catalog.map((track) => [track.id, track]));

  for (const seedId of profile.recentlyPlayedIds) {
    const others = profile.coOccurrences.get(seedId);
    if (!others || others.length === 0) continue;

    const seed = byId.get(seedId);
    if (!seed) continue;

    const tracks = uniqueBy(
      others
        .map((entry) => byId.get(entry.trackId))
        .filter((track): track is Track => Boolean(track))
        .filter((track) => track.id !== seedId && !profile.favoriteIds.has(track.id)),
      (track) => track.id,
    ).slice(0, SHELF_LIMIT);

    if (tracks.length === 0) continue;

    const seedLabel = seed.artistNames[0] ?? seed.title;
    return {
      id: 'because-you-listened',
      title: `Because you listened to ${seedLabel}`,
      reason: `Tracks that paired with “${seed.title}” in your sessions`,
      tracks,
    };
  }

  return null;
}

/** Favourites-neighbourhood: unplayed tracks most similar to saved ones. */
function similarToFavourites(profile: UserProfile, catalog: readonly Track[]): RecommendedShelf | null {
  if (profile.favoriteIds.size === 0) return null;

  const favourites = catalog.filter((track) => profile.favoriteIds.has(track.id));
  if (favourites.length === 0) return null;

  const scored = catalog
    .filter((track) => !profile.favoriteIds.has(track.id) && !profile.playedIds.has(track.id))
    .map((track) => {
      let best = 0;
      for (const favourite of favourites) {
        best = Math.max(best, trackSimilarity(track, favourite));
      }
      return { track, score: best };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHELF_LIMIT);

  if (scored.length === 0) return null;
  return {
    id: 'similar-favourites',
    title: 'Similar to your favourites',
    reason: 'Matches the artists and genres you have saved',
    tracks: scored.map((entry) => entry.track),
  };
}

/**
 * "Discover something new" — variety over raw score: one strong pick per top
 * genre first, then the rest of the ranked list, so a single dominant genre
 * does not fill the whole rail.
 */
function discoverSomethingNew(profile: UserProfile, catalog: readonly Track[]): RecommendedShelf | null {
  const scored = catalog
    .filter((track) => !profile.playedIds.has(track.id) && !profile.favoriteIds.has(track.id))
    .map((track) => ({ track, score: scoreTrackForProfile(track, profile) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const topGenres = Array.from(profile.genres.keys()).slice(0, 8);
  const picked: Track[] = [];
  const pickedIds = new Set<string>();
  const genreFill = new Set<string>();

  const add = (track: Track) => {
    if (pickedIds.has(track.id) || picked.length >= SHELF_LIMIT) return;
    pickedIds.add(track.id);
    picked.push(track);
  };

  for (const entry of scored) {
    const genre = entry.track.genres.map(normalizeText).find((g) => topGenres.includes(g));
    if (!genre || genreFill.has(genre)) continue;
    genreFill.add(genre);
    add(entry.track);
  }
  for (const entry of scored) add(entry.track);

  if (picked.length === 0) return null;
  return {
    id: 'discover',
    title: 'Discover something new',
    reason: 'Fresh picks from the genres you like',
    tracks: picked,
  };
}