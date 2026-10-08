import { ScrollView, StyleSheet, View } from 'react-native';

import type { Track } from '@/types';
import { formatArtistNames } from '@/utils/format';
import { colors, spacing } from '@/theme/colors';
import { SectionHeader } from '@/components/ui/Feedback';
import { TrackCard } from '@/components/media/TrackRow';
import { Text } from '@/components/ui/Text';

/**
 * Home shelves.
 *
 * instruction.md's home is a set of horizontally scrolling shelves. The shelf
 * component is deliberately generic so Phase 5's recommender can feed it
 * directly without changing this file.
 */

export type ShelfProps = {
  title: string;
  tracks: readonly Track[];
  onSelect: (track: Track, queue: readonly Track[]) => void;
  onMore?: () => void;
  moreLabel?: string;
  /** Shown under the title, e.g. why the recommender picked these. */
  reason?: string;
};

export function Shelf({ title, tracks, onSelect, onMore, moreLabel, reason }: ShelfProps) {
  if (tracks.length === 0) return null;

  return (
    <View style={styles.shelf}>
      <SectionHeader
        title={title}
        actionLabel={onMore ? moreLabel : undefined}
        onAction={onMore}
      />
      {reason ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.reason}>
          {reason}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}>
        {tracks.map((track) => (
          <TrackCard
            key={track.id}
            track={track}
            subtitle={formatArtistNames(track.artistNames)}
            onPress={(selected) => onSelect(selected, tracks)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shelf: { gap: spacing.xs },
  rail: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  reason: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
});