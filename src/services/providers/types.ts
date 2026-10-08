import type {
  Album,
  Artist,
  ProviderCapabilities,
  ProviderId,
  Recommendation,
  ResolvedStream,
  Track,
  TrackKind,
} from '@/types';
import { providerSearchPayloadSchema, type ProviderSearchPayload } from '@/types/schemas';

/**
 * The contract every music source implements.
 *
 * This is the seam that lets instruction.md's "add new music sources later
 * without changing the app" requirement hold: the unified search pipeline, the
 * database and every screen only ever see the normalized models below, never a
 * provider's own response shape.
 */
export type ProviderSearchQuery = {
  readonly query: string;
  readonly limit?: number;
  /** Restrict results to specific track kinds (e.g. only remixes). */
  readonly kinds?: readonly TrackKind[];
  readonly offset?: number;
};

/**
 * What `search()` returns.
 *
 * Derived from the Zod schema rather than restated here so the validator and
 * the contract cannot drift: a provider that parses its payload into
 * `providerSearchPayloadSchema` satisfies this by construction.
 */
export type ProviderSearchResult = {
  readonly tracks: readonly Track[];
  readonly artists: readonly Artist[];
  readonly albums: readonly Album[];
};

/** How a recommendation shelf was produced. */
export type RecommendationSeed = {
  /** Seed track ids the recommendations should relate to. */
  readonly trackIds?: readonly string[];
  readonly artistNames?: readonly string[];
  readonly genres?: readonly string[];
};

export interface MusicProvider {
  /** Stable slug, also used as the `tracks.provider` column value. */
  readonly id: ProviderId;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Whether the provider can currently be queried (credentials present,
   * feature enabled in settings). Disabled providers are skipped by the fan-out
   * rather than erroring.
   */
  isEnabled(): boolean;

  search(query: ProviderSearchQuery): Promise<ProviderSearchResult>;

  getTrack(externalId: string): Promise<Track | null>;

  getArtist(externalId: string): Promise<Artist | null>;

  getAlbum(externalId: string): Promise<Album | null>;

  getRecommendations(seed?: RecommendationSeed): Promise<readonly Recommendation[]>;

  /**
   * Optional: turns a track into a playable URL. Providers that expose stable
   * stream URLs implement this directly; resolver-backed providers leave it to
   * the `StreamResolver` in `services/player/resolver.ts`.
   */
  resolveStream?(track: Track): Promise<ResolvedStream | null>;
}

/**
 * Validates a provider payload and maps it onto the app models.
 *
 * Every provider funnels through this, not just the networked ones: it is the
 * single place where "a provider cannot hand the app something that does not
 * fit the models" is enforced, so a new source gets that guarantee for free
 * instead of having to remember the rule.
 */
export function parseProviderSearchPayload(payload: unknown): ProviderSearchResult {
  const parsed: ProviderSearchPayload = providerSearchPayloadSchema.parse(payload);
  return { tracks: parsed.tracks, artists: parsed.artists, albums: parsed.albums };
}

/** Thrown when a provider is queried before it has been configured. */
export class ProviderNotConfiguredError extends Error {
  readonly providerId: ProviderId;

  constructor(providerId: ProviderId, detail?: string) {
    super(
      `Provider "${providerId}" is not configured${detail ? `: ${detail}` : ''}. Add the required settings to enable it.`,
    );
    this.name = 'ProviderNotConfiguredError';
    this.providerId = providerId;
  }
}

/** Normalizes an unknown provider failure into something displayable. */
export function describeProviderError(error: unknown): string {
  if (error instanceof ProviderNotConfiguredError) return error.message;
  if (error instanceof Error) {
    if (/abort/i.test(error.name)) return 'Request cancelled';
    return error.message || 'Request failed';
  }
  return 'Request failed';
}