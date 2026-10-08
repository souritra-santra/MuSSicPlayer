/**
 * Core domain models.
 *
 * These types are the contract between providers (which speak their own
 * dialects), the local database, and the UI. Nothing here is provider
 * specific — provider payloads are normalized into these shapes at the
 * provider boundary and validated with the schemas in `./schemas`.
 */

/** Identifier of a music source, e.g. `youtube`, `jamendo`, `audius`. */
export type ProviderId = string;

/**
 * What a track actually is. Drives the "Remixes / Covers / Instrumentals"
 * buckets in unified search and the visual badges on rows.
 */
export type TrackKind =
  | 'song'
  | 'remix'
  | 'cover'
  | 'live'
  | 'acoustic'
  | 'instrumental'
  | 'dj-mix'
  | 'extended'
  | 'karaoke'
  | 'sped-up'
  | 'slowed'
  | 'unknown';

export const TRACK_KINDS: readonly TrackKind[] = [
  'song',
  'remix',
  'cover',
  'live',
  'acoustic',
  'instrumental',
  'dj-mix',
  'extended',
  'karaoke',
  'sped-up',
  'slowed',
  'unknown',
] as const;

/** Per-provider capabilities, used to hide unusable controls and skip providers. */
export type ProviderCapabilities = {
  /** Provider can return full-length playable audio. */
  readonly canStream: boolean;
  /** Audio needs a resolver URL before it can be played. */
  readonly needsResolver: boolean;
  /** Provider returns usable artwork URLs. */
  readonly hasArtwork: boolean;
  /** Provider offers an artist page. */
  readonly hasArtists: boolean;
  /** Provider offers an album page. */
  readonly hasAlbums: boolean;
  /** Provider exposes its own recommendation/trending feed. */
  readonly hasRecommendations: boolean;
  /** Provider needs user-entered credentials before it can be queried. */
  readonly requiresAuth: boolean;
};

export type Artist = {
  readonly id: string;
  readonly provider: ProviderId;
  readonly name: string;
  readonly artworkUrl?: string;
  readonly externalUrl?: string;
  readonly followers?: number;
};

export type Album = {
  readonly id: string;
  readonly provider: ProviderId;
  readonly title: string;
  readonly artistId?: string;
  readonly artistName: string;
  readonly artworkUrl?: string;
  readonly externalUrl?: string;
  readonly year?: number;
};

export type Track = {
  readonly id: string;
  readonly provider: ProviderId;
  /** Provider-native id (e.g. a YouTube video id). */
  readonly externalId: string;
  readonly title: string;
  readonly artistIds: readonly string[];
  readonly artistNames: readonly string[];
  readonly albumId?: string;
  readonly albumTitle?: string;
  /** Duration in milliseconds. `null` when the provider does not report it. */
  readonly durationMs?: number;
  readonly artworkUrl?: string;
  readonly externalUrl?: string;
  /**
   * Directly playable audio URL. Only set for providers that hand out stable
   * stream URLs; resolver-backed providers leave this `undefined` until the
   * track is resolved for playback.
   */
  readonly streamUrl?: string;
  readonly isrc?: string;
  readonly kind: TrackKind;
  readonly genres: readonly string[];
  readonly year?: number;
  readonly explicit?: boolean;
};

export type Playlist = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly artworkUrl?: string;
  readonly trackCount?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Built-in playlists are not user-deletable. */
  readonly system?: boolean;
};

/** A single normalized search hit, plus the ranking signal we computed for it. */
export type SearchResult = {
  readonly track: Track;
  readonly score: number;
  /** Set when this result was merged from another provider (see dedupe). */
  readonly alternates?: readonly {
    readonly provider: ProviderId;
    readonly track: Track;
  }[];
};

export type SearchSectionId =
  | 'best-match'
  | 'songs'
  | 'artists'
  | 'albums'
  | 'remixes'
  | 'similar'
  | 'other-sources';

export type SearchSection = {
  readonly id: SearchSectionId;
  readonly title: string;
  readonly tracks: readonly SearchResult[];
  readonly artists?: readonly Artist[];
  readonly albums?: readonly Album[];
};

export type UnifiedSearchResults = {
  readonly query: string;
  readonly sections: readonly SearchSection[];
  /** Providers that failed, so the UI can show a partial-result warning. */
  readonly failedProviders: readonly ProviderId[];
  readonly tookMs: number;
};

/** Normalized playback descriptor produced by a provider or a resolver. */
export type ResolvedStream = {
  readonly url: string;
  readonly mimeType?: string;
  readonly bitrateKbps?: number;
  readonly durationMs?: number;
  readonly expiresAt?: number;
  readonly requiresHeaders?: Readonly<Record<string, string>>;
};

export type PlayContext =
  | 'search'
  | 'recommendation'
  | 'playlist'
  | 'album'
  | 'artist'
  | 'library'
  | 'history'
  | 'queue';

export type QueueItem = {
  /** Stable id for list rendering: `${track.id}` plus de-dupe suffix. */
  readonly key: string;
  readonly track: Track;
  readonly context: PlayContext;
};

export type RepeatMode = 'off' | 'all' | 'one';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type PlaybackState = {
  readonly status: PlaybackStatus;
  readonly positionMs: number;
  readonly durationMs?: number;
  readonly bufferedMs?: number;
  readonly error?: string;
};

export type Recommendation = {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly tracks: readonly SearchResult[];
  /** Which local signal produced this shelf. */
  readonly reason?: string;
  readonly provider?: ProviderId;
};

export type ListeningEvent = {
  readonly trackId: string;
  readonly playedAt: number;
  /** How much of the track was actually listened to. */
  readonly playMs: number;
  readonly completed: boolean;
  readonly context: PlayContext;
};

export type TrackStats = {
  readonly trackId: string;
  readonly playCount: number;
  readonly skipCount: number;
  readonly totalMs: number;
  readonly firstPlayedAt?: number;
  readonly lastPlayedAt?: number;
};

/** Local DB metadata surfaced on the Settings screen. */
export type LibraryStats = {
  readonly tracks: number;
  readonly artists: number;
  readonly albums: number;
  readonly favorites: number;
  readonly playlists: number;
  readonly historyEntries: number;
  readonly databaseBytes?: number;
};