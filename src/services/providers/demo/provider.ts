import type { Album, Artist, Recommendation, SearchResult, Track } from '@/types';
import { detectTrackKind, normalizeText, tokenSimilarity, tokenize } from '@/utils/normalize';

import {
  parseProviderSearchPayload,
  type MusicProvider,
  type ProviderSearchQuery,
  type ProviderSearchResult,
  type RecommendationSeed,
} from '../types';

/**
 * Offline provider used during Phase 1.
 *
 * It exists so the entire pipeline — normalize -> dedupe -> rank -> group into
 * sections -> persist -> render — is exercised (and demonstrable) without any
 * network dependency. Real providers added in Phase 2 register alongside it;
 * nothing in the app special-cases this one beyond its `canStream: false`
 * capability, which the UI surfaces honestly as "metadata only".
 */

const PROVIDER_ID = 'demo';

type Seed = {
  readonly id: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly album?: string;
  readonly durationMs: number;
  readonly genres: readonly string[];
  readonly year: number;
  readonly kind?: Track['kind'];
};

const SEED: readonly Seed[] = [
  { id: 'm1', title: 'Blinding Lights', artists: ['The Weeknd'], album: 'After Hours', durationMs: 200_940, genres: ['pop', 'synthpop'], year: 2019 },
  { id: 'm2', title: 'Blinding Lights (Remix)', artists: ['The Weeknd', 'DJ Nova'], album: 'After Hours (Remixes)', durationMs: 224_000, genres: ['remix', 'edm'], year: 2020, kind: 'remix' },
  { id: 'm3', title: 'Blinding Lights (Acoustic Cover)', artists: ['Mia Rivers'], durationMs: 214_300, genres: ['acoustic', 'cover'], year: 2021, kind: 'cover' },
  { id: 'm4', title: 'Blinding Lights (Instrumental)', artists: ['The Weeknd'], durationMs: 200_940, genres: ['instrumental'], year: 2019, kind: 'instrumental' },
  { id: 'm5', title: 'Blinding Lights (Live at Wembley)', artists: ['The Weeknd'], durationMs: 245_000, genres: ['live'], year: 2023, kind: 'live' },
  { id: 'm6', title: 'After Hours', artists: ['The Weeknd'], album: 'After Hours', durationMs: 240_100, genres: ['pop'], year: 2020 },
  { id: 'm7', title: 'Save Your Tears', artists: ['The Weeknd'], album: 'After Hours', durationMs: 215_900, genres: ['pop'], year: 2020 },
  { id: 'm8', title: 'Levitating', artists: ['Dua Lipa'], album: 'Future Nostalgia', durationMs: 203_270, genres: ['pop', 'dance'], year: 2020 },
  { id: 'm9', title: 'Levitating (Remix)', artists: ['Dua Lipa', 'KSI'], durationMs: 232_000, genres: ['remix'], year: 2021, kind: 'remix' },
  { id: 'm10', title: 'Sunset Lover', artists: ['Petit Biscuit'], album: 'Presence', durationMs: 227_400, genres: ['chill', 'electronic'], year: 2016 },
  { id: 'm11', title: 'Intro', artists: ['The xx'], album: 'xx', durationMs: 128_000, genres: ['indie'], year: 2009 },
  { id: 'm12', title: 'Midnight City', artists: ['M83'], album: 'Hurry Up', durationMs: 244_000, genres: ['synthwave', 'electronic'], year: 2011 },
  { id: 'm13', title: 'Nightcall', artists: ['Kavinsky'], album: 'OutRun', durationMs: 258_000, genres: ['synthwave'], year: 2013 },
  { id: 'm14', title: 'Weightless', artists: ['Marconi Union'], durationMs: 484_000, genres: ['ambient', 'meditation'], year: 2012 },
  { id: 'm15', title: 'Bohemian Rhapsody', artists: ['Queen'], album: 'A Night at the Opera', durationMs: 355_000, genres: ['rock', 'classic'], year: 1975 },
  { id: 'm16', title: 'Billie Jean', artists: ['Michael Jackson'], album: 'Thriller', durationMs: 293_400, genres: ['pop', 'funk'], year: 1982 },
  { id: 'm17', title: 'Shape of You', artists: ['Ed Sheeran'], album: 'Divide', durationMs: 233_712, genres: ['pop'], year: 2017 },
  { id: 'm18', title: 'Shape of You (Sped Up)', artists: ['DJ Kaybee'], durationMs: 165_000, genres: ['remix'], year: 2022, kind: 'sped-up' },
  { id: 'm19', title: 'Strobe', artists: ['deadmau5'], album: 'For Lack of a Better Name', durationMs: 631_000, genres: ['electronic', 'progressive'], year: 2009 },
  { id: 'm20', title: 'Lovely Day', artists: ['Bill Withers'], album: 'Menagerie', durationMs: 255_000, genres: ['soul', 'classic'], year: 1977 },
];

/** Stable, readable slug used for artist/album ids in the demo catalogue. */
function slug(value: string): string {
  return normalizeText(value).replace(/\s+/g, '-');
}

