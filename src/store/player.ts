import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  getItemSync,
  removeItemSync,
  setItemSync,
} from '@/services/database/repositories/kv';
import type {
  PlayContext,
  PlaybackState,
  PlaybackStatus,
  QueueItem,
  RepeatMode,
} from '@/types';
import { queueKey } from '@/utils/common';

/**
 * Player state.
 *
 * The queue model and playback *intent* (what should be playing, in what
 * order, with which repeat/shuffle settings) live here; the audio engine in
 * `services/player/engine.ts` subscribes to this store and mirrors intent into
 * a single native `expo-audio` player. Status fields (`playback`, `errorMessage`)
 * are written back by the engine, so the UI never has to guess what the native
 * player is doing.
 */

export type PlayerState = {
  /** Ordered playback queue. */
  queue: QueueItem[];
  /** Index into `queue` of the current item. */
  currentIndex: number;
  /** Playback intent, persisted so the queue survives a cold start. */
  lastPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Original (pre-shuffle) order, kept so toggling shuffle is reversible. */
  unshuffledOrder: QueueItem[];
  playback: PlaybackState;
  /** Set when playback fails, surfaced by the mini player. */
  errorMessage?: string;
  /**
   * Bumped whenever the *intent* of "what should be playing" changes wholesale
   * (a new queue, a jump). The engine compares this alongside the current track
   * id so re-queueing the same track restarts it, while shuffle — which keeps
   * the current track playing — does not cause a reload.
   */
  queueRevision: number;
  /**
   * Seek requests consumed by the playback engine. `revision` lets the engine
   * tell a genuinely new request from a re-render that carries the same state.
   */
  seekRequest: { positionMs: number; revision: number } | null;
};

export type PlayerActions = {
  /** Replaces the queue and starts at `startIndex`. */
  setQueue: (
    items: readonly QueueItem[],
    startIndex?: number,
    context?: PlayContext,
  ) => void;
  /** Appends to the end without changing the current item. */
  enqueue: (items: readonly QueueItem[]) => void;
  /** Inserts directly after the current item ("play next"). */
  playNext: (items: readonly QueueItem[]) => void;
  removeAt: (index: number) => void;
  clearQueue: () => void;

  jumpTo: (index: number) => void;
  next: () => void;
  previous: () => void;

  toggleShuffle: () => void;
  cycleRepeat: () => void;

  /** Playback engine callbacks (consumed by `services/player/engine.ts`). */
  setPlayback: (playback: Partial<PlaybackState>) => void;
  setStatus: (status: PlaybackStatus) => void;
  setError: (message?: string) => void;
  setPlaying: (playing: boolean) => void;
  /** Moves the playhead; the engine applies it to the native player. */
  seekTo: (positionMs: number) => void;
};

const initialPlayback: PlaybackState = {
  status: 'idle',
  positionMs: 0,
};

const initialState: PlayerState = {
  queue: [],
  currentIndex: -1,
  lastPlaying: false,
  shuffle: false,
  repeat: 'off',
  unshuffledOrder: [],
  playback: initialPlayback,
  queueRevision: 0,
  seekRequest: null,
};

/** State + actions, for components that need both in one selector. */
export type PlayerStore = PlayerState & PlayerActions;

/** Fisher-Yates over queue items, keeping the current track first. */
function shuffled(items: readonly QueueItem[], keepIndex: number): QueueItem[] {
  const current = keepIndex >= 0 && keepIndex < items.length ? items[keepIndex] : undefined;
  const rest = items.filter((_, index) => index !== keepIndex);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = rest[i];
    rest[i] = rest[j];
    rest[j] = tmp;
  }
  return current ? [current, ...rest] : rest;
}

/** Re-keys a queue so duplicate tracks still get unique React keys. */
function withStableKeys(items: readonly QueueItem[]): QueueItem[] {
  return items.map((item, index) => ({ ...item, key: queueKey(item.track.id, index) }));
}

export const PLAYER_STORAGE_KEY = 'player.v1';

