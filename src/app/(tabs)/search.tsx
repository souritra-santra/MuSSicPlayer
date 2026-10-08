import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { Album, Artist, Track } from '@/types';
import { colors, radius, spacing } from '@/theme/colors';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useLocalSuggestions, useUnifiedSearch } from '@/hooks/useSearchQuery';
import { usePlayback } from '@/hooks/usePlayback';
import { useRelatedTracks, type RelatedMusicResult } from '@/hooks/useRelatedTracks';
import { useRecentSearches, useFavoriteStates, useToggleFavorite } from '@/hooks/useLibrary';
import { useSearchQueryState } from '@/hooks/useSearch';
import { MINIPLAYER_BOTTOM_PADDING } from '@/hooks/useMiniPlayer';
import { useSettingsStore } from '@/store/settings';
import {
  PartialResultsWarning,
  SearchResultsList,
} from '@/features/search/SearchResultsList';
import { Button, Chip } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  EmptyState,
  ErrorState,
  Screen,
  ScreenHeader,
  SkeletonList,
} from '@/components/ui/Feedback';
import { OfflineBanner } from '@/components/media/OfflineBanner';
import { TrackActionsSheet } from '@/components/media/TrackActionsSheet';
import { Shelf } from '@/features/home/HomeShelves';
import type { RecommendedShelf } from '@/services/recommendations';
import { Text } from '@/components/ui/Text';

/**
 * Search.
 *
 * Live results as the user types (debounced at the hook level), plus quick
 * filters for the variant categories instruction.md calls out: remixes, covers,
 * DJ mixes and instrumentals.
 */

