import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { QueueItem } from '@/types';
import { colors, radius, spacing } from '@/theme/colors';
import { formatArtistNames } from '@/utils/format';
import { usePlayerStore } from '@/store/player';
import { Artwork } from '@/components/media/Artwork';
import { PlayingIndicator } from '@/components/media/PlayerControls';
import { IconButton } from '@/components/ui/Button';
import { EmptyState, Screen } from '@/components/ui/Feedback';
import { Text } from '@/components/ui/Text';

/**
 * Queue.
 *
 * The live playback queue, straight from the player store: tap a row to jump
 * to it, remove rows you do not want, or clear the lot. The current item is
 * marked with the equaliser glyph rather than a selection highlight, so the
 * distinction between "selected" and "playing" stays visible.
 */

export default function QueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const jumpTo = usePlayerStore((state) => state.jumpTo);
  const removeAt = usePlayerStore((state) => state.removeAt);
  const clearQueue = usePlayerStore((state) => state.clearQueue);
  const playbackStatus = usePlayerStore((state) => state.playback.status);

  const renderItem = useCallback(
    ({ item, index }: { item: QueueItem; index: number }) => {
      const isCurrent = index === currentIndex;
      return (
        <Pressable
          onPress={() => jumpTo(index)}
          accessibilityRole="button"
          accessibilityLabel={`Play ${item.track.title} by ${formatArtistNames(item.track.artistNames)}`}
          accessibilityState={{ selected: isCurrent }}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <Artwork uri={item.track.artworkUrl} seed={item.track.id} size={44} />
          <View style={styles.rowText}>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              color={isCurrent ? colors.accent : colors.text}>
              {item.track.title}
            </Text>
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {formatArtistNames(item.track.artistNames)}
            </Text>
          </View>
          {isCurrent ? (
            <PlayingIndicator animating={playbackStatus === 'playing'} />
          ) : null}
          <IconButton
            name="trash-outline"
            size={18}
            accessibilityLabel={`Remove ${item.track.title} from queue`}
            onPress={() => removeAt(index)}
          />
        </Pressable>
      );
    },
    [currentIndex, jumpTo, playbackStatus, removeAt],
  );

  return (
    <Screen edges={['top', 'bottom']} style={styles.screen}>
      <View style={styles.header}>
        <IconButton
          name="chevron-down"
          accessibilityLabel="Close queue"
          onPress={() => router.back()}
        />
        <View style={styles.headerText}>
          <Text variant="title">Queue</Text>
          <Text variant="caption" color={colors.textTertiary}>
            {queue.length > 0 ? `${queue.length} tracks` : 'Empty'}
          </Text>
        </View>
        {queue.length > 0 ? (
          <IconButton
            name="trash-outline"
            accessibilityLabel="Clear queue"
            onPress={clearQueue}
          />
        ) : null}
      </View>

      <FlatList
        data={queue}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + spacing.xl },
          queue.length === 0 && styles.listEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          <EmptyState
            icon={<Ionicons name="list-outline" size={36} color={colors.textTertiary} />}
            title="Queue is empty"
            message="Play something from search, or add tracks with “Play next” and “Add to queue”."
            action={
              <IconButton
                name="search"
                accessibilityLabel="Go to search"
                onPress={() => router.replace('/(tabs)/search')}
              />
            }
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  headerText: { flex: 1, gap: 2 },
  list: { paddingHorizontal: spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: colors.backgroundSelected },
  rowText: { flex: 1, gap: 1 },
});
