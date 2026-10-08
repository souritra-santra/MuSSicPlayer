/**
 * Artwork loading policy.
 *
 * `expo-image` handles decoding off the JS thread, but its caches are
 * unbounded by default. On a music app where every row shows artwork, that is
 * the fastest way to fill a user's storage, so cache use is kept deliberate:
 * per-surface `cachePolicy`, a request size close to what is displayed, and a
 * user-facing purge.
 */

import { Platform } from 'react-native';
import { Image, type ImageProps } from 'expo-image';

/**
 * Cache policy per surface.
 *
 * - `memory-disk`: artwork the user is actively scrolling past. Cached in the
 *   memory cache (fast, no flash) and on disk (survives a cold start).
 * - `disk`: full-screen artwork (Now Playing) where memory pressure matters but
 *   the image is viewed repeatedly.
 * - `none`: tiny placeholder glyphs that are cheaper to redraw than to cache.
 */
export type ArtworkCachePolicy = 'memory-disk' | 'disk' | 'none';

const CACHE_POLICY: Record<ArtworkCachePolicy, ImageProps['cachePolicy']> = {
  'memory-disk': 'memory-disk',
  disk: 'disk',
  none: 'none',
};

export function artworkCachePolicy(policy: ArtworkCachePolicy): ImageProps['cachePolicy'] {
  return CACHE_POLICY[policy];
}

/**
 * Cache ceilings, in bytes. **iOS only.**
 *
 * `Image.configureCache()` and `ImageCacheConfig` are documented as "Supported
 * platforms: iOS" in the SDK 57 expo-image reference, and `ExpoImageModule.kt`
 * declares no `configureCache` function — Android runs Glide, which sizes its
 * own caches natively and exposes no JS knob. Calling it on Android throws
 * `undefined is not a function`, hence the guard.
 *
 * The disk figure caps total artwork (every search caches ~40 thumbnails); the
 * memory figure is a *cost* budget rather than a byte count, which is what
 * `expo-image` uses to decide what to evict first under pressure. Artwork is
 * expendable, so it should be the first thing dropped — hence a modest memory
 * budget and a generous disk one.
 */
export const ARTWORK_DISK_CACHE_BYTES = 256 * 1024 * 1024;
export const ARTWORK_MEMORY_COST_BYTES = 48 * 1024 * 1024;

/** True when this platform can be given an explicit artwork cache ceiling. */
export const canConfigureArtworkCache = Platform.OS === 'ios';

/**
 * Applies the ceilings above where they are supported. Safe to call more than
 * once, and a no-op on Android — see {@link canConfigureArtworkCache}.
 */
export function configureArtworkCache(): void {
  if (!canConfigureArtworkCache) return;
  Image.configureCache({
    maxDiskSize: ARTWORK_DISK_CACHE_BYTES,
    maxMemoryCost: ARTWORK_MEMORY_COST_BYTES,
  });
}

/**
 * Empties both artwork caches.
 *
 * Supported on Android and iOS, so this is the portable way to reclaim artwork
 * storage — the user-facing control that stands in for the iOS-only ceiling.
 */
export async function clearArtworkCaches(): Promise<void> {
  await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]);
}

/**
 * Providers serve artwork at several widths; requesting a size close to what is
 * displayed avoids downloading 1000px images into 48px slots, which is pure
 * memory waste on a list screen.
 */
export function artworkSizeFor(context: 'row' | 'card' | 'hero'): { width: number; height: number } {
  switch (context) {
    case 'row':
      return { width: 96, height: 96 };
    case 'card':
      return { width: 160, height: 160 };
    case 'hero':
      return { width: 512, height: 512 };
  }
}

/** Deterministic accent colour derived from a track id, for missing artwork. */
export function placeholderColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const palette = ['#2A2A38', '#3A2A4B', '#1F3340', '#3B2A2A', '#243A2F', '#332A45'];
  return palette[hash % palette.length];
}