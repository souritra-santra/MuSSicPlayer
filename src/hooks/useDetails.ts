import { useMemo } from 'react';

import type { Album, Artist, Track } from '@/types';
import {
  getAlbumByProviderId,
  getArtistByProviderId,
  searchLocalTracks,
  type Database,
} from '@/services/database';
import { normalizeText } from '@/utils/normalize';

import { useDatabaseLoader } from '@/hooks/useDatabase';

/**
 * Detail-screen data loading.
 *
 * Route params carry composite ids (`provider:externalId`) because the same
 * artist or album exists on several sources. Everything is resolved from the
 * local cache — the provider fetch is deferred to the request that populates
 * it, so opening a detail page never blocks on the network.
 */

/** Splits a composite `provider:externalId` route param. */
export function splitCompositeId(id: string): { provider: string; externalId: string } {
  const separator = id.indexOf(':');
  if (separator < 0) return { provider: '', externalId: id };
  return { provider: id.slice(0, separator), externalId: id.slice(separator + 1) };
}

export type ArtistDetail = {
  readonly artist: Artist | null;
  /** Cached tracks by this artist. */
  readonly tracks: readonly Track[];
};

export function useArtistDetail(id: string) {
  const composite = useMemo(() => splitCompositeId(id), [id]);

  return useDatabaseLoader<ArtistDetail>(
    async (db: Database) => {
      const artist = await getArtistByProviderId(db, composite.provider, composite.externalId);
      const name = artist?.name;
      if (!name) return { artist: null, tracks: [] };

      // The local index is keyed on the normalized artist name, so a cached
      // search for the artist is the cheapest way to find their tracks.
      const candidates = await searchLocalTracks(db, normalizeText(name), 50);
      const target = normalizeText(name);
      const tracks = candidates.filter((track) =>
        track.artistNames.some((value) => normalizeText(value) === target),
      );

      return { artist, tracks };
    },
    [composite.provider, composite.externalId],
  );
}

export type AlbumDetail = {
  readonly album: Album | null;
  readonly tracks: readonly Track[];
};

export function useAlbumDetail(id: string) {
  const composite = useMemo(() => splitCompositeId(id), [id]);

  return useDatabaseLoader<AlbumDetail>(
    async (db: Database) => {
      const album = await getAlbumByProviderId(db, composite.provider, composite.externalId);
      if (!album) return { album: null, tracks: [] };

      const candidates = await searchLocalTracks(db, normalizeText(album.title), 50);
      const target = album.id;
      const tracks = candidates.filter((track) => track.albumId === target);

      return { album, tracks };
    },
    [composite.provider, composite.externalId],
  );
}