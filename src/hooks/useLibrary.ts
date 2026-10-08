import { useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
  getFavoriteTrackIdsFor,
  getFavoriteTracks,
  getPlaylists,
  getPlaylistById,
  getPlaylistTracks,
  getTrackCountsByProvider,
  toggleFavorite,
  removeTrackFromPlaylist,
  addTrackToPlaylist,
  getLibraryStats,
  getHistoryPage,
  getMostPlayedTracks,
  getRecentlyPlayedTracks,
  clearHistory,
  getRecentSearchQueries,
  getTopGenres,
  upsertTracks,
  type Database,
  type HistoryEntry,
} from '@/services/database';
import type { Playlist, Track } from '@/types';

import { useReadyDatabase } from './useDatabase';
import { libraryMutationKeys, queryKeys } from './useQueryKeys';

/**
 * Library data hooks.
 *
 * Thin `useQuery` wrappers over the repositories. Keeping them here means
 * screens never build a query key or touch SQL, and invalidation is expressed
 * once rather than at every call site.
 */

/* ------------------------------------------------------------------ library */

export function useLibraryStats() {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: queryKeys.stats(),
    enabled: Boolean(db),
    queryFn: async () => getLibraryStats(db as Database),
  });
}

export function useTrackCountsByProvider() {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: ['library', 'providers'],
    enabled: Boolean(db),
    queryFn: async () => getTrackCountsByProvider(db as Database),
  });
}

/* ---------------------------------------------------------------- favorites */

/**
 * Paginated favourites, page size first.
 *
 * A page-based query rather than one big list: a library with thousands of
 * hearts should not hydrate them all to render a screen. `getNextPageParam`
 * advances only while a full page came back — a short page means the table is
 * exhausted (rows are FK-cascaded with their track, so a page cannot be short
 * for any other reason).
 */
export function useFavorites(pageSize = 100) {
  const db = useReadyDatabase();
  return useInfiniteQuery({
    queryKey: ['library', 'favorites', 'list', pageSize],
    enabled: Boolean(db),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => getFavoriteTracks(db as Database, pageSize, pageParam),
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length === pageSize ? lastPageParam + pageSize : undefined,
  });
}

/**
 * Heart states for a specific list — one query instead of N.
 *
 * Capped at 100 ids: SQLite's bind-variable ceiling is the real limit, and a
 * result set longer than that would silently truncate. Rows beyond the cap read
 * as "not favourited", which is wrong but harmless and self-correcting.
 */
export function useFavoriteStates(trackIds: readonly string[]) {
  const db = useReadyDatabase();
  const key = trackIds.slice(0, 100).join(',');
  return useQuery({
    queryKey: ['library', 'favorites', 'states', key],
    enabled: Boolean(db) && trackIds.length > 0,
    queryFn: async () => getFavoriteTrackIdsFor(db as Database, trackIds.slice(0, 100)),
  });
}

/**
 * Toggles a favourite and refreshes every affected view.
 *
 * The read-modify-write happens inside a single repository call so two rapid
 * taps cannot interleave, and the returned boolean is what the UI should show —
 * no optimistic state to roll back if the write fails.
 */
export function useToggleFavorite() {
  const db = useReadyDatabase();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (trackId: string) => {
      const favorite = await toggleFavorite(db as Database, trackId);
      return { trackId, favorite };
    },
    onSuccess: async () => {
      await Promise.all(
        libraryMutationKeys().map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

/* ---------------------------------------------------------------- playlists */

export function usePlaylists() {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: queryKeys.playlists(),
    enabled: Boolean(db),
    queryFn: async () => getPlaylists(db as Database),
  });
}

export function usePlaylist(id: string) {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: queryKeys.playlist(id),
    enabled: Boolean(db) && id.length > 0,
    queryFn: async () => getPlaylistById(db as Database, id),
  });
}

export function usePlaylistTracks(id: string) {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: queryKeys.playlistTracks(id),
    enabled: Boolean(db) && id.length > 0,
    queryFn: async () => getPlaylistTracks(db as Database, id),
  });
}

