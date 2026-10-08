/**
 * Search service barrel.
 *
 * Screens import from `@/services/search`; the individual pipeline stages stay
 * internal so the orchestration can be restructured without touching UI.
 */

export { dedupeExactKeys, dedupeResults, trimAlternates } from './dedupe';
export { isSameRecording, rankTracks, scoreTrack, signatureOf, WEIGHTS } from './rank';
export {
  buildSections,
  contributorsOf,
  searchOfKind,
  unifiedSearch,
  type UnifiedSearchInput,
  type UnifiedSearchOptions,
} from './unified';