import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '@/types';
import { colors, spacing } from '@/theme/colors';
import { pluralize } from '@/utils/format';
import { useAlbumDetail } from '@/hooks/useDetails';
import { usePlayback } from '@/hooks/usePlayback';
import { MINIPLAYER_BOTTOM_PADDING } from '@/hooks/useMiniPlayer';
import { Button, IconButton } from '@/components/ui/Button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  SectionHeader,
} from '@/components/ui/Feedback';
import { Artwork, TrackActionsSheet, TrackRow } from '@/components/media';
import { Text } from '@/components/ui/Text';

/**
 * Album page.
 *
 * Tracks are numbered rather than showing artwork — album order matters more
 * than visual weight here, and skipping 50 thumbnails keeps scrolling cheap on
 * low-memory devices.
 */

export default function AlbumScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useAlbumDetail(id ?? '');
  const { play } = usePlayback();
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);

  const album = data?.album ?? null;
  const tracks = data?.tracks ?? [];

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.headerBar}>
        <IconButton name="arrow-back" accessibilityLabel="Go back" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <LoadingState label="Loading album…" />
        ) : error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : !album ? (
          <EmptyState
            icon={<Ionicons name="albums-outline" size={34} color={colors.textTertiary} />}
            title="Album not cached"
            message="This album has not been stored on this device yet. Search for it first, then open the result."
            action={
              <Button label="Search" icon="search" onPress={() => router.replace('/(tabs)/search')} />
            }
          />
        ) : (
          <>
            <View style={styles.hero}>
              <Artwork uri={album.artworkUrl} seed={album.id} size={180} rounded={false} cache="disk" />
              <View style={styles.heroText}>
                <Text variant="title" numberOfLines={2}>
                  {album.title}
                </Text>
                <Text variant="bodySmall" color={colors.textSecondary}>
                  {album.artistName || 'Unknown artist'}
                  {album.year ? ` · ${album.year}` : ''}
                </Text>
                <Text variant="caption" color={colors.textTertiary}>
                  {pluralize(tracks.length, 'cached track')}
                </Text>
                {tracks.length > 0 ? (
                  <Button
                    label="Play album"
                    icon="play"
                    onPress={() => play({ track: tracks[0], queue: tracks, context: 'album' })}
                    style={styles.playAll}
                  />
                ) : null}
              </View>
            </View>

            {tracks.length > 0 ? (
              <>
                <SectionHeader title="Tracks" />
                <View>
                  {tracks.map((track, index) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      index={index}
                      onMenuPress={setMenuTrack}
                      onPress={(selected) => play({ track: selected, queue: tracks, context: 'album' })}
                    />
                  ))}
                </View>
              </>
            ) : (
              <EmptyState
                icon={<Ionicons name="disc-outline" size={32} color={colors.textTertiary} />}
                title="No cached tracks"
                message="Search for this album to add it to your library."
              />
            )}
          </>
        )}
      </ScrollView>

      <TrackActionsSheet track={menuTrack} onClose={() => setMenuTrack(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBar: { flexDirection: 'row', alignItems: 'center' },
  content: { paddingBottom: MINIPLAYER_BOTTOM_PADDING },
  hero: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  heroText: { flex: 1, gap: spacing.xs, justifyContent: 'center' },
  playAll: { marginTop: spacing.md, alignSelf: 'flex-start' },
});