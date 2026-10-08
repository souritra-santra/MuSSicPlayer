import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '@/types';
import { colors, spacing } from '@/theme/colors';
import { formatCount, pluralize } from '@/utils/format';
import { useArtistDetail } from '@/hooks/useDetails';
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
import { ArtistAvatar, TrackActionsSheet, TrackRow } from '@/components/media';
import { Text } from '@/components/ui/Text';

/**
 * Artist page.
 *
 * Shows what is already cached locally. Real provider-backed artist catalogues
 * land in Phase 2; until then the empty state says exactly what is missing
 * instead of rendering a blank screen.
 */

export default function ArtistScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useArtistDetail(id ?? '');
  const { play } = usePlayback();
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);

  const artist = data?.artist ?? null;
  const tracks = data?.tracks ?? [];

  const subtitle = artist
    ? [
        pluralize(tracks.length, 'cached track'),
        typeof artist.followers === 'number' && artist.followers > 0
          ? `${formatCount(artist.followers)} followers`
          : undefined,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.headerBar}>
        <IconButton name="arrow-back" accessibilityLabel="Go back" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <LoadingState label="Loading artist…" />
        ) : error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : !artist ? (
          <EmptyState
            icon={<Ionicons name="person-outline" size={34} color={colors.textTertiary} />}
            title="Artist not cached"
            message="This artist has not been stored on this device yet. Search for them first, then open the result."
            action={
              <Button label="Search" icon="search" onPress={() => router.replace('/(tabs)/search')} />
            }
          />
        ) : (
          <>
            <View style={styles.hero}>
              <ArtistAvatar uri={artist.artworkUrl} name={artist.name} size={112} />
              <Text variant="title" align="center">
                {artist.name}
              </Text>
              <Text variant="caption" color={colors.textTertiary}>
                {subtitle}
              </Text>
              {tracks.length > 0 ? (
                <Button
                  label="Play all"
                  icon="play"
                  onPress={() => play({ track: tracks[0], queue: tracks, context: 'artist' })}
                  style={styles.playAll}
                />
              ) : null}
            </View>

            {tracks.length > 0 ? (
              <>
                <SectionHeader title="From your cache" />
                <View>
                  {tracks.map((track) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      onMenuPress={setMenuTrack}
                      onPress={(selected) => play({ track: selected, queue: tracks, context: 'artist' })}
                    />
                  ))}
                </View>
              </>
            ) : (
              <EmptyState
                icon={<Ionicons name="disc-outline" size={32} color={colors.textTertiary} />}
                title="No cached tracks"
                message="Search for this artist to pull their catalogue into your library."
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
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  playAll: { marginTop: spacing.sm },
});