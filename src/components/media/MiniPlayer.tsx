import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, radius, spacing } from '@/theme/colors';
import { formatArtistNames } from '@/utils/format';
import { selectCurrentItem, usePlayerStore } from '@/store/player';
import {
  MINI_PLAYER_HEIGHT,
  useMiniPlayerOffset,
  useNowPlayingVisibility,
} from '@/hooks/useMiniPlayer';

import { Artwork } from './Artwork';
import { ProgressLine } from './PlayerControls';
import { Text } from '@/components/ui/Text';

/**
 * Mini player.
 *
 * Docked above the tab bar and rendered from the root layout, so it survives
 * tab changes. Tapping the body opens Now Playing; the controls stay inline so
 * the most common action (pause/resume, skip) needs one tap.
 *
 * The dock lives above the tab bar and is rendered from the root layout, so it
 * survives tab changes. Tapping the body opens Now Playing; the controls stay
 * inline so the most common action (pause/resume, skip) needs one tap. The
 * buttons drive the playback engine through the player store — play toggles
 * the intent, skip walks the queue.
 */

export function MiniPlayer() {
  const router = useRouter();
  const visible = useNowPlayingVisibility();
  const insets = useSafeAreaInsets();
  const bottom = useMiniPlayerOffset(insets.bottom, spacing.sm);

  const current = usePlayerStore(selectCurrentItem);
  const playback = usePlayerStore((state) => state.playback);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const setPlaying = usePlayerStore((state) => state.setPlaying);
  const lastPlaying = usePlayerStore((state) => state.lastPlaying);

  if (!visible || !current) return null;

  const { track } = current;
  const isPlaying = playback.status === 'playing';
  const positionRatio =
    typeof playback.durationMs === 'number' && playback.durationMs > 0
      ? playback.positionMs / playback.durationMs
      : 0;

  return (
    <View style={[styles.wrapper, { bottom }]} pointerEvents="box-none">
      <View style={styles.container}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={[colors.accentSoft, 'rgba(139,92,246,0.03)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.hairline} />

        <Pressable
          onPress={() => router.push('/now-playing')}
          accessibilityRole="button"
          accessibilityLabel={`Now playing: ${track.title} by ${formatArtistNames(track.artistNames)}`}
          accessibilityHint="Opens the full player"
          style={styles.body}>
          <Artwork uri={track.artworkUrl} seed={track.id} size={40} />
          <View style={styles.text}>
            <Text variant="bodySmall" numberOfLines={1}>
              {track.title}
            </Text>
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {formatArtistNames(track.artistNames)}
            </Text>
          </View>
        </Pressable>

        <View style={styles.controls}>
          <Pressable
            onPress={previous}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous track"
            style={styles.control}>
            <Ionicons name="play-skip-back" size={20} color={colors.text} />
          </Pressable>

          <Pressable
            onPress={() => setPlaying(!lastPlaying)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            style={styles.control}>
            <Ionicons
              name={isPlaying || (lastPlaying && playback.status === 'loading') ? 'pause' : 'play'}
              size={22}
              color={colors.text}
            />
          </Pressable>

          <Pressable
            onPress={next}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Next track"
            style={styles.control}>
            <Ionicons name="play-skip-forward" size={20} color={colors.text} />
          </Pressable>
        </View>

        {/*
          Thin progress line along the bottom edge, matching Spotify's dock.
          It must NOT sit in the row's main axis: ProgressLine is `width: 100%`
          and takes the full row width, which would squeeze the flex:1 body to
          nothing. It is anchored absolutely instead.
        */}
        <View pointerEvents="none" style={styles.progress}>
          <ProgressLine ratio={positionRatio} height={2} />
        </View>
      </View>

      {playback.error ? (
        <View style={styles.error}>
          <Text variant="micro" color={colors.danger} numberOfLines={2}>
            {playback.error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: MINI_PLAYER_HEIGHT,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  hairline: {
    position: 'absolute',
    top: 0,
    left: radius.lg,
    right: radius.lg,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1, gap: 1 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.xs,
  },
  control: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    overflow: 'hidden',
  },
  error: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.overlay,
  },
});