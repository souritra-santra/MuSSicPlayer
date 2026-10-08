/**
 * React Query key factory.
 *
 * Centralised because a wrong key is the classic cause of "the list updates on
 * favourites but not on delete": two call sites inventing slightly different
 * keys never invalidate each other.
 */

export const queryKeys = {
  /** Root, used by `queryClient.invalidateQueries({ queryKey: [] })`. */
  all: ['app'] as const,

  library: () => ['library'] as const,
  stats: () => ['library', 'stats'] as const,

  favorites: () => ['library', 'favorites'] as const,
  favoriteTrackIds: () => ['library', 'favorites', 'ids'] as const,

  playlists: () => ['library', 'playlists'] as const,
  playlist: (id: string) => ['library', 'playlists', id] as const,
  playlistTracks: (id: string) => ['library', 'playlists', id, 'tracks'] as const,

  history: (limit: number) => ['library', 'history', 'pages', limit] as const,
  mostPlayed: (limit: number) => ['library', 'mostPlayed', limit] as const,
  recentlyPlayed: (limit: number) => ['library', 'recentlyPlayed', limit] as const,
  continueListening: (limit: number) => ['library', 'continue', limit] as const,

  search: (query: string, options: { excludeExplicit?: boolean } = {}) =>
    ['search', query, options] as const,
  recentSearches: () => ['search', 'recent'] as const,

  recommendations: (revision: number) => ['recommendations', revision] as const,
  trending: (revision: number) => ['recommendations', 'trending', revision] as const,
  related: (trackId: string, excludeKey: string) =>
    ['recommendations', 'related', trackId, excludeKey] as const,

  track: (id: string) => ['track', id] as const,
  artist: (id: string) => ['artist', id] as const,
  album: (id: string) => ['album', id] as const,

  home: (revision: number) => ['home', revision] as const,
} as const;

/** Invalidate everything that could be affected by a playback mutation. */
export function libraryMutationKeys(): readonly (readonly unknown[])[] {
  // `queryKeys.library()` is a prefix of every key below, so it alone resets
  // the whole library; the specific keys are kept as a safety net in case the
  // root ever narrows. History is intentionally absent: its key carries a page
  // size that varies per call site, and the root already covers all of them.
  return [
    queryKeys.library(),
    queryKeys.favorites(),
    queryKeys.playlists(),
    queryKeys.mostPlayed(20),
    queryKeys.recentlyPlayed(20),
    queryKeys.stats(),
  ];
}