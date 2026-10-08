import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing } from '@/theme/colors';
import { formatArtistNames } from '@/utils/format';
import {
  selectCurrentItem,
  selectHasNext,
  selectHasPrevious,
  selectQueuePosition,
  usePlayerStore,
} from '@/store/player';
import { Artwork } from '@/components/media/Artwork';
import { PlayingIndicator, SeekBar, UnavailableNote } from '@/components/media/PlayerControls';
import { IconButton } from '@/components/ui/Button';
import { EmptyState, Screen } from '@/components/ui/Feedback';
import { Text } from '@/components/ui/Text';
import { useFavoriteStates, useToggleFavorite } from '@/hooks/useLibrary';

/**
 * Now Playing.
 *
 * The full-screen player: transport buttons drive the playback engine through
 * the player store, the scrubber seeks on release, and the secondary row
 * exposes the two things people reach for mid-track — the heart and the queue.
 * When playback fails (no resolver, dead stream) the screen says so instead of
 * showing a scrubber that will never move.
 */

export default function NowPlayingScreen() {
  const router = useRouter();

  const current = usePlayerStore(selectCurrentItem);
  const position = usePlayerStore(selectQueuePosition);
  const playback = usePlayerStore((state) => state.playback);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const setPlaying = usePlayerStore((state) => state.setPlaying);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const lastPlaying = usePlayerStore((state) => state.lastPlaying);
  const hasNext = usePlayerStore(selectHasNext);
  const hasPrevious = usePlayerStore(selectHasPrevious);
  const repeat = usePlayerStore((state) => state.repeat);
  const shuffle = usePlayerStore((state) => state.shuffle);

  if (!current) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.headerBar}>
          <IconButton
            name="chevron-down"
            accessibilityLabel="Close player"
            onPress={() => router.back()}
          />
        </View>
        <EmptyState
          icon={<Ionicons name="musical-notes-outline" size={36} color={colors.textTertiary} />}
          title="Nothing playing"
          message="Search for a track and tap it to build a queue."
          action={
            <IconButton
              name="search"
              accessibilityLabel="Go to search"
              onPress={() => router.replace('/(tabs)/search')}
            />
          }
        />
      </Screen>
    );
  }

  const { track } = current;
  const isPlaying = playback.status === 'playing';
  const durationMs = playback.durationMs ?? track.durationMs;

  return (
    <Screen edges={['top', 'bottom']} style={styles.screen}>
      {/* Full-bleed gradient behind the artwork, tinted by the palette. */}
      <LinearGradient
        colors={['rgba(139,92,246,0.28)', 'transparent']}
        style={styles.backdrop}
        pointerEvents="none"
      />

      <View style={styles.headerBar}>
        <IconButton
          name="chevron-down"
          accessibilityLabel="Close player"
          onPress={() => router.back()}
        />
        <View style={styles.headerCenter}>
          <Text label color={colors.textTertiary}>
            {isPlaying
              ? 'Playing from queue'
              : `From queue · ${position.current}/${position.total}`}
          </Text>
        </View>
        <IconButton
          name="ellipsis-horizontal"
          accessibilityLabel="More options"
          onPress={() => router.push('/settings')}
        />
      </View>

      <View style={styles.artworkArea}>
        <Artwork uri={track.artworkUrl} seed={track.id} size={312} rounded={false} cache="disk" />
      </View>

      <View style={styles.meta}>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text variant="title" numberOfLines={2}>
              {track.title}
            </Text>
            <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
              {formatArtistNames(track.artistNames)}
            </Text>
          </View>
          <PlayingIndicator animating={isPlaying} />
        </View>

        <View style={styles.progress}>
          <SeekBar
            positionMs={playback.positionMs}
            durationMs={durationMs}
            onSeek={seekTo}
            disabled={playback.status === 'loading'}
          />
        </View>

        {playback.error ? <UnavailableNote message={playback.error} /> : null}

        <View style={styles.transport}>
          <IconButton
            name="shuffle"
            size={20}
            active={shuffle}
            accessibilityLabel={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
            onPress={toggleShuffle}
          />
          <IconButton
            name="play-skip-back"
            size={30}
            disabled={!hasPrevious}
            accessibilityLabel="Previous track"
            onPress={previous}
          />
          <Pressable
            onPress={() => setPlaying(!lastPlaying)}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            style={({ pressed }) => [styles.playButton, pressed && { opacity: 0.85 }]}>
            <Ionicons
              name={isPlaying || (lastPlaying && playback.status === 'loading') ? 'pause' : 'play'}
              size={30}
              color={colors.background}
            />
          </Pressable>
          <IconButton
            name="play-skip-forward"
            size={30}
            disabled={!hasNext}
            accessibilityLabel="Next track"
            onPress={next}
          />
          <IconButton
            name={repeat === 'one' ? 'repeat' : 'repeat-outline'}
            size={20}
            active={repeat !== 'off'}
            accessibilityLabel={`Repeat: ${repeat}`}
            onPress={cycleRepeat}
          />
        </View>

        <View style={styles.secondary}>
          <FavoriteButton trackId={track.id} />
          <IconButton
            name="list-outline"
            size={20}
            accessibilityLabel="Open queue"
            onPress={() => router.push('/queue')}
          />
        </View>
      </View>
    </Screen>
  );
}

/** Heart with the real favourite state of the current track. */
function FavoriteButton({ trackId }: { trackId: string }) {
  const { data: favoriteStates } = useFavoriteStates([trackId]);
  const toggleFavorite = useToggleFavorite();
  const favorite = favoriteStates?.has(trackId) ?? false;

  return (
    <IconButton
      name={favorite ? 'heart' : 'heart-outline'}
      size={20}
      active={favorite}
      accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
      onPress={() => toggleFavorite.mutate(trackId)}
    />
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 460,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  artworkArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  meta: {
    flex: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleText: { flex: 1, gap: spacing.xs },
  progress: { gap: spacing.xs },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
});
