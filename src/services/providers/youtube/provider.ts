import type { Album, Artist, Recommendation, Track } from '@/types';
import { detectTrackKind, normalizeText } from '@/utils/normalize';

import {
  YT_ANDROID_CLIENT_VERSION,
  YT_ANDROID_USER_AGENT,
  YT_API_KEY,
} from './constants';

import {
  parseProviderSearchPayload,
  type MusicProvider,
  type ProviderSearchQuery,
  type ProviderSearchResult,
} from '../types';

const PROVIDER_ID = 'youtube';

type YtThumbnail = { url: string; width?: number; height?: number };
type YtRun = { text: string; navigationEndpoint?: any };

function parseDurationMs(text?: string): number | undefined {
  if (!text) return undefined;
  const s = text.trim();
  if (s.length === 0) return undefined;
  // HH:MM:SS or MM:SS
  const parts = s.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  if (parts.length === 3) {
    const [h, m, sec] = parts;
    return ((h * 60 + m) * 60 + sec) * 1000;
  }
  if (parts.length === 2) {
    const [m, sec] = parts;
    return (m * 60 + sec) * 1000;
  }
  return undefined;
}

function extractText(runs?: YtRun[]): string {
  if (!runs || runs.length === 0) return '';
  return runs.map((r) => r.text).join(' ');
}

function bestThumbnail(thumbnails?: YtThumbnail[]): string | undefined {
  if (!thumbnails || thumbnails.length === 0) return undefined;
  return thumbnails[thumbnails.length - 1]?.url ?? thumbnails[0]?.url;
}



export const youtubeProvider: MusicProvider = {
  id: PROVIDER_ID,
  displayName: 'YouTube',
  description:
    'Video-based results; plays out of the box through the built-in stream extractor.',
  capabilities: {
    // The stream is resolved at playback time by the app's built-in innertube
    // extractor (src/services/player/youtube.ts), so no user-configured
    // resolver is required — hence canStream for the UI and needsResolver off.
    canStream: true,
    needsResolver: false,
    hasArtwork: true,
    hasArtists: true,
    hasAlbums: false,
    // No trending feed is implemented for YouTube's innertube API — search only —
    // so `getRecommendations()` stays empty and the trending fan-out skips it.
    hasRecommendations: false,
    requiresAuth: false,
  },

  isEnabled: () => true,

  async search({ query, limit = 25, kinds }: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const body = {
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: YT_ANDROID_CLIENT_VERSION,
          hl: 'en',
          gl: 'US',
        },
      },
      query,
    };

    const res = await fetch('https://www.youtube.com/youtubei/v1/search?key=' + YT_API_KEY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': YT_ANDROID_USER_AGENT,
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': YT_ANDROID_CLIENT_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`YouTube search failed: ${res.status}`);
    const json = await res.json();

    const tracks: Track[] = [];
    const artists: Artist[] = [];

    const sectionList = json?.contents?.sectionListRenderer?.contents ?? [];
    for (const s of sectionList) {
      const isr = s?.itemSectionRenderer?.contents ?? [];
      for (const c of isr) {
        const v = c?.compactVideoRenderer || c?.videoRenderer;
        if (!v || !v.videoId) continue;
        const title = extractText(v.title?.runs) || v.title?.simpleText || '';
        if (!title) continue;
        const artistName = extractText(v.shortBylineText?.runs) || extractText(v.longBylineText?.runs) || '';
        const durationMs =
          parseDurationMs(v.lengthText?.simpleText) ||
          parseDurationMs(v.lengthText?.runs?.[0]?.text) ||
          (v.lengthSeconds ? Number(v.lengthSeconds) * 1000 : undefined);
        const thumb = bestThumbnail(v.thumbnail?.thumbnails);

        const track: Track = {
          id: `${PROVIDER_ID}:${v.videoId}`,
          provider: PROVIDER_ID,
          externalId: v.videoId,
          title,
          artistIds: artistName ? [`${PROVIDER_ID}:artist-${normalizeText(artistName).replace(/\s+/g, '-')}`] : [],
          artistNames: artistName ? [artistName] : [],
          durationMs,
          artworkUrl: thumb,
          externalUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
          kind: detectTrackKind(title),
          genres: [],
        };
        tracks.push(track);
        if (artistName) {
          artists.push({
            id: `${PROVIDER_ID}:artist-${normalizeText(artistName).replace(/\s+/g, '-')}`,
            provider: PROVIDER_ID,
            name: artistName,
          });
        }
      }
    }

    // Filter by kinds if requested
    let filtered = tracks;
    if (kinds && kinds.length > 0) {
      filtered = tracks.filter((t) => kinds.includes(t.kind));
    }
    filtered = filtered.slice(0, limit);

    const dedupeArtists = Array.from(new Map(artists.map((a) => [a.id, a])).values()).slice(0, 10);

    return parseProviderSearchPayload({
      tracks: filtered,
      artists: dedupeArtists,
      albums: [],
    });
  },

  async getTrack(externalId: string): Promise<Track | null> {
    return null;
  },
  async getArtist(externalId: string): Promise<Artist | null> {
    return null;
  },
  async getAlbum(): Promise<Album | null> {
    return null;
  },
  async getRecommendations(): Promise<readonly Recommendation[]> {
    return [];
  },
};