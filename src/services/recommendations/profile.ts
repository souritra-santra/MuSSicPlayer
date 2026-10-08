import {
  getCoOccurrences,
  getFavoriteTracks,
  getMostPlayedTracks,
  getRecentlyPlayedTracks,
  getTopArtists,
  getTopGenres,
  type Database,
} from '@/services/database';
import { normalizeText } from '@/utils/normalize';

/**
 * The user's listening profile — every signal instruction.md's recommender is
 * asked to learn from, read from the local rollup tables in a handful of reads.
 *
 * Nothing here touches the network; the profile is purely derived from
 * `play_stats` / `artist_stats` / `genre_stats` / `play_history` /
 * `favorites`, which is what makes recommendations instant and offline.
 */

export type CoOccurrenceEntry = {
  readonly trackId: string;
  /** Normalized to [0, 1] against the seed's strongest pair. */
  readonly weight: number;
};

export type UserProfile = {
  /** Normalized genre -> affinity in [0, 1], log-scaled by play count. */
  readonly genres: ReadonlyMap<string, number>;
  /** Normalized artist name -> affinity in [0, 1]. */
  readonly artists: ReadonlyMap<string, number>;
  /** Track ids the user saved as favourites. */
  readonly favoriteIds: ReadonlySet<string>;
  /** Track ids the user has played (from `play_stats`). */
  readonly playedIds: ReadonlySet<string>;
  /** Newest first. */
  readonly recentlyPlayedIds: readonly string[];
  /** seed track id -> its co-listeners, each normalized to [0, 1]. */
  readonly coOccurrences: ReadonlyMap<string, readonly CoOccurrenceEntry[]>;
  /** True once the user has any listening signal to recommend from. */
  readonly hasHistory: boolean;
};

const TOP_GENRES = 24;
const TOP_ARTISTS = 24;
const FAVORITES = 200;
const PLAYED = 200;
const RECENT = 24;
const CO_OCCURRENCES = 400;

/** Log-scaled affinity so one runaway genre does not crowd everything out. */
function logWeight(count: number, max: number): number {
  return Math.log1p(count) / Math.log1p(Math.max(1, max));
}

export async function buildUserProfile(db: Database): Promise<UserProfile> {
  const [genres, artists, favorites, played, recent, coOccurrenceRows] = await Promise.all([
    getTopGenres(db, TOP_GENRES),
    getTopArtists(db, TOP_ARTISTS),
    getFavoriteTracks(db, FAVORITES),
    getMostPlayedTracks(db, PLAYED),
    getRecentlyPlayedTracks(db, RECENT),
    getCoOccurrences(db, CO_OCCURRENCES),
  ]);

  const maxGenre = Math.max(0, ...genres.map((entry) => entry.playCount));
  const genreMap = new Map<string, number>();
  for (const entry of genres) {
    genreMap.set(normalizeText(entry.genre), logWeight(entry.playCount, maxGenre));
  }

  const maxArtist = Math.max(0, ...artists.map((entry) => entry.playCount));
  const artistMap = new Map<string, number>();
  for (const entry of artists) {
    artistMap.set(normalizeText(entry.artist.name), logWeight(entry.playCount, maxArtist));
  }

  const coMap = new Map<string, CoOccurrenceEntry[]>();
  for (const row of coOccurrenceRows) {
    const list = coMap.get(row.trackId) ?? [];
    list.push({ trackId: row.otherTrackId, weight: row.weight });
    coMap.set(row.trackId, list);
  }
  for (const [seed, entries] of coMap) {
    const max = Math.max(...entries.map((entry) => entry.weight));
    coMap.set(
      seed,
      entries
        .map((entry) => ({ trackId: entry.trackId, weight: entry.weight / max }))
        .sort((a, b) => b.weight - a.weight),
    );
  }

  return {
    genres: genreMap,
    artists: artistMap,
    favoriteIds: new Set(favorites.map((track) => track.id)),
    playedIds: new Set(played.map((track) => track.id)),
    recentlyPlayedIds: recent.map((track) => track.id),
    coOccurrences: coMap,
    hasHistory: genres.length > 0 || artists.length > 0 || played.length > 0,
  };
}