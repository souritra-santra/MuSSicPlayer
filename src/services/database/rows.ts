/**
 * SQLite row shapes. These mirror the schema exactly (snake_case) and are kept
 * separate from the domain models in `src/types` so a schema change is a
 * compile-time error in one place instead of a silent mismatch in many.
 */

export type TrackRow = {
  id: number;
  provider: string;
  external_id: string;
  title: string;
  norm_title: string;
  artist_names: string;
  norm_artist: string;
  artist_ids: string;
  album_id: number | null;
  album_title: string | null;
  duration_ms: number | null;
  duration_bucket: number | null;
  artwork_url: string | null;
  external_url: string | null;
  stream_url: string | null;
  stream_expires_at: number | null;
  isrc: string | null;
  kind: string;
  genres: string;
  year: number | null;
  explicit: number;
  signature: string;
  created_at: number;
  updated_at: number;
};

export type ArtistRow = {
  id: number;
  provider: string;
  external_id: string;
  name: string;
  norm_name: string;
  artwork_url: string | null;
  external_url: string | null;
  follower_count: number | null;
  created_at: number;
  updated_at: number;
};

export type AlbumRow = {
  id: number;
  provider: string;
  external_id: string;
  title: string;
  norm_title: string;
  artist_id: number | null;
  artist_name: string;
  artwork_url: string | null;
  external_url: string | null;
  year: number | null;
  created_at: number;
  updated_at: number;
};

export type PlaylistRow = {
  id: number;
  name: string;
  description: string | null;
  artwork_url: string | null;
  system: number;
  created_at: number;
  updated_at: number;
};

/** Aggregated playlist row including `track_count` for list rendering. */
export type PlaylistWithCountRow = PlaylistRow & { track_count: number };

export type TrackStatsRow = {
  track_id: number;
  play_count: number;
  skip_count: number;
  total_ms: number;
  first_played_at: number | null;
  last_played_at: number | null;
};

export type SearchHistoryRow = {
  id: number;
  query: string;
  norm_query: string;
  result_count: number;
  searched_at: number;
};

export type QueueRow = {
  id: number;
  track_id: number;
  position: number;
  context: string;
  added_at: number;
};

export type CountRow = { count: number };