import { Platform } from 'react-native';
import {
  createAudioPlayer,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';

import { queryClient } from '@/services/cache/queryClient';
import {
  getDatabase,
  isCompletedPlay,
  recordPlay,
  upsertTrack,
} from '@/services/database';
import { queryKeys } from '@/hooks/useQueryKeys';
import { usePlayerStore, type PlayerStore } from '@/store/player';
import { selectResolverConfig, useSettingsStore } from '@/store/settings';
import type { PlayContext, QueueItem, Track } from '@/types';
import { formatArtistNames } from '@/utils/format';

import {
  ResolverNotConfiguredError,
  resolveStream,
  StreamResolutionError,
} from './resolver';

/**
 * Playback engine.
 *
 * A single module-scoped native player (`expo-audio`) that mirrors the intent
 * in `store/player.ts` into real audio:
 *
 *  - the Zustand queue stays the source of truth for *what* should play
 *    (shuffle, repeat, enqueue, play-next all live there);
 *  - this engine owns *how*: stream resolution, the native player lifecycle,
 *    background playback, lock-screen/notification controls, and writing real
 *    status (position, duration, playing) back into the store;
 *  - listening events are folded into SQLite history here, so the
 *    recommender's signals populate as soon as something is heard.
 *
 * The engine state hangs off `globalThis` rather than module scope so a fast
 * refresh re-evaluating this file cannot attach a second store subscription
 * on top of a stale one.
 */

/** How often the native player reports position (ms). */
const STATUS_INTERVAL_MS = 500;

/**
 * Grace window after engine-initiated play/pause/seek during which a native
 * "not playing" status must NOT be mirrored back into the play intent —
 * load and play transitions briefly report idle otherwise.
 */
const INTENT_SYNC_GRACE_MS = 1500;

/** Sessions shorter than this were a browse, not a listen; they record nothing. */
const MIN_SESSION_MS = 1000;

/** Per-update clamp so a long suspension cannot inflate one listening event. */
const MAX_TICK_MS = 10_000;

type Session = {
  readonly track: Track;
  readonly context: PlayContext;
  listenedMs: number;
  lastTickSeconds: number;
  durationMs?: number;
};

type EngineSnapshot = {
  readonly trackId: string | null;
  readonly queueRevision: number;
  readonly lastPlaying: boolean;
  readonly loopSingle: boolean;
  readonly seekRevision: number;
  readonly seekPositionMs: number;
};

type EngineHandle = {
  started: boolean;
  unsubscribe: () => void;
  player: AudioPlayer | null;
  statusSubscription: { remove(): void } | null;
  lastSnapshot: EngineSnapshot | null;
  /** Superseding guard: async resolution results apply only to the latest load. */
  loadToken: number;
  loadedItemKey: string | null;
  session: Session | null;
  intentSyncUntil: number;
  lockScreenReady: boolean;
};

const ENGINE_KEY = Symbol.for('musicplayer.player.engine');

function engine(): EngineHandle {
  const globals = globalThis as Record<symbol, EngineHandle | undefined>;
  globals[ENGINE_KEY] ??= {
    started: false,
    unsubscribe: () => undefined,
    player: null,
    statusSubscription: null,
    lastSnapshot: null,
    loadToken: 0,
    loadedItemKey: null,
    session: null,
    intentSyncUntil: 0,
    lockScreenReady: false,
  };
  return globals[ENGINE_KEY] as EngineHandle;
}

/* ------------------------------------------------------------------ snapshot */

function snapshot(state: PlayerStore): EngineSnapshot {
  const item = state.currentIndex >= 0 ? state.queue[state.currentIndex] : undefined;
  return {
    trackId: item?.track.id ?? null,
    queueRevision: state.queueRevision,
    lastPlaying: state.lastPlaying,
    loopSingle: state.repeat === 'one',
    seekRevision: state.seekRequest?.revision ?? 0,
    seekPositionMs: state.seekRequest?.positionMs ?? 0,
  };
}

/* --------------------------------------------------------------------- start */

/**
 * Attaches the engine to the player store. Idempotent; called once from the
 * root layout after the persisted stores have been rehydrated.
 */
export function startPlaybackEngine(): void {
  const handle = engine();
  if (handle.started) return;
  handle.started = true;

  // Background playback + exclusive audio focus. `doNotMix` is required for
  // the OS to associate lock-screen/notification controls with this player.
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  }).catch((error: unknown) => {
    console.warn('[engine] setAudioModeAsync failed', error);
  });

  handle.lastSnapshot = snapshot(usePlayerStore.getState());
  handle.unsubscribe = usePlayerStore.subscribe((state) => {
    const next = snapshot(state);
    const previous = handle.lastSnapshot ?? next;
    handle.lastSnapshot = next;
    onStoreChange(next, previous);
  });

  // A queue restored from persistence must never surprise the user with audio
  // on app open: clear the intent and let the first tap load and play.
  if (usePlayerStore.getState().lastPlaying) {
    usePlayerStore.setState({ lastPlaying: false });
  }
}

