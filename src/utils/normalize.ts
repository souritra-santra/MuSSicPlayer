/**
 * String normalization used for search, dedupe and ranking.
 *
 * Providers disagree wildly about formatting: "Blinding Lights", "Blinding
 * Lights - The Afterhours", "(Official Video)", "Blinding Lights (Live)",
 * "BLINDING  LIGHTS!!!". Everything downstream (fuzzy matching, the
 * `tracks_fts` index, cross-provider duplicate detection) relies on these
 * helpers producing a single canonical form, so they are intentionally
 * aggressive and shared by every layer.
 */

import type { TrackKind } from '@/types';

/** Noise words that carry no identity information. */
const NOISE_TOKENS = new Set([
  'official',
  'officialvideo',
  'officialaudio',
  'videoclip',
  'audio',
  'video',
  'lyric',
  'lyrics',
  'lyricvideo',
  'hd',
  'hq',
  'mv',
  'm/v',
  'visualizer',
  'visualiser',
  'full',
  'fullsong',
  'song',
  'music',
  'audioonly',
  'free',
  'download',
  'hd1080p',
  '1080p',
  '720p',
  '4k',
  'remastered',
  'explicit',
  'clean',
  'colorcodedlyrics',
  'withlyrics',
]);

/**
 * Tokens that indicate a variant rather than the canonical recording.
 *
 * Order matters: the first match wins, so specific markers (`acoustic`) are
 * listed before broad ones (`remix`) and slowdowns are checked before the
 * catch-all remix bucket.
 */
const VERSION_TOKENS: readonly [RegExp, TrackKind][] = [
  [/\bsped\s?up\b|\bnightcore\b/, 'sped-up'],
  [/\bslowed\b|\breverb\b|\bnightcore\b/, 'slowed'],
  [/\bdj\s?mix\b|\bmegamix\b|\bclub\s?mix\b|\bedit\b|\bextended\b/, 'dj-mix'],
  [/\bkaraoke\b/, 'karaoke'],
  [/\binstrumental\b|\bminus\s?one\b|\bno\s?vocals\b/, 'instrumental'],
  [/\bcover(ed)?\b|\bin\s+the\s+style\s+of\b/, 'cover'],
  [/\bacoustic\b|\bunofficial\b/, 'acoustic'],
  [/\blive\b|\bconcert\b|\bunplugged\b|\bacoustic\s+session\b/, 'live'],
  [/\bremix(ed)?\b|\bbootleg\b|\bmashup\b|\bflip\b/, 'remix'],
];

const DIACRITICS = /[\u0300-\u036f]/g;
const NON_ALNUM = /[^a-z0-9]+/g;

/**
 * Lowercases, strips diacritics and collapses punctuation to single spaces.
 * Unicode-aware so non-Latin titles still normalize to something usable.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(NON_ALNUM, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalized form used for the `norm_title` column and FTS indexing. */
export function normalizeTitle(title: string): string {
  return normalizeText(title);
}

/** Normalized form used for the `norm_artist` column. */
export function normalizeArtist(...artistNames: readonly string[]): string {
  return normalizeText(artistNames.filter(Boolean).join(' '));
}

export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/** Drops bracketed/parenthesised noise such as "(Official Video)" or "[4K]". */
export function stripNoiseBrackets(title: string): string {
  return title
    .replace(/[\(\[][^\)\]]*[\)\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classifies a title into a `TrackKind` using the version keywords. */
export function detectTrackKind(title: string): TrackKind {
  const flat = normalizeText(stripNoiseBrackets(title)).replace(/ /g, '');
  for (const [pattern, kind] of VERSION_TOKENS) {
    if (pattern.test(flat)) return kind;
  }
  return 'unknown';
}

/** Removes noise tokens from a token list, preserving order. */
export function significantTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => !NOISE_TOKENS.has(token) && token.length > 1);
}

/**
 * Token-level similarity in [0, 1] using multiset overlap (Dice coefficient over
 * token bags). Chosen over Levenshtein because token order and partial words
 * ("blinding lights" vs "lights blinding") should not tank the score, and it is
 * far cheaper than an edit-distance pass across hundreds of candidates.
 */
export function tokenSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const token of a) pool.set(token, (pool.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of b) {
    const count = pool.get(token) ?? 0;
    if (count > 0) {
      pool.set(token, count - 1);
      overlap += 1;
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

/**
 * Approximate edit distance, used to catch typos ("blidning lights") that token
 * overlap misses. Bails out early once `max` is exceeded so ranking stays cheap.
 */
/** Best-effort domain-aware spelling correction for short queries. */
const CORRECTIONS: Readonly<Record<string, string>> = {
  remix: 'remix',
  remixes: 'remix',
  remixx: 'remix',
  covr: 'cover',
  cove: 'cover',
  instrmental: 'instrumental',
  instrumetal: 'instrumental',
  acousticc: 'acoustic',
  spotify: '',
  yt: '',
};

/**
 * Best-effort domain-aware spelling correction.
 *
 * Deliberately conservative: it only rewrites tokens it recognises as a
 * misspelling or as platform noise, and drops those entirely. An empty result
 * is returned unchanged so a query of only noise words still searches.
 */
export function correctSpelling(query: string): string {
  const corrected = tokenize(query)
    .map((token) => (token in CORRECTIONS ? CORRECTIONS[token] : token))
    .filter(Boolean)
    .join(' ');
  return corrected.length > 0 ? corrected : query.trim();
}