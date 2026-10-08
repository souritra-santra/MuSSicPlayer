import { useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '@/types';
import { colors, radius, spacing } from '@/theme/colors';
import { pluralize } from '@/utils/format';
import { useHomeData } from '@/features/home/useHomeData';
import { Shelf } from '@/features/home/HomeShelves';
import { usePlayback } from '@/hooks/usePlayback';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useTrendingShelf } from '@/hooks/useTrending';
import { MINIPLAYER_BOTTOM_PADDING } from '@/hooks/useMiniPlayer';
import {
  EmptyState,
  ErrorState,
  Screen,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  SkeletonShelf,
} from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { OfflineBanner } from '@/components/media/OfflineBanner';
import { Text } from '@/components/ui/Text';

/**
 * Home.
 *
 * Instruction.md's first tab. Everything here comes from the local database, so
 * the screen renders instantly and works offline — network-backed
 * recommendations are layered on in Phase 5 without changing this layout.
 */

export default function HomeScreen() {
  const router = useRouter();
  const { data, loading, error, reload } = useHomeData();
  const { shelf: trending } = useTrendingShelf();
  const { play } = usePlayback();
  const { isOnline } = useConnectivity();

  // Rebuild the shelves each time the tab regains focus: DB-only reads are
  // cheap, and it keeps recommendations current the moment the user has
  // listened to (or saved) something new.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const hasShelves = (data?.shelves.filter((shelf) => shelf.tracks.length > 0).length ?? 0) > 0;
  const hasTrending = (trending?.tracks.length ?? 0) > 0;

  return (
    <Screen>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Home"
          subtitle={data ? describeLibrary(data) : undefined}
          right={
            <Button
              label="Settings"
              variant="ghost"
              size="sm"
              icon="options-outline"
              onPress={() => router.push('/settings')}
              accessibilityHint="Opens app settings"
            />
          }
        />

        {loading ? (
          <View style={styles.loading}>
            <SkeletonShelf count={4} />
            <SkeletonShelf count={4} />
            <SkeletonList count={4} />
          </View>
        ) : error ? (
          <ErrorState
            title="Couldn’t load your library"
            message={error.message}
            onRetry={reload}
          />
        ) : (
          <View style={styles.shelves}>
            {hasTrending ? (
              <Shelf
                title={trending!.title}
                tracks={trending!.tracks}
                reason={trending!.reason}
                onSelect={(track: Track, queue) => play({ track, queue, context: 'recommendation' })}
              />
            ) : null}

            {data?.shelves.map((shelf) => (
              <Shelf
                key={shelf.id}
                title={shelf.title}
                tracks={shelf.tracks}
                reason={shelf.reason}
                onSelect={(track: Track, queue) => play({ track, queue, context: 'recommendation' })}
              />
            ))}

            {data && !hasShelves && !hasTrending ? (
              data.isColdStart ? (
                <EmptyState
                  icon={<Ionicons name="search" size={34} color={colors.textTertiary} />}
                  title="Nothing to show yet"
                  message={
                    isOnline
                      ? 'Search for a song, a remix, a cover or a DJ mix — everything you play builds your library and your recommendations.'
                      : 'You are offline and have no listening history yet. Connect to search for music.'
                  }
                  action={
                    <Button
                      label="Search music"
                      icon="search"
                      onPress={() => router.push('/(tabs)/search')}
                      style={styles.cta}
                    />
                  }
                />
              ) : (
                <EmptyState
                  title="Your shelves are empty"
                  message="Play something and it will show up here."
                  action={
                    <Button
                      label="Find something"
                      variant="secondary"
                      icon="search"
                      onPress={() => router.push('/(tabs)/search')}
                    />
                  }
                />
              )
            ) : null}

            {data && data.shelves.length > 0 ? <PersonalStats data={data} /> : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Bottom summary of local signals — makes the recommender's inputs legible. */
function PersonalStats({ data }: { data: NonNullable<ReturnType<typeof useHomeData>['data']> }) {
  const totalPlays = data.topGenres.reduce((sum, entry) => sum + entry.playCount, 0);
  if (totalPlays === 0 && data.topArtists.length === 0) return null;

  return (
    <View style={styles.stats}>
      <SectionHeader title="Your listening" />
      <View style={styles.statGrid}>
        <StatTile label="Tracks you play" value={String(totalPlays)} />
        <StatTile
          label="Top artist"
          value={data.topArtists[0]?.name ?? '—'}
          caption={data.topArtists[0] ? pluralize(data.topArtists[0].playCount, 'play') : undefined}
        />
        <StatTile
          label="Top genre"
          value={data.topGenres[0]?.genre ?? '—'}
          caption={data.topGenres[0] ? pluralize(data.topGenres[0].playCount, 'play') : undefined}
        />
      </View>
      <Text variant="caption" color={colors.textTertiary} style={styles.statsNote}>
        Recommendations are generated on-device from this history — nothing is uploaded.
      </Text>
    </View>
  );
}

function StatTile({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <View style={styles.tile}>
      <Text variant="caption" color={colors.textTertiary}>
        {label}
      </Text>
      <Text variant="subheading" numberOfLines={1}>
        {value}
      </Text>
      {caption ? (
        <Text variant="micro" color={colors.textDisabled}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

function describeLibrary(data: NonNullable<ReturnType<typeof useHomeData>['data']>): string {
  const plays = data.topGenres.reduce((sum, entry) => sum + entry.playCount, 0);
  return plays > 0 ? `${pluralize(plays, 'local play')} · on-device` : 'On-device library';
}

const styles = StyleSheet.create({
  content: { paddingBottom: MINIPLAYER_BOTTOM_PADDING },
  loading: { gap: spacing.xl, paddingTop: spacing.md },
  shelves: { gap: spacing.xxl, paddingTop: spacing.sm },
  cta: { marginTop: spacing.sm },
  stats: { gap: spacing.sm },
  statGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  tile: {
    flex: 1,
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundElement,
  },
  statsNote: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
});