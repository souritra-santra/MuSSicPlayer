import type { Album, Artist, Recommendation, SearchResult, Track } from '@/types';
import { detectTrackKind, normalizeText } from '@/utils/normalize';

import {
  parseProviderSearchPayload,
  type MusicProvider,
  type ProviderSearchQuery,
  type ProviderSearchResult,
} from '../types';

const PROVIDER_ID = 'audius';

function normalizeArtwork(a?: any): string | undefined {
  if (!a) return undefined;
  const best = a['1000x1000'] || a['480x480'] || a['150x150'] || a['2000x'] || a['640x'];
  if (best) return best;
  if (Array.isArray(a.mirrors) && a.mirrors.length > 0) return a.mirrors[0];
  return undefined;
}

function normalizeStream(s?: any): string | undefined {
  if (!s) return undefined;
  if (s.url) return s.url;
  if (Array.isArray(s.mirrors) && s.mirrors.length > 0) return s.mirrors[0];
  return undefined;
}

/** Maps an Audius track item onto the app's `Track` model. */
function mapAudiusTrack(t: any): Track {
  const artistName = t.user?.name || t.user?.handle || '';
  const title = t.title || '';
  const kind = detectTrackKind(title);
  return {
    id: `${PROVIDER_ID}:${String(t.id)}`,
    provider: PROVIDER_ID,
    externalId: String(t.id),
    title,
    artistIds: artistName ? [`${PROVIDER_ID}:artist-${normalizeText(artistName).replace(/\s+/g, '-')}`] : [],
    artistNames: artistName ? [artistName] : [],
    durationMs: t.duration ? t.duration * 1000 : undefined,
    artworkUrl: normalizeArtwork(t.artwork),
    externalUrl: t.permalink ? `https://audius.co${t.permalink}` : undefined,
    streamUrl: normalizeStream(t.stream),
    genres: Array.isArray(t.genre) ? t.genre : t.genre ? [String(t.genre)] : [],
    year: t.release_date ? Number(String(t.release_date).slice(0, 4)) : undefined,
    explicit: false,
    kind,
  } as Track;
}

export const audiusProvider: MusicProvider = {
  id: PROVIDER_ID,
  displayName: 'Audius',
  description: 'Directly streamable music from independent creators.',
  capabilities: {
    canStream: true,
    needsResolver: false,
    hasArtwork: true,
    hasArtists: true,
    hasAlbums: false,
    hasRecommendations: true,
    requiresAuth: false,
  },
  isEnabled: () => true,
  async search({ query, limit = 25, kinds }: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const qs = new URLSearchParams({
      query,
      app_name: 'musicplayer',
    });
    const res = await fetch(`https://discoveryprovider.audius.co/v1/tracks/search?${qs.toString()}`, {
      headers: { 'User-Agent': 'MusicPlayerApp/1.0' },
    });
    if (!res.ok) throw new Error(`Audius search failed: ${res.status}`);
    const json = await res.json();
    const items = Array.isArray(json?.data) ? json.data : [];

    const tracks: Track[] = items.map(mapAudiusTrack);

    let filtered = tracks;
    if (kinds && kinds.length > 0) filtered = tracks.filter((t) => kinds.includes(t.kind));
    filtered = filtered.slice(0, limit);

    return parseProviderSearchPayload({ tracks: filtered, artists: [], albums: [] });
  },
  async getTrack(): Promise<Track | null> { return null; },
  async getArtist(): Promise<Artist | null> { return null; },
  async getAlbum(): Promise<Album | null> { return null; },
  async getRecommendations(): Promise<readonly Recommendation[]> {
    const qs = new URLSearchParams({
      limit: '12',
      app_name: 'musicplayer',
    });
    const res = await fetch(`https://discoveryprovider.audius.co/v1/tracks/trending?${qs.toString()}`, {
      headers: { 'User-Agent': 'MusicPlayerApp/1.0' },
    });
    if (!res.ok) throw new Error(`Audius trending failed: ${res.status}`);
    const json = await res.json();
    const items = Array.isArray(json?.data) ? json.data : [];
    const tracks: Track[] = items.map(mapAudiusTrack);
    return [
      {
        id: `${PROVIDER_ID}-trending`,
        title: 'Trending on Audius',
        tracks: tracks.map<SearchResult>((track) => ({ track, score: 1 })),
        provider: PROVIDER_ID,
      },
    ];
  },
};