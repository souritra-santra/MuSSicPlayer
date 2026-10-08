/**
 * Public surface of the local data layer.
 *
 * Screens and hooks should import from `@/services/database` rather than
 * reaching into `./repositories/*`, so the storage implementation can change
 * without touching feature code.
 */

export { closeDatabase, DATABASE_NAME, getDatabase, SCHEMA_VERSION } from './client';
export type { Database } from './client';

export { getSchemaVersion, MIGRATIONS } from './migrations';
export type { Migration } from './migrations';

export {
  getFtsSupport,
  rebuildFtsIndex,
  searchTrackIds,
  type FtsSupport,
} from './fts';

export {
  getLibraryStats,
  HISTORY_RETENTION_LIMIT,
  resetEverything,
  resetUserData,
  runMaintenance,
  SEARCH_HISTORY_LIMIT,
  type MaintenanceReport,
} from './maintenance';

// Catalogue
export {
  countTracks,
  getAlbumTracks,
  getTrackById,
  getTrackByProviderId,
  getTrackCountsByProvider,
  getTrackRowId,
  getTracksByIds,
  getTracksByRowIds,
  getAllCachedTracks,
  isFavorite,
  parseTrackId,
  rowToAlbum,
  rowToArtist,
  rowToTrack,
  searchLocalTracks,
  setTrackStream,
  upsertTrack,
  upsertTracks,
} from './repositories/tracks';

export {
  countAlbums,
  countArtists,
  getAlbumByProviderId,
  getArtistByProviderId,
  getRecentAlbums,
  getTopArtists,
  upsertAlbum,
  upsertAlbums,
  upsertArtist,
  upsertArtists,
} from './repositories/catalog';

// Library
export {
  addFavorite,
  countFavorites,
  getFavoriteTrackIds,
  getFavoriteTrackIdsFor,
  getFavoriteTracks,
  getUnplayedFavorites,
  removeFavorite,
  toggleFavorite,
} from './repositories/favorites';

export {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylistById,
  getPlaylists,
  getPlaylistTracks,
  removeTrackFromPlaylist,
  renamePlaylist,
  reorderPlaylistTracks,
} from './repositories/playlists';

// Signals
export {
  clearHistory,
  countHistoryEntries,
  getContinueListeningTracks,
  getCoOccurrences,
  getHistoryPage,
  getMostPlayedTracks,
  getRecentlyPlayedTracks,
  getTopGenres,
  getTrackStats,
  isCompletedPlay,
  pruneHistory,
  recordPlay,
  type CoOccurrence,
  type GenreAffinity,
  type HistoryEntry,
} from './repositories/history';

export {
  clearSearchHistory,
  getRecentSearchQueries,
  getSearchHistory,
  pruneSearchHistory,
  recordSearch,
  removeSearchEntry,
  suggestQueries,
} from './repositories/searchHistory';

export {
  clearQueue,
  countQueueItems,
  enqueueTrack,
  getQueue,
  getQueueTrackIds,
  removeFromQueue,
  replaceQueue,
  type StoredQueueItem,
} from './repositories/queue';

export {
  clearCacheEntries,
  countCacheEntries,
  deleteValue,
  getCacheEntry,
  getValue,
  setCacheEntry,
  setValue,
} from './repositories/kv';

export type {
  AlbumRow,
  ArtistRow,
  PlaylistRow,
  PlaylistWithCountRow,
  QueueRow,
  SearchHistoryRow,
  TrackRow,
  TrackStatsRow,
} from './rows';