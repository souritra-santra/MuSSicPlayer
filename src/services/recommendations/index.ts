/**
 * On-device recommendation engine.
 *
 * Instruction.md's "Recommendations should work **without a backend** using
 * locally stored user behavior" — everything here reads the local rollups and
 * catalogue, and the only network call (provider trending) is optional, cached,
 * and bounded by a timeout.
 */

export { buildUserProfile, type UserProfile } from './profile';
export { scoreTrackForProfile, trackSimilarity, RECOMMENDATION_WEIGHTS } from './score';
export {
  buildLocalRecommendations,
  relatedToTrack,
  type LocalRecommendations,
  type RecommendedShelf,
} from './shelves';
export {
  fetchTrendingShelves,
  TRENDING_CACHE_KEY,
  TRENDING_LIMIT,
  TRENDING_TIMEOUT_MS,
  TRENDING_TTL_MS,
} from './trending';