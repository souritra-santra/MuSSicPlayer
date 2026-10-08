import {
  YT_ANDROID_CLIENT_VERSION,
  YT_ANDROID_SDK_VERSION,
  YT_ANDROID_USER_AGENT,
  YT_API_KEY,
} from '@/services/providers/youtube/constants';

/**
 * Built-in YouTube stream extraction.
 *
 * YouTube search hits only carry a video id, so playback requires turning the
 * id into a playable URL. Instead of requiring a third-party resolver, the
 * player asks youtubei's `player` endpoint directly with the same ANDROID
 * client context the search provider uses: it responds with adaptive formats
 * whose `url` fields are direct googlevideo stream links — no signing, no
 * proxy, no bot-protected instance in the middle.
 *
 * The minted URLs are network-bound and carry expiring tokens. YouTube now
 * serves most videos to third-party innertube clients as a ~70-second preview
 * only: googlevideo streams the head of the file and answers any read past it
 * with 403. The extractor probes the minted URL before handing it to the
 * player, so a preview-capped stream surfaces as an actionable message (and
 * the resolver falls back to a configured endpoint) instead of an opaque
 * player "source error". Pot/nsig-protected uploads and geo-restricted tracks
 * keep failing for the same reason as before.
 */

export type YoutubeExtractedStream = {
  /** Direct googlevideo audio stream URL. */
  readonly url: string;
  readonly mimeType?: string;
  readonly bitrateKbps?: number;
  /** Live length of the video in ms, when reported. */
  readonly durationMs?: number;
};

type AdaptiveFormat = {
  itag?: number;
  mimeType?: string;
  url?: string;
  bitrate?: number;
  contentLength?: number | string;
};

type PlayerPayload = {
  playabilityStatus?: {
    status?: string;
    reason?: string;
    errorScreen?: {
      playerErrorMessageRenderer?: {
        reason?: { runs?: { text: string }[] };
      };
    };
  };
  videoDetails?: { lengthSeconds?: string };
  streamingData?: { adaptiveFormats?: AdaptiveFormat[] };
};

/** How long a single extraction call may take before it is abandoned. */
const EXTRACT_TIMEOUT_MS = 20_000;

/** Below this duration (seconds) a file always fits inside the preview window. */
const PREVIEW_SAFE_SECONDS = 60;

/** A file this small or smaller always fits under the preview cap. */
const PREVIEW_SAFE_BYTES = 1_000_000;

/** How long the serve-capacity probe may take before it is given up on. */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * Checks whether googlevideo will actually stream the whole file before the
 * player commits to it. YouTube caps unauthenticated innertube streams at
 * roughly the first minute of audio; a read request past that answer is 403,
 * which would kill a player mid-stream with a cryptic "source error". A 2xx
 * on a ranged read deep inside the file means the URL serves in full.
 */
async function probeMediaServes(
  url: string,
  contentLength: number | string | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const cl = Number(contentLength);
    const start = Math.max(Math.floor(cl * 0.85), PREVIEW_SAFE_BYTES);
    const end = Math.min(cl - 1, start + 4095);
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: `bytes=${start}-${end}` },
      signal: controller.signal,
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    // Timeout or transport failure: cannot confirm full serving, so treat the
    // stream as unusable (the caller's message covers this case too).
    return false;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function playabilityReason(payload: PlayerPayload): string | undefined {
  const ps = payload.playabilityStatus;
  if (!ps) return undefined;
  if (ps.reason) return ps.reason;
  const runs = ps.errorScreen?.playerErrorMessageRenderer?.reason?.runs;
  if (runs) return runs.map((r) => r.text).join(' ').trim() || undefined;
  return ps.status;
}

/** Prefer itag 140 (AAC in mp4): plays on Android and iOS. */
function bestAudioFormat(formats: AdaptiveFormat[]): AdaptiveFormat {
  return (
    formats.find((f) => f.itag === 140) ??
    formats.find((f) => f.itag === 251) ??
    formats.reduce(
      (best, f) => ((f.bitrate ?? 0) > (best.bitrate ?? 0) ? f : best),
      formats[0],
    )
  );
}

