import { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { Track } from '@/types';
import { colors, radius, spacing } from '@/theme/colors';
import { formatArtistNames, formatDuration } from '@/utils/format';

import { Artwork } from './Artwork';
import { KindBadge } from './SourceBadge';
import { Mono, Subtitle, Text } from '@/components/ui/Text';

/**
 * Track row.
 *
 * The most-repeated element in the app, so it is memoized and takes flat
 * primitives rather than objects — passing the whole `Track` would re-render
 * every row whenever any provider detail changed upstream.
 */

export type TrackRowProps = {
  track: Track;
  onPress?: (track: Track) => void;
  onMenuPress?: (track: Track) => void;
  /** Heart state; omit to hide the affordance. */
  favorite?: boolean;
  onToggleFavorite?: (track: Track) => void;
  /** Rendered at the trailing edge instead of the overflow menu (queue). */
  trailing?: React.ReactNode;
  /** Shows a rank number instead of artwork (search result lists). */
  index?: number;
  showArtwork?: boolean;
  showProvider?: boolean;
  subtitle?: string;
  isPlaying?: boolean;
  compact?: boolean;
  /** Merged after the built-in row styles, so callers can inset it. */
  style?: StyleProp<ViewStyle>;
};

function TrackRowComponent({
  track,
  onPress,
  onMenuPress,
  favorite,
  onToggleFavorite,
  trailing,
  index,
  showArtwork = true,
  showProvider = false,
  subtitle,
  isPlaying = false,
  compact = false,
  style,
}: TrackRowProps) {
  const size = compact ? 44 : 52;
  const artistLine = subtitle ?? formatArtistNames(track.artistNames);

  return (
    <Pressable
      onPress={() => onPress?.(track)}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${formatArtistNames(track.artistNames)}`}
      accessibilityHint={onPress ? 'Plays this track' : undefined}
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        pressed && styles.pressed,
        style,
      ]}>
      {index !== undefined ? (
        <View style={styles.index}>
          <Text variant="caption" color={isPlaying ? colors.accent : colors.textTertiary}>
            {index + 1}
          </Text>
        </View>
      ) : showArtwork ? (
        <Artwork uri={track.artworkUrl} seed={track.id} size={size} />
      ) : null}

      <View style={styles.text}>
        <View style={styles.titleRow}>
          {isPlaying ? (
            <Ionicons name="volume-medium" size={13} color={colors.accent} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[isPlaying && { color: colors.accentBright }]}>
            {track.title}
          </Text>
          <KindBadge kind={track.kind} />
        </View>
        <View style={styles.subtitleRow}>
          <Subtitle numberOfLines={1} style={styles.subtitleText}>
            {artistLine}
          </Subtitle>
          {showProvider ? (
            <Mono color={colors.textTertiary}>{track.provider}</Mono>
          ) : null}
          <Mono>{formatDuration(track.durationMs)}</Mono>
        </View>
      </View>

      {/* `trailing` replaces both default actions when supplied. */}
      {trailing ??
        (onToggleFavorite || onMenuPress ? (
          <>
            {onToggleFavorite ? (
              <Pressable
                onPress={() => onToggleFavorite(track)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
                accessibilityState={{ selected: favorite }}
                style={styles.action}>
                <Ionicons
                  name={favorite ? 'heart' : 'heart-outline'}
                  size={18}
                  color={favorite ? colors.accent : colors.textTertiary}
                />
              </Pressable>
            ) : null}
            {onMenuPress ? (
              <Pressable
                onPress={() => onMenuPress(track)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`More options for ${track.title}`}
                style={styles.action}>
                <Ionicons name="ellipsis-vertical" size={16} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </>
        ) : null)}
    </Pressable>
  );
}

/**
 * Memoized with a comparator that ignores fields the row does not render, so a
 * new provider payload for an unrelated track does not re-render this one.
 */
export const TrackRow = memo(TrackRowComponent, (previous, next) => {
  return (
    previous.track.id === next.track.id &&
    previous.favorite === next.favorite &&
    previous.isPlaying === next.isPlaying &&
    previous.compact === next.compact &&
    previous.index === next.index &&
    previous.subtitle === next.subtitle &&
    previous.showProvider === next.showProvider &&
    previous.onPress === next.onPress &&
    previous.onMenuPress === next.onMenuPress &&
    previous.onToggleFavorite === next.onToggleFavorite &&
    previous.trailing === next.trailing
  );
});

/** Card variant used on the home shelves. */
export const TrackCard = memo(function TrackCard({
  track,
  onPress,
  onToggleFavorite,
  favorite,
  subtitle,
}: {
  track: Track;
  onPress?: (track: Track) => void;
  onToggleFavorite?: (track: Track) => void;
  favorite?: boolean;
  subtitle?: string;
}) {
  return (
    <Pressable
      onPress={() => onPress?.(track)}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${formatArtistNames(track.artistNames)}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <Animated.View entering={FadeIn.duration(180)}>
        <Artwork uri={track.artworkUrl} seed={track.id} size={140} cache="disk" />
      </Animated.View>
      <View style={styles.cardText}>
        <Text variant="bodySmall" numberOfLines={1}>
          {track.title}
        </Text>
        <Subtitle numberOfLines={1}>{subtitle ?? formatArtistNames(track.artistNames)}</Subtitle>
      </View>
      {onToggleFavorite ? (
        <Pressable
          onPress={() => onToggleFavorite(track)}
          hitSlop={8}
          style={styles.cardAction}
          accessibilityRole="button"
          accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}>
          <Ionicons
            name={favorite ? 'heart' : 'heart-outline'}
            size={15}
            color={favorite ? colors.accent : colors.textTertiary}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowCompact: { paddingVertical: spacing.xs },
  pressed: { opacity: 0.6 },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  subtitleText: { flexShrink: 1 },
  action: { padding: spacing.xs },
  index: { width: 24, alignItems: 'center' },
  card: {
    width: 140,
    gap: spacing.sm,
  },
  cardText: { gap: 2 },
  cardAction: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
  },
});