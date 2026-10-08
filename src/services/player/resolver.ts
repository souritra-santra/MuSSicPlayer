import type { ResolvedStream, Track } from '@/types';

import { extractYoutubeAudio } from './youtube';

/**
 * Stream resolution.
 *
 * Providers that hand out stable audio URLs (Jamendo, Audius, Internet
 * Archive) resolve directly. Video-platform sources only expose an id.
 *
 * YouTube hits are the app's default: a built-in extractor asks youtubei's
 * `player` endpoint (the same API family the search provider uses) for a
 * direct audio stream, so no configuration is needed. When the minted stream
 * is preview-capped (things under a minute play, longer songs hit a 403), the
 * extractor detects that and reports it clearly. A user-supplied
 * cobalt-compatible endpoint takes precedence for YouTube — and covers other
 * platforms: it can play full-length audio where the built-in extractor only
 * gets a preview, with the built-in extractor as a fallback. Cobalt endpoints
 * stay user-configured rather than hardcoded because public instances sit
 * behind bot protection and explicitly ask third-party apps not to ship
 * against them.
 */

export type ResolverConfig = {
  /** Base URL of a cobalt-compatible resolver, e.g. `https://my-instance.tld`. */
  readonly endpoint: string;
  /** Optional bearer/API token, when the instance requires one. */
  readonly apiKey?: string;
  /** Preferred audio quality: `best` | `128` | `96` | `64`. */
  readonly quality?: 'best' | '128' | '96' | '64';
};

export class ResolverNotConfiguredError extends Error {
  constructor() {
    super('No stream resolver configured. Add a resolver URL in Settings to play this track.');
    this.name = 'ResolverNotConfiguredError';
  }
}

export class StreamResolutionError extends Error {
  readonly providerId: string;

  constructor(providerId: string, detail: string) {
    super(detail);
    this.name = 'StreamResolutionError';
    this.providerId = providerId;
  }
}

/** True when the track can be played without a resolver. */
export function isDirectlyPlayable(track: Track): boolean {
  return typeof track.streamUrl === 'string' && track.streamUrl.length > 0;
}

/** Normalizes a user-entered endpoint (adds scheme, trims trailing slashes). */
export function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

/** Present for UI purposes so Settings can explain the current state. */
export function describeResolver(config: ResolverConfig | null): string {
  if (!config || config.endpoint.length === 0) {
    return 'Built-in YouTube stream extractor active — YouTube results play directly.';
  }
  return config.endpoint;
}

/** Preferred source URL for a resolver request, if the provider exposes one. */
function resolverSourceUrl(track: Track): string | undefined {
  if (track.externalUrl) return track.externalUrl;
  if (track.provider === 'youtube') {
    return `https://www.youtube.com/watch?v=${track.externalId}`;
  }
  return undefined;
}

/** Cobalt-compatible audio quality values (`audioQuality`). */
function audioQualityFor(config: ResolverConfig | undefined): 'best' | 320 | 256 | 192 | 128 | 96 | 64 {
  switch (config?.quality) {
    case 'best':
      return 'best';
    case '96':
      return 96;
    case '64':
      return 64;
    case '128':
    default:
      // The setting ships defaulting to 128 kbps: small files, inaudible loss
      // on phone speakers, and the most widely supported tier across sources.
      return 128;
  }
}

/**
 * How long a resolver call may take before it is abandoned.
 *
 * Deliberately generous: self-hosted yt-dlp resolvers (see server/) warm up on
 * first use — the EJS component fetch can take tens of seconds — and some
 * instances transcode before answering. Free-tier hosts (Render, Spaces) are
 * slow enough that a cold first resolve can push past a minute.
 */
const RESOLVE_TIMEOUT_MS = 75_000;

type CobaltResponse = {
  status?: string;
  url?: string;
  filename?: string;
  audioDuration?: number;
  error?: { code?: string; context?: string };
};

/**
 * Resolves a track to a playable URL.
 *
 * Directly-streamable providers (Jamendo, Audius, Internet Archive) short-
 * circuit to their stable URL. YouTube tracks prefer a configured cobalt
 * endpoint (full-length audio) and fall back to the built-in extractor.
 * Anything else goes to the user's cobalt-compatible resolver: a single POST
 * with JSON in, JSON out. The response's `tunnel` variant is proxied through
 * the instance and needs an `Accept` header naming audio content types;
 * `redirect` is a direct link.
 */
