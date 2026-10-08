import type { Track } from '@/types';
import {
  getContinueListeningTracks,
  getMostPlayedTracks,
  getRecentlyPlayedTracks,
  getTopArtists,
  getTopGenres,
  getUnplayedFavorites,
  type Database,
} from '@/services/database';
import { buildLocalRecommendations } from '@/services/recommendations';

import { useDatabaseLoader } from '@/hooks/useDatabase';

/**
 * Home data composition.
 *
 * Reads only local aggregates (`play_stats`, `artist_stats`, `genre_stats`)
 * and the recommendation shelves derived from them — no network call. That is
 * what makes the home screen instant and offline. The Phase 5 scorer feeds the
 * personalized shelves; the history shelves below come from the same signals.
 */

export type HomeShelf = {
  readonly id: string;
  readonly title: string;
  readonly tracks: readonly Track[];
  /** Explains the shelf's provenance, e.g. "Based on your last 20 plays". */
  readonly reason?: string;
  readonly emptyHint?: string;
};

export type HomeData = {
  readonly shelves: readonly HomeShelf[];
  readonly topGenres: readonly { genre: string; playCount: number }[];
  readonly topArtists: readonly { name: string; playCount: number }[];
  /** True when the user has no listening history yet. */
  readonly isColdStart: boolean;
};

export function useHomeData(): { data: HomeData | null; loading: boolean; error: Error | null; reload: () => void } {
  const loader = useDatabaseLoader<HomeData>(async (db: Database) => {
    const [continueListening, recentlyPlayed, mostPlayed, backlog, genres, artists, local] =
      await Promise.all([
        getContinueListeningTracks(db, 12),
        getRecentlyPlayedTracks(db, 12),
        getMostPlayedTracks(db, 12),
        getUnplayedFavorites(db, 12),
        getTopGenres(db, 8),
        getTopArtists(db, 8),
        buildLocalRecommendations(db),
      ]);

    const hasHistory = continueListening.length + recentlyPlayed.length + mostPlayed.length > 0;

    const shelves: HomeShelf[] = [];

    // Personalized shelves first — the Phase 5 scorer now has something to rank.
    for (const shelf of local.personalized) {
      shelves.push({ id: shelf.id, title: shelf.title, tracks: shelf.tracks, reason: shelf.reason });
    }

    if (continueListening.length > 0) {
      shelves.push({
        id: 'continue',
        title: 'Continue listening',
        tracks: continueListening,
        reason: 'Tracks you started but did not finish',
      });
    }

    if (recentlyPlayed.length > 0) {
      shelves.push({
        id: 'recent',
        title: 'Recently played',
        tracks: recentlyPlayed,
        reason: 'From your listening history',
      });
    }

    if (backlog.length > 0) {
      shelves.push({
        id: 'backlog',
        title: 'Saved, never played',
        tracks: backlog,
        reason: 'Favourites you have not heard yet',
      });
    }

    if (mostPlayed.length > 0) {
      shelves.push({
        id: 'most-played',
        title: 'Most played',
        tracks: mostPlayed,
        reason: 'Your all-time top tracks',
      });
    }

    if (local.discovery) {
      shelves.push({
        id: local.discovery.id,
        title: local.discovery.title,
        tracks: local.discovery.tracks,
        reason: local.discovery.reason,
      });
    }

    return {
      shelves,
      topGenres: genres,
      topArtists: artists.map((entry) => ({ name: entry.artist.name, playCount: entry.playCount })),
      isColdStart: !hasHistory,
    };
  }, []);

  return loader;
}