export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setQueue: (items, startIndex = 0) => {
        const keyed = withStableKeys(items);
        if (keyed.length === 0) {
          set((state) => ({
            ...initialState,
            playback: initialPlayback,
            queueRevision: state.queueRevision + 1,
          }));
          return;
        }
        const index = Math.min(Math.max(0, startIndex), keyed.length - 1);
        set((state) => ({
          queue: keyed,
          currentIndex: index,
          unshuffledOrder: keyed,
          playback: initialPlayback,
          errorMessage: undefined,
          // Building a queue *is* a request to hear it: the engine starts on
          // the current item without every caller having to remember to say so.
          lastPlaying: true,
          queueRevision: state.queueRevision + 1,
          seekRequest: null,
        }));
      },

      enqueue: (items) => {
        if (items.length === 0) return;
        const combined = withStableKeys([...get().queue, ...items]);
        set({
          queue: combined,
          unshuffledOrder: get().shuffle ? get().unshuffledOrder : combined,
        });
      },

      playNext: (items) => {
        if (items.length === 0) return;
        const state = get();
        const at = state.currentIndex >= 0 ? state.currentIndex + 1 : 0;
        const combined = withStableKeys([
          ...state.queue.slice(0, at),
          ...items,
          ...state.queue.slice(at),
        ]);
        set({
          queue: combined,
          // The current track keeps playing where it is; only an empty queue
          // hands the pointer to the inserted items (and starts them).
          currentIndex:
            state.currentIndex >= 0 ? state.currentIndex : items.length - 1,
          lastPlaying: state.currentIndex >= 0 ? state.lastPlaying : true,
          unshuffledOrder: get().shuffle ? get().unshuffledOrder : combined,
        });
      },

      removeAt: (index) => {
        const state = get();
        if (index < 0 || index >= state.queue.length) return;

        const isCurrent = index === state.currentIndex;
        const queue = state.unshuffledOrder.filter((_, i) => i !== index);
        const keyed = withStableKeys(queue);

        if (keyed.length === 0) {
          set((s) => ({ ...initialState, playback: initialPlayback, queueRevision: s.queueRevision + 1 }));
          return;
        }

        if (state.shuffle) {
          // Shuffled order does not map back to `unshuffledOrder` indices, so
          // fall back to removing by track id and clamping the index.
          const removed = state.queue[index];
          const remaining = state.queue.filter((item) => item !== removed);
          const nextIndex = Math.min(
            state.currentIndex >= index ? state.currentIndex - 1 : state.currentIndex,
            remaining.length - 1,
          );
          set({
            queue: withStableKeys(remaining),
            currentIndex: Math.max(0, nextIndex),
            unshuffledOrder: keyed,
          });
          return;
        }

        set({
          queue: keyed,
          currentIndex: isCurrent
            ? Math.min(index, keyed.length - 1)
            : Math.min(state.currentIndex, keyed.length - 1),
          unshuffledOrder: keyed,
        });
      },

      clearQueue: () =>
        set((state) => ({ ...initialState, playback: initialPlayback, queueRevision: state.queueRevision + 1 })),

      jumpTo: (index) => {
        const { queue } = get();
        if (index < 0 || index >= queue.length) return;
        set((state) => ({
          currentIndex: index,
          playback: initialPlayback,
          errorMessage: undefined,
          queueRevision: state.queueRevision + 1,
          seekRequest: null,
        }));
      },

      next: () => {
        const state = get();
        if (state.queue.length === 0) return;

        const nextIndex = state.currentIndex + 1;
        if (nextIndex >= state.queue.length) {
          if (state.repeat === 'all') {
            set({ currentIndex: 0, playback: initialPlayback });
          } else {
            // End of queue: keep the last track, reset its position.
            set({ playback: { ...state.playback, status: 'idle', positionMs: 0 } });
          }
          return;
        }
        set({ currentIndex: nextIndex, playback: initialPlayback });
      },

      previous: () => {
        const state = get();
        if (state.queue.length === 0) return;

        // Restart the track when the user is more than 3s in — the standard
        // behaviour of every music player, and what people expect.
        if (state.playback.positionMs > 3000) {
          get().seekTo(0);
          return;
        }

        const previousIndex = state.currentIndex - 1;
        if (previousIndex < 0) {
          if (state.repeat === 'all') {
            set({ currentIndex: state.queue.length - 1, playback: initialPlayback });
          } else {
            set({ playback: { ...state.playback, positionMs: 0 } });
          }
          return;
        }
        set({ currentIndex: previousIndex, playback: initialPlayback });
      },

      toggleShuffle: () => {
        const state = get();
        if (state.queue.length < 2) return;

        if (!state.shuffle) {
          set({
            shuffle: true,
            unshuffledOrder: state.queue,
            queue: shuffled(state.queue, state.currentIndex),
            currentIndex: 0,
          });
        } else {
          // Restore the original order and re-find the current track so the
          // track does not change when the user turns shuffle back off.
          const currentTrack = state.queue[state.currentIndex]?.track.id;
          const restored = state.unshuffledOrder;
          const restoredIndex = restored.findIndex((item) => item.track.id === currentTrack);
          set({
            shuffle: false,
            queue: restored,
            currentIndex: restoredIndex >= 0 ? restoredIndex : state.currentIndex,
          });
        }
      },

      cycleRepeat: () => {
        const order: RepeatMode[] = ['off', 'all', 'one'];
        const state = get();
        const next = order[(order.indexOf(state.repeat) + 1) % order.length];
        set({ repeat: next });
      },

      setPlayback: (playback) => set({ playback: { ...get().playback, ...playback } }),
      setStatus: (status) => set({ playback: { ...get().playback, status } }),
      setError: (message) =>
        set({
          errorMessage: message,
          playback: { ...get().playback, status: message ? 'error' : 'idle', error: message },
        }),
      setPlaying: (playing) => set({ lastPlaying: playing }),
      seekTo: (positionMs) =>
        set((state) => ({
          playback: { ...state.playback, positionMs: Math.max(0, Math.round(positionMs)) },
          seekRequest: {
            positionMs: Math.max(0, Math.round(positionMs)),
            revision: (state.seekRequest?.revision ?? 0) + 1,
          },
        })),
    }),
    {
      name: PLAYER_STORAGE_KEY,
      storage: createJSONStorage(() => ({
        getItem: (name) => getItemSync(name),
        setItem: (name, value) => setItemSync(name, value),
        removeItem: (name) => removeItemSync(name),
      })),
      // See the note in `store/settings.ts`: the kv-store is not open at module
      // load, so rehydration is triggered explicitly once the database is up.
      skipHydration: true,
      // Only the queue and modes are persisted; transient playback position is
      // deliberately excluded so a cold start always opens cleanly.
      partialize: (state) => ({
        queue: state.queue,
        currentIndex: state.currentIndex,
        lastPlaying: state.lastPlaying,
        shuffle: state.shuffle,
        repeat: state.repeat,
        unshuffledOrder: state.unshuffledOrder,
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<PlayerState> | undefined;
        if (!state) return current;
        // A persisted queue can reference tracks that were since deleted; clamp
        // the index so the UI never renders a dangling current item.
        const length = state.queue?.length ?? 0;
        const index = Math.min(state.currentIndex ?? -1, length - 1);
        return {
          ...current,
          ...state,
          currentIndex: length === 0 ? -1 : index,
          playback: initialPlayback,
          errorMessage: undefined,
          // Transient engine state never survives a cold start: the restored
          // queue is loaded paused (the engine does not auto-play on boot).
          seekRequest: null,
        };
      },
    },
  ),
);

