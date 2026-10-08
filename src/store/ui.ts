import { create } from 'zustand';

/**
 * Transient UI state that does not survive a restart.
 *
 * Deliberately not persisted: a stale "is offline" flag or a snackbar left over
 * from last session is worse than recomputing it.
 */

export type ToastTone = 'info' | 'success' | 'error';

export type UiState = {
  /** Last known connectivity from `@react-native-community/netinfo`. */
  isOnline: boolean;
  /** True while the OS reports a metered/constrained connection. */
  isConstrained: boolean;
  /** Docked above the tab bar; hidden on screens with their own player. */
  miniPlayerVisible: boolean;
  /** Set by mutations that need a confirmation (e.g. "Added to Favourites"). */
  toast?: { message: string; tone: ToastTone; id: number };
};

export type UiActions = {
  setConnectivity: (online: boolean, constrained: boolean) => void;
  hideMiniPlayer: () => void;
  showMiniPlayer: () => void;
  showToast: (message: string, tone?: ToastTone) => void;
  clearToast: () => void;
};

export const useUiStore = create<UiState & UiActions>((set) => ({
  // Assume online until proven otherwise: showing a false "You're offline"
  // banner on a working connection is the worse failure mode.
  isOnline: true,
  isConstrained: false,
  miniPlayerVisible: true,
  toast: undefined,

  setConnectivity: (isOnline, isConstrained) => set({ isOnline, isConstrained }),
  hideMiniPlayer: () => set({ miniPlayerVisible: false }),
  showMiniPlayer: () => set({ miniPlayerVisible: true }),
  showToast: (message, tone = 'info') =>
    set({ toast: { message, tone, id: Date.now() } }),
  clearToast: () => set({ toast: undefined }),
}));