/* ------------------------------------------------------------- store bridge */

function onStoreChange(next: EngineSnapshot, previous: EngineSnapshot): void {
  const handle = engine();

  // New current track, or the queue intent was rebuilt wholesale (setQueue /
  // jumpTo): reload. Shuffle deliberately does not bump the revision, so the
  // current track keeps playing untouched while the order changes around it.
  if (next.trackId !== previous.trackId || next.queueRevision !== previous.queueRevision) {
    void loadCurrent();
    return;
  }

  if (next.loopSingle !== previous.loopSingle && handle.player) {
    handle.player.loop = next.loopSingle;
  }

  if (next.seekRevision !== previous.seekRevision) {
    void applySeek(next.seekPositionMs);
    return;
  }

  if (next.lastPlaying !== previous.lastPlaying) {
    applyIntent(next.lastPlaying);
  }
}

function applyIntent(shouldPlay: boolean): void {
  const handle = engine();
  const state = usePlayerStore.getState();
  const item = state.currentIndex >= 0 ? state.queue[state.currentIndex] : undefined;

  if (!shouldPlay) {
    handle.intentSyncUntil = Date.now() + INTENT_SYNC_GRACE_MS;
    try {
      handle.player?.pause();
    } catch {
      /* nothing loaded to pause */
    }
    syncStatus();
    return;
  }

  if (!handle.player || handle.loadedItemKey === null || !item || handle.loadedItemKey !== item.key) {
    handle.intentSyncUntil = Date.now() + INTENT_SYNC_GRACE_MS;
    // First play after boot, a retry after a failed load, or a queue change
    // that raced the intent: (re)load, which honours `lastPlaying` on success.
    void loadCurrent();
    return;
  }

  handle.intentSyncUntil = Date.now() + INTENT_SYNC_GRACE_MS;
  try {
    handle.player.play();
  } catch (error: unknown) {
    state.setError(error instanceof Error ? error.message : String(error));
  }
}

async function applySeek(positionMs: number): Promise<void> {
  const handle = engine();
  if (!handle.player || handle.loadedItemKey === null) return;
  handle.intentSyncUntil = Date.now() + INTENT_SYNC_GRACE_MS;
  try {
    await handle.player.seekTo(positionMs / 1000);
  } catch (error: unknown) {
    console.warn('[engine] seek failed', error);
  }
}

/* -------------------------------------------------------------------- loads */