async function requestFormats(
  videoId: string,
  signal?: AbortSignal,
): Promise<PlayerPayload | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${YT_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': YT_ANDROID_USER_AGENT,
          'X-YouTube-Client-Name': '3',
          'X-YouTube-Client-Version': YT_ANDROID_CLIENT_VERSION,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: YT_ANDROID_CLIENT_VERSION,
              hl: 'en',
              gl: 'US',
              androidSdkVersion: YT_ANDROID_SDK_VERSION,
            },
          },
          videoId,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`YouTube returned HTTP ${response.status}.`);
    }
    return (await response.json().catch(() => null)) as PlayerPayload | null;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('YouTube stream extraction timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Resolves a YouTube video id to a direct audio stream.
 *
 * Prefers itag 140 (AAC 128 kbps in an mp4 container): it plays on both
 * Android (ExoPlayer) and iOS (AVPlayer), unlike opus/webm formats that only
 * work on the former. A transient transport failure retries the mint once.
 * YouTube serves most videos to third-party clients as a ~70 s preview; such
 * preview-capped URLs are rejected before reaching the player and surface as
 * a clear, actionable error (a configured resolver is tried as a fallback).
 */
export async function extractYoutubeAudio(
  videoId: string,
  signal?: AbortSignal,
): Promise<YoutubeExtractedStream> {
  if (!videoId) {
    throw new Error('This YouTube track has no video id to resolve.');
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let payload: PlayerPayload | null;
    try {
      payload = await requestFormats(videoId, signal);
    } catch (error: unknown) {
      // A transport failure (timeout, DNS, 5xx) once, then give up. Refusals
      // at mint time are not retried: a re-mint would refuse identically.
      if (attempt === 0 && error instanceof Error) {
        continue;
      }
      throw error;
    }

    if (!payload) {
      throw new Error('YouTube returned an unreadable response.');
    }
    const psStatus = payload.playabilityStatus?.status;
    if (psStatus && psStatus !== 'OK') {
      const reason = playabilityReason(payload) ?? psStatus;
      throw new Error(`Video playback unavailable (${reason}).`);
    }

    const audio = (payload.streamingData?.adaptiveFormats ?? []).filter(
      (f) => typeof f.url === 'string' && f.url.length > 0 && /^audio\//.test(f.mimeType ?? ''),
    );
    if (audio.length === 0) {
      throw new Error('No playable audio stream was returned for this video.');
    }

    const format = bestAudioFormat(audio);
    const lengthSeconds = payload.videoDetails?.lengthSeconds;
    const parsedLength = lengthSeconds ? Number(lengthSeconds) : Number.NaN;
    const durationMs =
      Number.isFinite(parsedLength) && parsedLength > 0
        ? Math.round(parsedLength * 1000)
        : undefined;

    // Streams short enough to fit inside the preview window are handed over
    // directly. Anything longer gets a cheap probe of the minted URL: if
    // googlevideo only serves the head of the file, ExoPlayer would die a few
    // seconds in with a cryptic "source error" — fail with a clear message (or
    // fall through to a configured resolver) instead.
    const previewSafe =
      format.contentLength === undefined ||
      Number(format.contentLength) <= PREVIEW_SAFE_BYTES ||
      (Number.isFinite(parsedLength) && parsedLength <= PREVIEW_SAFE_SECONDS);
    if (
      !previewSafe &&
      !(await probeMediaServes(format.url as string, format.contentLength, signal))
    ) {
      throw new Error(
        'YouTube is only streaming a short preview of this video right now. Try a different result, or add a resolver URL in Settings to play the full track.',
      );
    }

    return {
      url: format.url as string,
      mimeType: format.mimeType,
      bitrateKbps: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
      durationMs,
    };
  }

  throw new Error('YouTube stream extraction failed.');
}