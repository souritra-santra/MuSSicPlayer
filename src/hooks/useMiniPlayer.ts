import { useSegments } from 'expo-router';

/**
 * Mini-player visibility and positioning.
 *
 * The dock lives in the root layout so it survives tab changes and modal
 * pushes. Route matching decides both *whether* it shows and *where* it sits:
 * on tab screens it floats above the tab bar, on detail screens it floats just
 * above the system inset. Getting this wrong by a fixed offset is the classic
 * bug where the dock covers the last row of a list, so it is derived from
 * layout constants instead of a magic number.
 */

/** Routes that render their own transport controls. */
const HIDDEN_ROUTES: readonly string[] = ['/now-playing'];

/** Height of the mini player dock itself, excluding any system inset. */
export const MINI_PLAYER_HEIGHT = 60;

/** Mirrors `TAB_BAR_TOTAL_HEIGHT` in `src/app/(tabs)/_layout.tsx`. */
const TAB_BAR_TOTAL_HEIGHT = 58;

/**
 * True when the mini player should be on screen for the current route.
 * Non-tab routes (details, settings) keep the dock visible so playback controls
 * remain reachable while browsing a playlist or an album.
 */
export function useNowPlayingVisibility(): boolean {
  const segments = useSegments();
  const [route] = segments;

  if (route === 'now-playing') return false;

  // `settings` and the detail routes are full-height screens; the dock still
  // applies there, so only the screen that *is* the player hides it.
  return !HIDDEN_ROUTES.includes(`/${route}`);
}

/**
 * Distance from the bottom of the window to the top of the dock.
 * `bottomInset` should come from `useSafeAreaInsets()`.
 */
export function useMiniPlayerOffset(bottomInset: number, gap = 8): number {
  const segments = useSegments();
  const [route] = segments;
  // Inside the tab navigator the bar occupies the bottom; outside it does not.
  const base = route === '(tabs)' ? TAB_BAR_TOTAL_HEIGHT : 0;
  return bottomInset + base + gap;
}

/**
 * Bottom content padding for a scroll view inside the tab navigator.
 *
 * Accounts for the tab bar *and* the mini player dock, so the last row of a
 * list is always reachable. Screens use this instead of a hard-coded number.
 */
export const MINIPLAYER_BOTTOM_PADDING = TAB_BAR_TOTAL_HEIGHT + MINI_PLAYER_HEIGHT + 24;