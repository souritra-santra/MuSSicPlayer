import { useEffect, useRef, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { useUiStore } from '@/store/ui';

/**
 * Connectivity tracking.
 *
 * Feeds the offline banner and lets screens skip network work when the device
 * is known to be offline, instead of waiting for a socket timeout.
 */

export type Connectivity = {
  readonly isOnline: boolean;
  /** True on cellular with `isConnectionExpensive`. */
  readonly isConstrained: boolean;
  readonly type: string;
  /** True only during the first probe, before NetInfo has reported. */
  readonly isProbing: boolean;
};

function toConnectivity(state: NetInfoState): Connectivity {
  const type = state.type;
  const reachable = state.isInternetReachable;
  // `isInternetReachable` is null while probing; treat unknown as online so we
  // never flash a false offline banner.
  const isOnline = reachable ?? true;
  // `details` is null until the first successful probe, and its shape is
  // connection-type specific, so both are narrowed defensively.
  const details = state.details as { isConnectionExpensive?: boolean } | null;
  const isConstrained = type === 'cellular' && details?.isConnectionExpensive === true;
  return {
    isOnline,
    isConstrained,
    type,
    isProbing: reachable === null,
  };
}

export function useConnectivity(): Connectivity {
  const [connectivity, setConnectivity] = useState<Connectivity>(() => ({
    isOnline: true,
    isConstrained: false,
    type: 'unknown',
    isProbing: true,
  }));
  const setStoreConnectivity = useUiStore((state) => state.setConnectivity);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    // Connectivity is a nicety, not a dependency: if the native listener cannot
    // be attached the app must still start, treating the device as online until
    // a request actually fails.
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = NetInfo.addEventListener((state) => {
        if (!mounted.current) return;
        const next = toConnectivity(state);
        setConnectivity(next);
        setStoreConnectivity(next.isOnline, next.isConstrained);
      });
    } catch (error) {
      console.warn('[connectivity] listener unavailable', error);
    }

    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
  }, [setStoreConnectivity]);

  return connectivity;
}