const ARTISTS: readonly Artist[] = Array.from(
  new Map<string, Artist>(
    SEED.flatMap((seed) => seed.artists).map((name) => [
      slug(name),
      {
        // Composite ids, matching `Track.id`: the same artist exists on several
        // providers, so detail routes address them as `provider:externalId`.
        id: `${PROVIDER_ID}:artist-${slug(name)}`,
        provider: PROVIDER_ID,
        name,
        externalUrl: `https://example.invalid/${encodeURIComponent(name)}`,
      },
    ]),
  ).values(),
);

const ALBUMS: readonly Album[] = Array.from(
  new Map<string, Album>(
    SEED.flatMap((seed) => (seed.album ? [{ album: seed.album, seed }] : [])).map(
      ({ album, seed }) => [
        slug(album),
        {
          id: `${PROVIDER_ID}:album-${slug(album)}`,
          provider: PROVIDER_ID,
          title: album,
          artistId: `${PROVIDER_ID}:artist-${slug(seed.artists[0] ?? '')}`,
          artistName: seed.artists[0] ?? '',
          year: seed.year,
        },
      ],
    ),
  ).values(),
);

function toTrack(seed: Seed): Track {
  return {
    id: `${PROVIDER_ID}:${seed.id}`,
    provider: PROVIDER_ID,
    externalId: seed.id,
    title: seed.title,
    artistIds: seed.artists.map((name) => `${PROVIDER_ID}:artist-${slug(name)}`),
    artistNames: seed.artists,
    albumId: seed.album ? `${PROVIDER_ID}:album-${slug(seed.album)}` : undefined,
    albumTitle: seed.album,
    durationMs: seed.durationMs,
    externalUrl: `https://example.invalid/watch/${seed.id}`,
    kind: seed.kind ?? detectTrackKind(seed.title),
    genres: seed.genres,
    year: seed.year,
  };
}

const TRACKS: readonly Track[] = SEED.map(toTrack);

/** Looks up by provider-native id, tolerating a composite id being passed in. */
function byExternalId<T extends { id: string }>(items: readonly T[], id: string): T | null {
  return items.find((item) => item.id === id || item.id.endsWith(`:${id}`)) ?? null;
}

export const demoProvider: MusicProvider = {
  id: PROVIDER_ID,
  displayName: 'Demo catalogue',
  description:
    'Offline sample catalogue used to exercise search, dedupe and playback flows before real providers are wired in.',
  capabilities: {
    canStream: false,
    needsResolver: true,
    hasArtwork: false,
    hasArtists: true,
    hasAlbums: true,
    hasRecommendations: true,
    requiresAuth: false,
  },

  isEnabled: () => true,

  async search({ query, limit = 25, kinds, offset = 0 }: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const queryTokens = tokenize(query);
    const queryNormalized = normalizeText(query);

    const scored = TRACKS.map((track) => {
      const titleTokens = tokenize(track.title);
      const artistTokens = tokenize(track.artistNames.join(' '));
      const score =
        tokenSimilarity(queryTokens, titleTokens) * 2 +
        tokenSimilarity(queryTokens, artistTokens) +
        (normalizeText(track.title).includes(queryNormalized) ? 1.5 : 0);
      return { track, score };
    })
      .filter((entry) => entry.score > 0)
      .filter((entry) => (kinds ? kinds.includes(entry.track.kind) : true))
      .sort((a, b) => b.score - a.score);

    // Goes through the shared boundary validator even though this data is
    // already trusted, so the demo provider fails the same way a broken network
    // provider would instead of hiding a mistake in the pipeline.
    return parseProviderSearchPayload({
      tracks: scored.slice(offset, offset + limit).map((entry) => entry.track),
      artists: ARTISTS.filter(
        (artist) => tokenSimilarity(queryTokens, tokenize(artist.name)) > 0.5,
      ).slice(0, 10),
      albums: ALBUMS.filter(
        (album) =>
          tokenSimilarity(queryTokens, tokenize(album.title)) > 0.5 ||
          tokenSimilarity(queryTokens, tokenize(album.artistName)) > 0.5,
      ).slice(0, 10),
    });
  },

  async getTrack(externalId: string) {
    return byExternalId(TRACKS, externalId);
  },

  async getArtist(externalId: string) {
    return byExternalId(ARTISTS, externalId);
  },

  async getAlbum(externalId: string) {
    return byExternalId(ALBUMS, externalId);
  },

  async getRecommendations(seed?: RecommendationSeed): Promise<readonly Recommendation[]> {
    if (seed?.artistNames?.length) {
      const wanted = seed.artistNames.map((name) => normalizeText(name));
      const tracks = TRACKS.filter((track) =>
        track.artistNames.some((name) => wanted.includes(normalizeText(name))),
      ).slice(0, 10);
      return [
        {
          id: `${PROVIDER_ID}-more-from-artist`,
          title: 'More from this artist',
          tracks: tracks.map<SearchResult>((track) => ({ track, score: 1 })),
          provider: PROVIDER_ID,
        },
      ];
    }

    const tracks = TRACKS.filter((track) => track.kind === 'song').slice(0, 10);
    return [
      {
        id: `${PROVIDER_ID}-discover`,
        title: 'Discover something new',
        tracks: tracks.map<SearchResult>((track) => ({ track, score: 1 })),
        provider: PROVIDER_ID,
      },
    ];
  },
};