/** Filters map onto `TrackKind` buckets the provider fan-out understands. */
const FILTERS = [
  { id: 'all', label: 'All', kinds: undefined },
  { id: 'remix', label: 'Remixes', kinds: ['remix', 'dj-mix', 'extended'] as const },
  { id: 'cover', label: 'Covers', kinds: ['cover'] as const },
  { id: 'live', label: 'Live', kinds: ['live'] as const },
  { id: 'instrumental', label: 'Instrumental', kinds: ['instrumental', 'karaoke'] as const },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

export default function SearchScreen() {
  const router = useRouter();
  const { input, setInput, query, clear, isTyping } = useSearchQueryState();
  const [filter, setFilter] = useState<FilterId>('all');

  const { data, isFetching, error, refetch } = useUnifiedSearch(query);
  const { data: suggestions } = useLocalSuggestions(query);
  const { data: recentSearches } = useRecentSearches(6);
  const { play } = usePlayback();
  const toggleFavorite = useToggleFavorite();
  const excludeExplicit = useSettingsStore((state) => state.excludeExplicit);
  const { isOnline } = useConnectivity();

  const activeFilter = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0];

  // Client-side filter refinement: the provider fan-out already ranked, and for
  // the demo/local case applying the filter here avoids another network round.
  const sections = useMemo(() => {
    if (!data) return [];
    if (!activeFilter.kinds) return data.sections;

    const kinds = new Set<string>(activeFilter.kinds);
    return data.sections
      .map((section) => ({
        ...section,
        tracks: section.tracks.filter((entry) => kinds.has(entry.track.kind)),
      }))
      .filter((section) => section.tracks.length > 0 || section.artists || section.albums);
  }, [data, activeFilter]);

  const hasResults = sections.some(
    (section) => section.tracks.length > 0 || (section.artists?.length ?? 0) > 0 || (section.albums?.length ?? 0) > 0,
  );

  // One query for the heart state of every visible track, instead of one per
  // row. `useFavoriteStates` caps the id list, so very long result sets fall
  // back to "not favourited" beyond the cap rather than issuing N queries.
  const visibleTrackIds = useMemo(
    () =>
      sections.flatMap((section) => section.tracks.map((entry) => entry.track.id)),
    [sections],
  );

  // Seed for the bottom "More from this artist / Related music" rails.
  const bestMatch = useMemo(
    () => sections.find((section) => section.id === 'best-match')?.tracks[0]?.track ?? null,
    [sections],
  );
  const { related } = useRelatedTracks(bestMatch, visibleTrackIds);
  const { data: favoriteStates } = useFavoriteStates(visibleTrackIds);
  const isFavorite = useCallback(
    (trackId: string) => favoriteStates?.has(trackId) ?? false,
    [favoriteStates],
  );

  const handleSelectTrack = useCallback(
    (track: Track, queue: readonly Track[]) => {
      play({ track, queue, context: 'search' });
    },
    [play],
  );

  const handleSelectArtist = useCallback(
    (artist: Artist) => router.push({ pathname: '/artist/[id]', params: { id: artist.id } }),
    [router],
  );

  // Held at screen level so the sheet keeps its own back handling while the
  // result list beneath it is free to re-query.
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);

  const handleSelectAlbum = useCallback(
    (album: Album) => router.push({ pathname: '/album/[id]', params: { id: album.id } }),
    [router],
  );

  return (
    <Screen>
      <OfflineBanner />
      <View style={styles.header}>
        <ScreenHeader title="Search" />
        <View style={styles.searchRow}>
          <Input
            icon="search"
            placeholder="Songs, artists, remixes, covers, DJ mixes"
            value={input}
            onChangeText={setInput}
            onClear={clear}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search music"
            containerStyle={styles.input}
          />
          {isFetching ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </View>

        <View style={styles.filters}>
          {FILTERS.map((entry) => (
            <Chip
              key={entry.id}
              label={entry.label}
              selected={entry.id === filter}
              onPress={() => setFilter(entry.id)}
            />
          ))}
        </View>

        {excludeExplicit ? (
          <View style={styles.noticeRow}>
            <Ionicons name="eye-off-outline" size={12} color={colors.textTertiary} />
            <Text variant="micro" color={colors.textTertiary}>
              Explicit tracks are hidden
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <ScrollView
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          {error ? (
            <ErrorState
              title="Search failed"
              message={error.message}
              onRetry={() => void refetch()}
            />
          ) : !isTyping ? (
            <RecentSearches
              queries={recentSearches ?? []}
              onSelect={(value) => setInput(value)}
            />
          ) : !isOnline ? (
            <EmptyState
              icon={<Ionicons name="cloud-offline-outline" size={32} color={colors.textTertiary} />}
              title="You’re offline"
              message="Search needs a connection. Your library and saved searches still work."
            />
          ) : isFetching && !data ? (
            <SkeletonList count={7} />
          ) : hasResults ? (
            <>
              <PartialResultsWarning providers={data?.failedProviders ?? []} />
              <SearchResultsList
                sections={sections}
                onSelectTrack={handleSelectTrack}
                onToggleFavorite={(track) => toggleFavorite.mutate(track.id)}
                isFavorite={isFavorite}
                onSelectArtist={handleSelectArtist}
                onSelectAlbum={handleSelectAlbum}
                onTrackMenu={setMenuTrack}
              />
              <RelatedMusic related={related} onSelectTrack={handleSelectTrack} />
            </>
          ) : suggestions && suggestions.length > 0 ? (
            <View>
              <Text variant="caption" color={colors.textTertiary} style={styles.suggestionsLabel}>
                From your library
              </Text>
              {suggestions.map((entry) => (
                <Button
                  key={entry.track.id}
                  label={`${entry.track.title} — ${entry.track.artistNames.join(', ')}`}
                  variant="ghost"
                  onPress={() => setInput(entry.track.title)}
                  style={styles.suggestion}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={<Ionicons name="search" size={32} color={colors.textTertiary} />}
              title="No results"
              message={`Nothing matched “${query}”. Try a different spelling, or search for the artist.`}
            />
          )}
        </ScrollView>
      </View>

      <TrackActionsSheet track={menuTrack} onClose={() => setMenuTrack(null)} />
    </Screen>
  );
}

function RecentSearches({
  queries,
  onSelect,
}: {
  queries: readonly string[];
  onSelect: (query: string) => void;
}) {
  if (queries.length === 0) {
    return (
      <EmptyState
        icon={<Ionicons name="time-outline" size={30} color={colors.textTertiary} />}
        title="Search for music"
        message="Unified search across every enabled source — songs, remixes, covers, live versions, DJ mixes and instrumentals."
      />
    );
  }

  return (
    <View style={styles.recent}>
      <Text variant="caption" color={colors.textTertiary} style={styles.recentLabel}>
        Recent searches
      </Text>
      <View style={styles.recentChips}>
        {queries.map((value) => (
          <Chip
            key={value}
            label={value}
            icon="time-outline"
            onPress={() => onSelect(value)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * "More from this artist" / "Related music" rails under the results, seeded by
 * the best match and sourced from the local catalogue (see Phase 5).
 */
function RelatedMusic({
  related,
  onSelectTrack,
}: {
  related: RelatedMusicResult | null;
  onSelectTrack: (track: Track, queue: readonly Track[]) => void;
}) {
  if (!related) return null;

  const shelves = [related.sameArtist, related.moreLikeThis].filter(
    (shelf): shelf is RecommendedShelf => shelf !== null,
  );
  if (shelves.length === 0) return null;

  return (
    <View style={styles.related}>
      {shelves.map((shelf) => (
        <Shelf
          key={shelf.id}
          title={shelf.title}
          tracks={shelf.tracks}
          reason={shelf.reason}
          onSelect={onSelectTrack}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  input: { flex: 1 },
  filters: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flexWrap: 'wrap',
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  body: { flex: 1 },
  bodyContent: { paddingTop: spacing.lg, paddingBottom: MINIPLAYER_BOTTOM_PADDING },
  recent: { gap: spacing.md, paddingHorizontal: spacing.lg },
  recentLabel: {},
  recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  suggestionsLabel: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  suggestion: { justifyContent: 'flex-start', borderRadius: radius.sm },
  related: { gap: spacing.xxl, paddingTop: spacing.xl },
});