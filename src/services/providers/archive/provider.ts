import type { Album, Artist, Recommendation, Track } from '@/types';
import { detectTrackKind, normalizeText } from '@/utils/normalize';

import {
  parseProviderSearchPayload,
  type MusicProvider,
  type ProviderSearchQuery,
  type ProviderSearchResult,
} from '../types';

const PROVIDER_ID = 'archive';

function trackFromMeta(identifier: string, meta: any): Track | null {
  const title = meta?.metadata?.title || meta?.title || identifier;
  const artistName = Array.isArray(meta?.metadata?.creator) ? meta.metadata.creator[0] : (meta?.metadata?.creator || '');
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const audio = files.find((f: any) => typeof f.name === 'string' && /\.(mp3|ogg|flac|m4a|wav)$/i.test(f.name));
  if (!audio) return null;
  const d1 = meta?.d1;
  const server = meta?.server;
  let base = '';
  if (server && d1) base = `https://${d1}`;
  else if (server) base = `https://${server}`;
  else base = 'https://archive.org';
  const streamUrl = `${base}/download/${identifier}/${encodeURIComponent(audio.name)}`;
  const artwork = meta?.files?.find((f: any) => typeof f.name === 'string' && /(?:jpg|png|jpeg)$/i.test(f.name));
  const artUrl = artwork ? `${base}/download/${identifier}/${encodeURIComponent(artwork.name)}` : undefined;
  const year = meta?.metadata?.year ? Number(meta.metadata.year) : undefined;
  const kind = detectTrackKind(title);
  return {
    id: `${PROVIDER_ID}:${identifier}`,
    provider: PROVIDER_ID,
    externalId: identifier,
    title,
    artistIds: artistName ? [`${PROVIDER_ID}:artist-${normalizeText(artistName).replace(/\s+/g, '-')}`] : [],
    artistNames: artistName ? [artistName] : [],
    durationMs: audio.length ? Number(audio.length) * 1000 : undefined,
    artworkUrl: artUrl,
    externalUrl: `https://archive.org/details/${identifier}`,
    streamUrl,
    genres: [],
    year,
    kind,
  };
}

export const archiveProvider: MusicProvider = {
  id: PROVIDER_ID,
  displayName: 'Internet Archive',
  description: 'Creative Commons/public domain audio.',
  capabilities: {
    canStream: true,
    needsResolver: false,
    hasArtwork: true,
    hasArtists: true,
    hasAlbums: false,
    hasRecommendations: false,
    requiresAuth: false,
  },
  isEnabled: () => true,
  async search({ query, limit = 15 }: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const q = `mediatype:(audio) AND (${query.split(/\s+/).map((w) => `(title:"${w}" OR creator:"${w}")`).join(' AND ')})`;
    const params = new URLSearchParams();
    params.set('q', q);
    params.set('fl[]', 'identifier');
    params.set('fl[]', 'title');
    params.set('fl[]', 'creator');
    params.set('fl[]', 'year');
    params.set('rows', String(Math.min(limit, 15)));
    params.set('page', '1');
    params.set('output', 'json');
    const res = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`);
    if (!res.ok) throw new Error(`Archive search failed: ${res.status}`);
    const json = await res.json();
    const docs = Array.isArray(json?.response?.docs) ? json.response.docs : [];

    const tracks: Track[] = [];
    for (const d of docs) {
      try {
        const m = await fetch(`https://archive.org/metadata/${d.identifier}`);
        if (!m.ok) continue;
        const meta = await m.json();
        const t = trackFromMeta(d.identifier, meta);
        if (t) tracks.push(t);
        if (tracks.length >= limit) break;
      } catch {
        // skip
      }
    }

    return parseProviderSearchPayload({ tracks, artists: [], albums: [] });
  },
  async getTrack(): Promise<Track | null> { return null; },
  async getArtist(): Promise<Artist | null> { return null; },
  async getAlbum(): Promise<Album | null> { return null; },
  async getRecommendations(): Promise<readonly Recommendation[]> { return []; },
};