/* ---------------------------------------------------------------- selectors */

export function selectCurrentItem(state: PlayerState): QueueItem | undefined {
  if (state.currentIndex < 0) return undefined;
  return state.queue[state.currentIndex];
}

export function selectHasNext(state: PlayerState): boolean {
  if (state.queue.length === 0) return false;
  return state.repeat !== 'off' || state.currentIndex < state.queue.length - 1;
}

export function selectHasPrevious(state: PlayerState): boolean {
  if (state.queue.length === 0) return false;
  return state.repeat !== 'off' || state.currentIndex > 0 || state.playback.positionMs > 3000;
}

// Memoised because this selector feeds `useSyncExternalStore`: every fresh
// object it returned on an unchanged state would be a new snapshot and cascade
// into an endless re-render ("Maximum update depth exceeded", a fatal error in
// release builds). The object is recreated only when the key changes.
let lastQueuePosition: { current: number; total: number } | null = null;
let lastQueuePositionKey = '';

export function selectQueuePosition(state: PlayerState): { current: number; total: number } {
  const key = `${state.currentIndex + 1}|${state.queue.length}`;
  if (key !== lastQueuePositionKey) {
    lastQueuePosition = { current: state.currentIndex + 1, total: state.queue.length };
    lastQueuePositionKey = key;
  }
  return lastQueuePosition!;
}