export async function resolveStream(
  track: Track,
  config: ResolverConfig | null,
  signal?: AbortSignal,
): Promise<ResolvedStream> {
  if (isDirectlyPlayable(track)) {
    return { url: track.streamUrl as string };
  }

  if (track.provider === 'youtube') {
    return resolveYoutubeStream(track, config, signal);
  }

  if (!config || config.endpoint.length === 0) {
    throw new ResolverNotConfiguredError();
  }

  return resolveViaCobalt(track, config, signal);
}

/**
 * YouTube path. A configured resolver is the user's explicit YouTube override:
 * it serves full-length audio where the built-in innertube extractor only gets
 * a preview, so it is tried first, with the built-in extractor as a fallback.
 * With no resolver configured the built-in extractor is used on its own.
 */
async function resolveYoutubeStream(
  track: Track,
  config: ResolverConfig | null,
  signal?: AbortSignal,
): Promise<ResolvedStream> {
  const resolveBuiltin = async (): Promise<ResolvedStream> => {
    const extracted = await extractYoutubeAudio(track.externalId, signal);
    return {
      url: extracted.url,
      mimeType: extracted.mimeType,
      bitrateKbps: extracted.bitrateKbps,
      durationMs: extracted.durationMs ?? track.durationMs,
    };
  };

  if (config && config.endpoint.length > 0) {
    try {
      return await resolveViaCobalt(track, config, signal);
    } catch (resolverError: unknown) {
      const resolverMessage =
        resolverError instanceof Error ? resolverError.message : String(resolverError);
      try {
        return await resolveBuiltin();
      } catch (builtinError: unknown) {
        const builtinMessage =
          builtinError instanceof Error ? builtinError.message : String(builtinError);
        throw new StreamResolutionError(
          'youtube',
          `${builtinMessage} The custom resolver also failed: ${resolverMessage}`,
        );
      }
    }
  }

  try {
    return await resolveBuiltin();
  } catch (primary: unknown) {
    const primaryMessage = primary instanceof Error ? primary.message : String(primary);
    throw new StreamResolutionError('youtube', primaryMessage);
  }
}

async function resolveViaCobalt(
  track: Track,
  config: ResolverConfig,
  signal?: AbortSignal,
): Promise<ResolvedStream> {
  const sourceUrl = resolverSourceUrl(track);
  if (!sourceUrl) {
    throw new StreamResolutionError(
      track.provider,
      'This track has no source URL to resolve.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Apikey ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        url: sourceUrl,
        // Modern cobalt dialect…
        audioFormat: 'mp3',
        audioQuality: audioQualityFor(config),
        downloadMode: 'audio',
        // …plus the legacy field names, so older self-hosted instances that
        // still read `aFormat`/`isAudioOnly` work without a second setting.
        aFormat: 'mp3',
        isAudioOnly: true,
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as CobaltResponse | null;
    if (!payload || typeof payload.url !== 'string' || payload.url.length === 0) {
      const detail = payload?.error?.code ?? payload?.error?.context;
      throw new StreamResolutionError(
        track.provider,
        detail
          ? `Resolver error: ${detail}`
          : `Resolver returned ${response.status} without a stream URL.`,
      );
    }

    return {
      url: payload.url,
      mimeType: 'audio/mpeg',
      durationMs:
        typeof payload.audioDuration === 'number' && payload.audioDuration > 0
          ? Math.round(payload.audioDuration * 1000)
          : track.durationMs,
      // Tunnelled responses are proxied by the instance and must declare that
      // they are audio, or the proxy refuses the request.
      requiresHeaders:
        payload.status === 'tunnel'
          ? { Accept: 'audio/mpeg, audio/mp4, audio/*;q=0.9' }
          : undefined,
    };
  } catch (error: unknown) {
    if (error instanceof StreamResolutionError || error instanceof ResolverNotConfiguredError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new StreamResolutionError(track.provider, 'Stream resolution timed out.');
    }
    throw new StreamResolutionError(
      track.provider,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

export type { ResolvedStream };