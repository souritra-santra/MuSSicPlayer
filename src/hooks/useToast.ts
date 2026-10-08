import { useCallback, useEffect, useRef } from 'react';

import { useUiStore } from '@/store/ui';

/**
 * Transient confirmations ("Added to queue", "Hidden by settings").
 *
 * Driven from a store rather than per-screen state so a mutation in a
 * repository hook can report success without prop-drilling a toast through the
 * tree.
 */

export type ToastTone = 'info' | 'success' | 'error';

const DEFAULT_DURATION_MS = 2200;

export function useToast() {
  const toast = useUiStore((state) => state.toast);
  const showToast = useUiStore((state) => state.showToast);
  const clearToast = useUiStore((state) => state.clearToast);

  const show = useCallback(
    (message: string, tone: ToastTone = 'info', durationMs = DEFAULT_DURATION_MS) => {
      showToast(message, tone);
      return message;
    },
    [showToast],
  );

  return { toast, show, clear: clearToast };
}

/**
 * Auto-dismisses the toast. Mounted once (in the root layout) so timers are not
 * tied to any particular screen.
 */
export function useToastTimer(durationMs = DEFAULT_DURATION_MS) {
  const toast = useUiStore((state) => state.toast);
  const clearToast = useUiStore((state) => state.clearToast);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!toast) {
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(clearToast, durationMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, clearToast, durationMs]);
}