async function loadCurrent(): Promise<void> {
  const handle = engine();
  const state = usePlayerStore.getState();
  const item = state.currentIndex >= 0 ? state.queue[state.currentIndex] : undefined;
  const token = (handle.loadToken += 1);

  if (!item) {
    handle.loadedItemKey = null;
    flushSession();
    resetPlayerSource();
    state.setPlayback({ status: 'idle', positionMs: 0, durationMs: undefined, error: undefined });
    usePlayerStore.setState({ errorMessage: undefined });
    return;
  }

  flushSession();
  state.setPlayback({
    status: 'loading',
    positionMs: 0,
    durationMs: item.track.durationMs,
    error: undefined,
  });
  usePlayerStore.setState({ errorMessage: undefined });

  try {
    const stream = await resolveStream(item.track, selectResolverConfig(useSettingsStore.getState()));
    if (token !== handle.loadToken) return; // superseded by a newer load

    const player = ensurePlayer();
    player.loop = usePlayerStore.getState().repeat === 'one';
    player.replace({
      uri: stream.url,
      headers: stream.requiresHeaders,
      name: item.track.title,
    });

    handle.loadedItemKey = item.key;
    beginSession(item);

    usePlayerStore.getState().setPlayback({
      status: 'paused',
      positionMs: 0,
      durationMs: stream.durationMs ?? item.track.durationMs,
    });

    enableLockScreen(item.track);

    if (usePlayerStore.getState().lastPlaying) {
      handle.intentSyncUntil = Date.now() + INTENT_SYNC_GRACE_MS;
      player.play();
    } else {
      syncStatus();
    }
  } catch (error: unknown) {
    if (token !== handle.loadToken) return;
    handle.loadedItemKey = null;
    usePlayerStore.getState().setError(describeError(error));
  }
}

function ensurePlayer(): AudioPlayer {
  const handle = engine();
  if (!handle.player) {
    handle.player = createAudioPlayer(null, { updateInterval: STATUS_INTERVAL_MS });
    handle.statusSubscription = handle.player.addListener('playbackStatusUpdate', handleStatus);
  }
  return handle.player;
}

function resetPlayerSource(): void {
  const handle = engine();
  if (!handle.player) return;
  try {
    handle.player.pause();
    handle.player.replace(null);
    handle.player.clearLockScreenControls();
  } catch (error: unknown) {
    console.warn('[engine] could not release the audio source', error);
  }
}

/** Mirrors the native player into store status after direct engine actions. */
function syncStatus(): void {
  const handle = engine();
  if (!handle.player) return;
  const state = usePlayerStore.getState();
  state.setPlayback({
    status: handle.player.playing
      ? 'playing'
      : handle.player.isLoaded
        ? 'paused'
        : state.playback.status,
    positionMs: Math.round(handle.player.currentTime * 1000),
    durationMs:
      handle.player.duration > 0
        ? Math.round(handle.player.duration * 1000)
        : state.playback.durationMs,
  });
}

/* ------------------------------------------------------------- status events */

function handleStatus(status: AudioStatus): void {
  const handle = engine();
  const state = usePlayerStore.getState();
  if (state.currentIndex < 0) return;

  // Fold real playback time into the current listening session.
  if (handle.session && status.playing) {
    const deltaMs = (status.currentTime - handle.session.lastTickSeconds) * 1000;
    if (deltaMs > 0 && deltaMs < MAX_TICK_MS) handle.session.listenedMs += deltaMs;
    handle.session.lastTickSeconds = status.currentTime;
  }
  if (handle.session && status.duration > 0) {
    handle.session.durationMs = Math.round(status.duration * 1000);
  }

  if (status.error) {
    try {
      handle.player?.pause();
    } catch {
      /* already stopped */
    }
    state.setError(describePlayerError(status.error));
    return;
  }

  if (status.didJustFinish) {
    handleFinish();
    return;
  }

  // Native playback can pause without a store intent change (lock screen,
  // audio-focus loss); mirror it so the one-tap toggle stays honest. The grace
  // window keeps the engine's own load/play transitions out of this path.
  if (
    !status.playing &&
    status.isLoaded &&
    !status.isBuffering &&
    state.lastPlaying &&
    Date.now() >= handle.intentSyncUntil
  ) {
    state.setPlaying(false);
  }

  state.setPlayback({
    status: status.playing
      ? 'playing'
      : status.isBuffering && !status.isLoaded
        ? 'loading'
        : 'paused',
    positionMs: Math.round(status.currentTime * 1000),
    durationMs:
      status.duration > 0 ? Math.round(status.duration * 1000) : state.playback.durationMs,
  });
}

