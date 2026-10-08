import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ResolverConfig } from '@/services/player/resolver';

import {
  getItemSync,
  removeItemSync,
  setItemSync,
} from '@/services/database/repositories/kv';

/**
 * User settings, persisted to the SQLite kv table.
 *
 * Uses `expo-sqlite/kv-store`'s synchronous API as the `persist` storage: it is
 * already a dependency of the data layer, avoids pulling in another native
 * storage module, and — crucially — exposes sync accessors so the first render
 * after a cold start already has the user's preferences (a resolver URL must be
 * known before the first play attempt).
 */

export type RepeatMode = 'off' | 'all' | 'one';

export type SettingsState = {
  /** User-supplied cobalt-compatible resolver base URL ('' when unset). */
  resolverEndpoint: string;
  /** Optional token for resolvers that require one. */
  resolverApiKey: string;
  /** Preferred stream quality. */
  resolverQuality: 'best' | '128' | '96' | '64';

  /** Provider ids the user has switched off. */
  disabledProviders: string[];

  /** Continue to the next track when one finishes. */
  autoplay: boolean;
  /** Hide results marked explicit. */
  excludeExplicit: boolean;
  /** Crossfade duration in ms (0 disables). */
  crossfadeMs: number;
  /** Skip to the next track after this many ms (0 disables). */
  skipSilenceThresholdMs: number;

  /** Cache catalogue rows and search history beyond the default retention. */
  cacheSearchResults: boolean;
  /** Preload the next track's audio. */
  preloadNext: boolean;

  /** Bumped whenever settings change so dependent queries can refetch. */
  revision: number;
};

export type SettingsActions = {
  setResolverEndpoint: (value: string) => void;
  setResolverApiKey: (value: string) => void;
  setResolverQuality: (value: SettingsState['resolverQuality']) => void;
  toggleProvider: (providerId: string) => void;
  setAutoplay: (value: boolean) => void;
  setExcludeExplicit: (value: boolean) => void;
  setCrossfadeMs: (value: number) => void;
  setCacheSearchResults: (value: boolean) => void;
  setPreloadNext: (value: boolean) => void;
  resetSettings: () => void;
};

export const SETTINGS_STORAGE_KEY = 'settings.v1';

export const defaultSettings: SettingsState = {
  resolverEndpoint: '',
  resolverApiKey: '',
  resolverQuality: '128',
  disabledProviders: [],
  autoplay: true,
  excludeExplicit: false,
  crossfadeMs: 0,
  skipSilenceThresholdMs: 0,
  cacheSearchResults: true,
  preloadNext: true,
  revision: 0,
};

const syncStorage = createJSONStorage<SettingsState>(() => ({
  getItem: (name) => getItemSync(name),
  setItem: (name, value) => setItemSync(name, value),
  removeItem: (name) => removeItemSync(name),
}));

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setResolverEndpoint: (value) =>
        set((state) => ({
          resolverEndpoint: value.trim(),
          revision: state.revision + 1,
        })),
      setResolverApiKey: (value) =>
        set((state) => ({ resolverApiKey: value.trim(), revision: state.revision + 1 })),
      setResolverQuality: (value) =>
        set((state) => ({ resolverQuality: value, revision: state.revision + 1 })),
      toggleProvider: (providerId) =>
        set((state) => {
          const disabled = state.disabledProviders.includes(providerId)
            ? state.disabledProviders.filter((id) => id !== providerId)
            : [...state.disabledProviders, providerId];
          return { disabledProviders: disabled, revision: state.revision + 1 };
        }),
      setAutoplay: (value) => set({ autoplay: value }),
      setExcludeExplicit: (value) =>
        set((state) => ({ excludeExplicit: value, revision: state.revision + 1 })),
      setCrossfadeMs: (value) =>
        set((state) => ({ crossfadeMs: Math.max(0, Math.round(value)), revision: state.revision + 1 })),
      setCacheSearchResults: (value) => set({ cacheSearchResults: value }),
      setPreloadNext: (value) => set({ preloadNext: value }),
      resetSettings: () => set({ ...defaultSettings, revision: Date.now() }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: syncStorage,
      // Hydration is deferred: the kv-store opens lazily, so reading it at
      // module load would silently fall back to defaults and lose the user's
      // settings. `src/app/_layout.tsx` calls `persist.rehydrate()` once the
      // database is ready — still before the splash screen is dismissed.
      skipHydration: true,
      partialize: (state) => ({
        resolverEndpoint: state.resolverEndpoint,
        resolverApiKey: state.resolverApiKey,
        resolverQuality: state.resolverQuality,
        disabledProviders: state.disabledProviders,
        autoplay: state.autoplay,
        excludeExplicit: state.excludeExplicit,
        crossfadeMs: state.crossfadeMs,
        skipSilenceThresholdMs: state.skipSilenceThresholdMs,
        cacheSearchResults: state.cacheSearchResults,
        preloadNext: state.preloadNext,
        revision: state.revision,
      }),
    },
  ),
);

/**
 * Resolver config in the shape `services/player/resolver.ts` expects, or `null`
 * when no endpoint has been configured.
 *
 * Returning `null` rather than an empty-string endpoint is what lets the UI say
 * "not configured" without re-deriving that rule at each call site.
 */
export function selectResolverConfig(state: SettingsState): ResolverConfig | null {
  if (state.resolverEndpoint.length === 0) return null;
  return {
    endpoint: state.resolverEndpoint,
    apiKey: state.resolverApiKey.length > 0 ? state.resolverApiKey : undefined,
    quality: state.resolverQuality,
  };
}