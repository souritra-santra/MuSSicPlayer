import type { Album, Artist, Recommendation, SearchResult, Track } from '@/types';
import { detectTrackKind, normalizeText } from '@/utils/normalize';

import {
  parseProviderSearchPayload,
  type MusicProvider,
  type ProviderSearchQuery,
  type ProviderSearchResult,
} from '../types';

const PROVIDER_ID = 'jamendo';
const CLIENT_ID = '2b58a9b8';

/** Maps a Jamendo `results[]` entry onto the app's `Track` model. */
function mapJamendoTrack(t: any): Track {
  const artistName = t.artist_name || '';
  const title = t.name || t.title || '';
  const kind = detectTrackKind(title);
  return {
    id: `${PROVIDER_ID}:${String(t.id)}`,
    provider: PROVIDER_ID,
    externalId: String(t.id),
    title,
    artistIds: artistName ? [`${PROVIDER_ID}:artist-${normalizeText(artistName).replace(/\s+/g, '-')}`] : [],
    artistNames: artistName ? [artistName] : [],
    albumId: t.album_id ? `${PROVIDER_ID}:album-${t.album_id}` : undefined,
    albumTitle: t.album_name || undefined,
    durationMs: t.duration ? t.duration * 1000 : undefined,
    artworkUrl: t.album_image || t.image || undefined,
    externalUrl: t.shareurl || t.audio || undefined,
    streamUrl: t.audio || undefined,
    genres: t.tags ? String(t.tags).split(',').map((x: string) => x.trim()).filter(Boolean) : [],
    year: t.releasedate ? Number(String(t.releasedate).slice(0, 4)) : undefined,
    explicit: Boolean(t.explicit_lyrics),
    kind,
  } as Track;
}

export const jamendoProvider: MusicProvider = {
  id: PROVIDER_ID,
  displayName: 'Jamendo',
  description: 'Directly streamable CC/licensed tracks.',
  capabilities: {
    canStream: true,
    needsResolver: false,
    hasArtwork: true,
    hasArtists: true,
    hasAlbums: true,
    hasRecommendations: true,
    requiresAuth: false,
  },
  isEnabled: () => true,
  async search({ query, limit = 25, kinds }: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const qs = new URLSearchParams({
      client_id: CLIENT_ID,
      format: 'json',
      limit: String(limit),
      namesearch: query,
    });
    const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${qs.toString()}`, {
      headers: { 'User-Agent': 'MusicPlayerApp/1.0' },
    });
    if (!res.ok) throw new Error(`Jamendo search failed: ${res.status}`);
    const json = await res.json();
    const items = Array.isArray(json?.results) ? json.results : [];

    const tracks: Track[] = items.map(mapJamendoTrack);

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
      client_id: CLIENT_ID,
      format: 'json',
      limit: '12',
      order: 'popularity_total',
    });
    const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${qs.toString()}`, {
      headers: { 'User-Agent': 'MusicPlayerApp/1.0' },
    });
    if (!res.ok) throw new Error(`Jamendo trending failed: ${res.status}`);
    const json = await res.json();
    const items = Array.isArray(json?.results) ? json.results : [];
    const tracks: Track[] = items.map(mapJamendoTrack);
    return [
      {
        id: `${PROVIDER_ID}-trending`,
        title: 'Popular on Jamendo',
        tracks: tracks.map<SearchResult>((track) => ({ track, score: 1 })),
        provider: PROVIDER_ID,
      },
    ];
  },
};