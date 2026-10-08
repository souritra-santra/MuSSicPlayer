import { useCallback } from 'react';
import { useRouter } from 'expo-router';

import type { QueueItem, SearchResult, Track } from '@/types';
import { usePlayerStore } from '@/store/player';
import { useSettingsStore } from '@/store/settings';
import { useToast } from '@/hooks/useToast';

/**
 * The single entry point for "user wants to hear this".
 *
 * Every surface (search row, home shelf, playlist, album, history) calls this
 * instead of manipulating the queue directly, so queue construction, the
 * explicit-content filter and the "not yet playable" feedback behave the same
 * everywhere.
 */

export type PlayRequest = {
  /** The track to start on. */
  track: Track;
  /** The list it came from — becomes the queue. */
  queue?: readonly Track[];
  /** Playback origin, stored per queue item for history attribution. */
  context?: QueueItem['context'];
};

export function usePlayback() {
  const router = useRouter();
  const toast = useToast();
  const setQueue = usePlayerStore((state) => state.setQueue);
  const enqueueTrack = usePlayerStore((state) => state.enqueue);
  const playNextTrack = usePlayerStore((state) => state.playNext);
  const excludeExplicit = useSettingsStore((state) => state.excludeExplicit);
  const resolverEndpoint = useSettingsStore((state) => state.resolverEndpoint);

  // Keys are positional so a queue can hold the same track twice (a user can add
// a track they are already listening to) without React reusing the wrong row.
  const buildQueue = useCallback(
    (tracks: readonly Track[], context: QueueItem['context']): QueueItem[] =>
      tracks.map((track, index) => ({
        key: `${track.id}#${index}`,
        track,
        context,
      })),
    [],
  );

  /**
   * Starts playback from a list.
   *
   * When explicit tracks are filtered, a requested track that is filtered out
   * falls through to the next allowed track rather than silently doing nothing.
   */
  const play = useCallback(
    ({ track, queue, context = 'search' }: PlayRequest) => {
      const source = queue && queue.length > 0 ? queue : [track];
      const allowed = excludeExplicit ? source.filter((item) => item.explicit !== true) : source;

      if (allowed.length === 0) {
        toast.show('Hidden by your "no explicit tracks" setting', 'info');
        return;
      }

      const requestedIndex = allowed.findIndex((item) => item.id === track.id);
      // -1 means the requested track was the one filtered out; start from the top.
      const startIndex = requestedIndex >= 0 ? requestedIndex : 0;

      setQueue(buildQueue(allowed, context), startIndex, context);
    },
    [buildQueue, excludeExplicit, setQueue, toast],
  );

  /** Appends to the end of the queue without interrupting playback. */
  const playNext = useCallback(
    (track: Track) => {
      playNextTrack([{ key: track.id, track, context: 'queue' }]);
      toast.show('Playing next', 'success');
    },
    [playNextTrack, toast],
  );

  const addToQueue = useCallback(
    (track: Track) => {
      enqueueTrack([{ key: track.id, track, context: 'queue' }]);
      toast.show('Added to queue', 'success');
    },
    [enqueueTrack, toast],
  );

  /**
   * Opens Now Playing.
   *
   * With no track selected and nothing queued, the screen explains how to get
   * started instead of rendering an empty shell.
   */
  const openNowPlaying = useCallback(() => {
    router.push('/now-playing');
  }, [router]);

  /**
   * Explains why a track cannot play yet, or `null` when a play attempt is
   * worth making. Resolution itself happens at play time in the engine, so a
   * configured resolver means "try it" — failures surface on the mini player.
   */
  const playbackUnavailableReason = useCallback(
    (track: Track): string | null => {
      if (track.streamUrl) return null;
      if (resolverEndpoint.length === 0) {
        return 'Add a stream resolver in Settings to play from this source.';
      }
      return null;
    },
    [resolverEndpoint],
  );

  const playSearchResult = useCallback(
    (result: SearchResult, queue: readonly SearchResult[]) => {
      play({
        track: result.track,
        queue: queue.map((entry) => entry.track),
        context: 'search',
      });
    },
    [play],
  );

  return {
    play,
    playSearchResult,
    playNext,
    addToQueue,
    openNowPlaying,
    playbackUnavailableReason,
  };
}