/**
 * Invalidates everything a playlist write touches.
 *
 * `stats()` belongs in here: the Library header subtitle is driven by the stats
 * query, and invalidating only `playlists()` left it reading "0 playlists" after
 * a playlist was created. The detail queries are scoped to the affected id so a
 * write does not refetch every playlist the user owns.
 */
function invalidatePlaylistQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  playlistId?: string,
) {
  const keys: (readonly unknown[])[] = [queryKeys.playlists(), queryKeys.stats()];
  if (playlistId) {
    keys.push(queryKeys.playlist(playlistId), queryKeys.playlistTracks(playlistId));
  }
  return Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
}

export function useCreatePlaylist() {
  const db = useReadyDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) =>
      createPlaylist(db as Database, name, description),
    onSuccess: () => invalidatePlaylistQueries(queryClient),
  });
}

export function useDeletePlaylist() {
  const db = useReadyDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => deletePlaylist(db as Database, id),
    onSuccess: (_data, id) => invalidatePlaylistQueries(queryClient, id),
  });
}

export function useRenamePlaylist() {
  const db = useReadyDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      renamePlaylist(db as Database, id, name),
    onSuccess: (_renamed, { id }) => invalidatePlaylistQueries(queryClient, id),
  });
}

export function useAddToPlaylist() {
  const db = useReadyDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ playlistId, trackId }: { playlistId: string; trackId: string }) =>
      addTrackToPlaylist(db as Database, playlistId, trackId),
    onSuccess: (_data, { playlistId }) => invalidatePlaylistQueries(queryClient, playlistId),
  });
}

export function useRemoveFromPlaylist() {
  const db = useReadyDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ playlistId, trackId }: { playlistId: string; trackId: string }) =>
      removeTrackFromPlaylist(db as Database, playlistId, trackId),
    onSuccess: (_data, { playlistId }) => invalidatePlaylistQueries(queryClient, playlistId),
  });
}

/* ------------------------------------------------------------------- history */

/**
 * Paginated listening-history feed (newest first).
 *
 * Same full-page contract as `useFavorites`, and the key carries only the page
 * size — the offset lives in React Query's page params, so invalidation from
 * `clearHistory` resets every loaded page at once instead of one offset.
 */
export function useHistoryPage(limit = 30) {
  const db = useReadyDatabase();
  return useInfiniteQuery({
    queryKey: queryKeys.history(limit),
    enabled: Boolean(db),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<HistoryEntry[]> =>
      getHistoryPage(db as Database, limit, pageParam),
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length === limit ? lastPageParam + limit : undefined,
  });
}

export function useRecentlyPlayed(limit = 20) {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: queryKeys.recentlyPlayed(limit),
    enabled: Boolean(db),
    queryFn: async () => getRecentlyPlayedTracks(db as Database, limit),
  });
}

export function useMostPlayed(limit = 20) {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: queryKeys.mostPlayed(limit),
    enabled: Boolean(db),
    queryFn: async () => getMostPlayedTracks(db as Database, limit),
  });
}

export function useTopGenres(limit = 12) {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: ['library', 'topGenres', limit],
    enabled: Boolean(db),
    queryFn: async () => getTopGenres(db as Database, limit),
  });
}

export function useClearHistory() {
  const db = useReadyDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => clearHistory(db as Database),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['library'] }),
  });
}

/* ------------------------------------------------------------------- search */

export function useRecentSearches(limit = 8) {
  const db = useReadyDatabase();
  return useQuery({
    queryKey: queryKeys.recentSearches(),
    enabled: Boolean(db),
    queryFn: async () => getRecentSearchQueries(db as Database, limit),
  });
}

/* ------------------------------------------------------------------ caching */

/**
 * Commits a page of search results to the catalogue cache.
 *
 * Fire-and-forget by design: persistence is an optimisation, and a failed write
 * must never turn a successful search into an error.
 */
export function useCacheTracks() {
  const db = useReadyDatabase();
  return useCallback((tracks: readonly Track[]) => {
    if (!db || tracks.length === 0) return;
    void upsertTracks(db as Database, tracks).catch(() => undefined);
  }, [db]);
}

export type { Playlist, HistoryEntry };