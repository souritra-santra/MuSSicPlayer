import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Album, Artist, SearchResult, SearchSection } from '@/types';
import { colors, radius, spacing } from '@/theme/colors';
import { formatArtistNames } from '@/utils/format';
import { providerLabel } from '@/components/media/SourceBadge';
import { Chip, IconButton } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Feedback';
import { Text } from '@/components/ui/Text';
import { Artwork, ArtistAvatar, TrackRow } from '@/components/media';

/**
 * Search results rendering.
 *
 * Sections come pre-grouped from `services/search`, so this file is only about
 * presentation: a shared "play all" action per section, plus artists and albums
 * as their own compact rows.
 */

export type SearchResultsProps = {
  sections: readonly SearchSection[];
  onSelectTrack: (track: SearchResult['track'], queue: readonly SearchResult['track'][]) => void;
  onToggleFavorite: (track: SearchResult['track']) => void;
  isFavorite: (trackId: string) => boolean;
  onSelectArtist: (artist: Artist) => void;
  onSelectAlbum: (album: Album) => void;
  /** Opens the per-track action sheet. */
  onTrackMenu?: (track: SearchResult['track']) => void;
};

/**
 * Warning shown when some providers failed. Partial results beat an error, so
 * this is informational rather than a blocking state.
 */
export function PartialResultsWarning({ providers }: { providers: readonly string[] }) {
  if (providers.length === 0) return null;
  return (
    <View style={styles.warning}>
      <Ionicons name="warning-outline" size={14} color={colors.warning} />
      <Text variant="micro" color={colors.warning} style={styles.warningText}>
        {providers.map(providerLabel).join(', ')} did not respond — showing partial results.
      </Text>
    </View>
  );
}

/** Renders every section in order. */
export function SearchResultsList({
  sections,
  onSelectTrack,
  onToggleFavorite,
  isFavorite,
  onSelectArtist,
  onSelectAlbum,
  onTrackMenu,
}: SearchResultsProps) {
  return (
    <View style={styles.list}>
      {sections.map((section) => {
        if (section.id === 'artists' && section.artists && section.artists.length > 0) {
          return (
            <ArtistRow
              key={section.id}
              artists={section.artists}
              onSelect={onSelectArtist}
            />
          );
        }

        if (section.id === 'albums' && section.albums && section.albums.length > 0) {
          return (
            <AlbumRow key={section.id} albums={section.albums} onSelect={onSelectAlbum} />
          );
        }

        if (section.tracks.length === 0) return null;

        const queue = section.tracks.map((entry) => entry.track);

        return (
          <View key={section.id} style={styles.section}>
            <SectionHeader title={section.title} />
            <View>
              {section.tracks.map((entry, index) => (
                <TrackRow
                  key={`${entry.track.id}-${index}`}
                  track={entry.track}
                  showProvider={section.id === 'other-sources'}
                  favorite={isFavorite(entry.track.id)}
                  onToggleFavorite={onToggleFavorite}
                  onMenuPress={onTrackMenu}
                  onPress={(track) => onSelectTrack(track, queue)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ArtistRow({ artists, onSelect }: { artists: readonly Artist[]; onSelect: (a: Artist) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.cardRail}>
      {artists.map((artist) => (
        <View key={artist.id} style={styles.artistCard}>
          <ArtistAvatar uri={artist.artworkUrl} name={artist.name} size={112} />
          <Text variant="bodySmall" numberOfLines={1}>
            {artist.name}
          </Text>
          <Chip label={providerLabel(artist.provider)} />
          <IconButton
            name="chevron-forward"
            size={14}
            color={colors.textTertiary}
            accessibilityLabel={`Open ${artist.name}`}
            onPress={() => onSelect(artist)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function AlbumRow({ albums, onSelect }: { albums: readonly Album[]; onSelect: (a: Album) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.cardRail}>
      {albums.map((album) => (
        <View key={album.id} style={styles.albumCard}>
          <Artwork uri={album.artworkUrl} seed={album.id} size={112} cache="disk" />
          <Text variant="bodySmall" numberOfLines={1}>
            {album.title}
          </Text>
          <Text variant="micro" color={colors.textTertiary} numberOfLines={1}>
            {album.artistName || formatArtistNames([album.artistName])}
          </Text>
          <IconButton
            name="chevron-forward"
            size={14}
            color={colors.textTertiary}
            accessibilityLabel={`Open ${album.title}`}
            onPress={() => onSelect(album)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
  },
  warningText: { flexShrink: 1 },
  list: { gap: spacing.xxl },
  section: { gap: spacing.xs },
  cardRail: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  artistCard: { width: 112, gap: spacing.xs, alignItems: 'flex-start' },
  albumCard: { width: 112, gap: spacing.xs },
});