function handleFinish(): void {
  const handle = engine();
  const state = usePlayerStore.getState();
  flushSession();

  const autoplay = useSettingsStore.getState().autoplay;
  const before = state.currentIndex;

  if (!autoplay) {
    state.setPlaying(false);
    state.setPlayback({ status: 'idle', positionMs: 0 });
    try {
      handle.player?.pause();
    } catch {
      /* already stopped */
    }
    return;
  }

  state.next();

  const after = usePlayerStore.getState();
  if (after.currentIndex !== before) {
    // The store moved on; the subscription already started loading the next
    // item with the play intent preserved.
    return;
  }

  if (after.repeat === 'all' && handle.player) {
    // Repeat-all over a single-item queue wraps onto itself.
    after.setPlayback({ positionMs: 0 });
    void handle.player
      .seekTo(0)
      .then(() => handle.player?.play())
      .catch(() => undefined);
    return;
  }

  // End of queue: park cleanly on the last track.
  after.setPlaying(false);
  after.setPlayback({ status: 'idle', positionMs: 0 });
  try {
    handle.player?.pause();
  } catch {
    /* already stopped */
  }
}

/* --------------------------------------------------------- listening events */

function beginSession(item: QueueItem): void {
  engine().session = {
    track: item.track,
    context: item.context,
    listenedMs: 0,
    lastTickSeconds: 0,
    durationMs: item.track.durationMs,
  };
}

/**
 * Closes the current listening session, if any, and records it.
 *
 * Called on track change and end-of-queue — deliberately *not* on pause, so a
 * pause/resume cycle stays one listen instead of inflating history with
 * fragments that all read as skips.
 */
function flushSession(): void {
  const handle = engine();
  const active = handle.session;
  handle.session = null;
  if (!active) return;
  if (active.listenedMs < MIN_SESSION_MS) return;
  void recordListening(active);
}

async function recordListening(active: Session): Promise<void> {
  const playMs = Math.round(active.listenedMs);
  const completed = isCompletedPlay(playMs, active.durationMs);
  try {
    const db = await getDatabase();
    // A track can be played without ever being cached (straight from a provider
    // shelf); upserting first guarantees the row `recordPlay` needs exists.
    await upsertTrack(db, active.track);
    await recordPlay(db, {
      trackId: active.track.id,
      playedAt: Date.now(),
      playMs,
      completed,
      context: active.context,
      track: active.track,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['library', 'history'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stats() }),
      queryClient.invalidateQueries({ queryKey: ['library', 'mostPlayed'] }),
      queryClient.invalidateQueries({ queryKey: ['library', 'recentlyPlayed'] }),
      queryClient.invalidateQueries({ queryKey: ['library', 'continue'] }),
    ]);
  } catch (error: unknown) {
    console.warn('[engine] could not record listening event', error);
  }
}

/* -------------------------------------------------------- lock screen / shade */

function enableLockScreen(track: Track): void {
  const handle = engine();

  const apply = () => {
    if (!handle.player) return;
    try {
      handle.player.setActiveForLockScreen(
        true,
        {
          title: track.title,
          artist: formatArtistNames(track.artistNames),
          albumTitle: track.albumTitle,
          artworkUrl: track.artworkUrl,
        },
        { showSeekBackward: true, showSeekForward: true },
      );
    } catch (error: unknown) {
      console.warn('[engine] lock screen controls unavailable', error);
    }
  };

  if (handle.lockScreenReady || Platform.OS !== 'android') {
    handle.lockScreenReady = true;
    apply();
    return;
  }

  // Android 13+ gates the media notification behind POST_NOTIFICATIONS; ask on
  // first play rather than at startup, so the prompt arrives with context.
  requestNotificationPermissionsAsync()
    .then(() => {
      handle.lockScreenReady = true;
      apply();
    })
    .catch(() => {
      // Denied or unavailable: playback still works, just without shade
      // controls. Not marked ready — the next play tries again.
    });
}

/* --------------------------------------------------------------------- utils */

function describeError(error: unknown): string {
  if (error instanceof ResolverNotConfiguredError) return error.message;
  if (error instanceof StreamResolutionError) {
    return `Could not load this track: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Translates raw expo-audio player errors into copy users can act on. The
 * player is reached only after the resolver produced a URL, so failures here
 * are stream/media-level: a dead link, a broken container, a codec mismatch.
 */
function describePlayerError(raw: string): string {
  if (/source error/i.test(raw)) {
    return 'Could not load this track (source error). Try a different result or check your connection.';
  }
  return raw;
}
