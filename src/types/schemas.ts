/**
 * Zod schemas used to validate third-party provider payloads at the boundary.
 *
 * Providers are unreliable: YouTube changes response shapes without notice and
 * community endpoints change JSON structure freely. Validating with a schema
 * means a malformed payload fails one provider's slice of the search instead of
 * crashing the app or writing junk into SQLite.
 */

import { z } from 'zod';

import { TRACK_KINDS } from './models';

/** Provider payloads are untrusted: allow nulls/empties, coerce loosely. */
const trimmed = z.string().trim();
const optionalUrl = trimmed.nullish().transform((v) => (v ? v : undefined));
const optionalNumber = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  });

export const trackKindSchema = z.enum(TRACK_KINDS);

export const artistSchema = z.object({
  id: trimmed.min(1),
  provider: trimmed.min(1),
  name: trimmed.min(1),
  artworkUrl: optionalUrl,
  externalUrl: optionalUrl,
  followers: optionalNumber,
});

export const albumSchema = z.object({
  id: trimmed.min(1),
  provider: trimmed.min(1),
  title: trimmed.min(1),
  artistId: trimmed.optional(),
  artistName: trimmed.default(''),
  artworkUrl: optionalUrl,
  externalUrl: optionalUrl,
  year: optionalNumber,
});

export const trackSchema = z.object({
  id: trimmed.min(1),
  provider: trimmed.min(1),
  externalId: trimmed.min(1),
  title: trimmed.min(1),
  artistIds: z.array(trimmed).default([]),
  artistNames: z.array(trimmed).default([]),
  albumId: trimmed.optional(),
  albumTitle: trimmed.optional(),
  durationMs: optionalNumber,
  artworkUrl: optionalUrl,
  externalUrl: optionalUrl,
  streamUrl: optionalUrl,
  isrc: trimmed.optional(),
  kind: trackKindSchema.default('unknown'),
  genres: z.array(trimmed).default([]),
  year: optionalNumber,
  explicit: z
    .union([z.boolean(), z.number(), z.string()])
    .nullish()
    .transform((v) => v === true || v === 1 || v === '1' || v === 'true'),
});

/** What a provider is allowed to return from `search()`. */
export const providerSearchPayloadSchema = z.object({
  tracks: z.array(trackSchema).default([]),
  artists: z.array(artistSchema).default([]),
  albums: z.array(albumSchema).default([]),
});

/**
 * What a validated `search()` payload contains.
 *
 * A provider author can type a raw fixture or fixture-adapter against
 * `z.input<typeof trackSchema>` (and the artist/album equivalents) — those allow
 * the loose forms above (`null` durations, stringified numbers, missing
 * explicit flags) that real APIs actually return.
 */
export type ProviderSearchPayload = z.output<typeof providerSearchPayloadSchema>;