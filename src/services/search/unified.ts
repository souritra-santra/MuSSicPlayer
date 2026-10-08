import type {
  Album,
  Artist,
  SearchResult,
  SearchSection,
  SearchSectionId,
  Track,
  UnifiedSearchResults,
} from '@/types';
import { searchAllProviders } from '@/services/providers/registry';
import type { MusicProvider } from '@/services/providers/types';
import { uniq } from '@/utils/common';

import { dedupeExactKeys, dedupeResults, trimAlternates } from './dedupe';
import { rankTracks } from './rank';

/**
 * Unified search.
 *
 * Fans out to every enabled provider, normalizes everything into `SearchResult`s,
 * collapses cross-provider duplicates (keeping alternates), ranks, then slices
 * into the sections instruction.md asks for: best match, songs, artists, albums,
 * remixes, similar and "other sources".
 */

export type UnifiedSearchOptions = {
  readonly limit?: number;
  readonly providers?: readonly MusicProvider[];
  /** Restrict to certain track kinds across all sources. */
  readonly kinds?: readonly Track['kind'][];
  /** Ranked play counts per track id, from the local `play_stats` table. */
  readonly familiarity?: ReadonlyMap<string, number>;
  /** Include remix/cover/live variants in the top sections. */
  readonly preferVariants?: boolean;
  /** Skip the local SQLite cache (used by cache-busting pulls to refresh). */
  readonly skipLocal?: boolean;
};

const SECTION_LIMIT = 20;

/** Track kinds that belong in the "Remixes & Versions" shelf. */
const VARIANT_KINDS: readonly Track['kind'][] = [
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
];

/** Collects provider hits into one flat, de-duped pool. */
function collectCandidateTracks(
  results: ReadonlyMap<string, { tracks: readonly Track[] }>,
): Track[] {
  const all: Track[] = [];
  for (const payload of results.values()) all.push(...payload.tracks);
  return all;
}

export type UnifiedSearchInput = {
  readonly query: string;
  readonly options?: UnifiedSearchOptions;
};

/**
 * Runs the full pipeline. Provider failures are reported in
 * `failedProviders` rather than thrown, so the UI can render partial results
 * plus a warning.
 */
export async function unifiedSearch({
  query,
  options = {},
}: UnifiedSearchInput): Promise<UnifiedSearchResults> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { query, sections: [], failedProviders: [], tookMs: 0 };
  }

  const startedAt = Date.now();
  const limit = options.limit ?? SECTION_LIMIT;

  const fanOut = await searchAllProviders(
    { query: trimmed, limit, kinds: options.kinds },
    { providers: options.providers },
  );

  const candidates = collectCandidateTracks(fanOut.results);
  const scored = rankTracks(candidates, {
    query: trimmed,
    familiarity: options.familiarity,
    preferVariants: options.preferVariants,
  });

  // Collapse the same recording found on several providers, keeping the best
  // scoring one plus its alternates.
  const deduped = trimAlternates(dedupeResults(dedupeExactKeys(scored)));
  const ordered = deduped.sort((a, b) => b.score - a.score);

  const sections = buildSections({
    ordered,
    artists: collectArtists(fanOut.results),
    albums: collectAlbums(fanOut.results),
  });

  return {
    query: trimmed,
    sections,
    failedProviders: fanOut.failures.map((failure) => failure.provider),
    tookMs: Date.now() - startedAt,
  };
}

function collectArtists(
  results: ReadonlyMap<string, { artists: readonly Artist[] }>,
): Artist[] {
  const seen = new Map<string, Artist>();
  for (const payload of results.values()) {
    for (const artist of payload.artists) {
      const key = `${artist.provider}:${artist.id}`;
      if (!seen.has(key)) seen.set(key, artist);
    }
  }
  return Array.from(seen.values());
}

function collectAlbums(
  results: ReadonlyMap<string, { albums: readonly Album[] }>,
): Album[] {
  const seen = new Map<string, Album>();
  for (const payload of results.values()) {
    for (const album of payload.albums) {
      const key = `${album.provider}:${album.id}`;
      if (!seen.has(key)) seen.set(key, album);
    }
  }
  return Array.from(seen.values());
}

/**
 * Slices the ranked pool into display sections.
 *
 * "Songs" holds canonical recordings only; variants go to their own shelf so a
 * query for a song does not open with six remixes.
 */
export function buildSections(input: {
  ordered: readonly SearchResult[];
  artists: readonly Artist[];
  albums: readonly Album[];
}): SearchSection[] {
  const { ordered, artists, albums } = input;

  const canonical = ordered.filter((entry) => entry.track.kind === 'song' || entry.track.kind === 'unknown');
  const variants = ordered.filter((entry) => VARIANT_KINDS.includes(entry.track.kind));

  const sections: SearchSection[] = [];

  const bestMatch = ordered.slice(0, 3);
  if (bestMatch.length > 0) {
    sections.push({ id: 'best-match', title: 'Best match', tracks: bestMatch });
  }

  if (canonical.length > 0) {
    sections.push({
      id: 'songs',
      title: 'Songs',
      tracks: canonical.slice(0, SECTION_LIMIT),
    });
  }

  if (variants.length > 0) {
    sections.push({
      id: 'remixes',
      title: 'Remixes, Covers & Versions',
      tracks: variants.slice(0, SECTION_LIMIT),
    });
  }

  if (artists.length > 0) {
    sections.push({
      id: 'artists',
      title: 'Artists',
      // `tracks` is required by the section shape; artists carry no tracks here.
      tracks: [],
      artists: artists.slice(0, 10),
    });
  }

  if (albums.length > 0) {
    sections.push({
      id: 'albums',
      title: 'Albums',
      tracks: [],
      albums: albums.slice(0, 10),
    });
  }

  const withAlternates = ordered.filter((entry) => (entry.alternates?.length ?? 0) > 0);
  if (withAlternates.length > 0) {
    sections.push({
      id: 'other-sources',
      title: 'Available on other sources',
      tracks: withAlternates.slice(0, SECTION_LIMIT),
    });
  }

  return sections;
}

/** Providers that contributed at least one track to the results. */
export function contributorsOf(results: readonly SearchResult[]): string[] {
  return uniq(
    results.flatMap((entry) => [
      entry.track.provider,
      ...(entry.alternates?.map((alternate) => alternate.provider) ?? []),
    ]),
  );
}

/** Convenience: search restricted to a single track kind (search filters). */
export function searchOfKind(
  query: string,
  kind: Track['kind'],
  options: UnifiedSearchOptions = {},
): Promise<UnifiedSearchResults> {
  return unifiedSearch({ query, options: { ...options, kinds: [kind] } });
}

export type { SearchSectionId };