import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { Playlist, Track } from '@/types';
import type { HistoryEntry } from '@/services/database';
import { colors, radius, spacing } from '@/theme/colors';
import { formatArtistNames, formatDuration, formatRelativeTime, pluralize } from '@/utils/format';
import {
  useCreatePlaylist,
  useFavorites,
  useHistoryPage,
  useLibraryStats,
  useMostPlayed,
  usePlaylists,
  useRecentlyPlayed,
  useTopGenres,
} from '@/hooks/useLibrary';
import { usePlayback } from '@/hooks/usePlayback';
import { MINIPLAYER_BOTTOM_PADDING } from '@/hooks/useMiniPlayer';
import { Button, Chip, ListRow, Segmented } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  EmptyState,
  ErrorState,
  Screen,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
} from '@/components/ui/Feedback';
import { OfflineBanner } from '@/components/media/OfflineBanner';
import { TrackActionsSheet, TrackRow } from '@/components/media';
import { Text } from '@/components/ui/Text';

/**
 * Library.
 *
 * Everything here is local: favourites, playlists, history and stats come
 * straight out of SQLite. That is deliberate — the library has to be useful
 * with no network at all, and it is also the source of truth the Phase 5
 * recommender scores against.
 */

type TabId = 'favorites' | 'playlists' | 'history';

/** One screenful of history; the feed pages on demand through "Load more". */
const HISTORY_PAGE_SIZE = 50;

const TABS: readonly { value: TabId; label: string }[] = [
  { value: 'favorites', label: 'Favourites' },
  { value: 'playlists', label: 'Playlists' },
  { value: 'history', label: 'History' },
];

export default function LibraryScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('favorites');

  const stats = useLibraryStats();
  const playlists = usePlaylists();
  const favorites = useFavorites();
  const favoriteTracks = useMemo(() => favorites.data?.pages.flat() ?? [], [favorites.data]);
  const genres = useTopGenres(10);
  const recent = useRecentlyPlayed(20);
  const history = useHistoryPage(HISTORY_PAGE_SIZE);
  const historyEntries = useMemo(() => history.data?.pages.flat() ?? [], [history.data]);
  const mostPlayed = useMostPlayed(10);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const { play } = usePlayback();

  const loading = stats.isLoading || playlists.isLoading;
  const error = stats.error ?? playlists.error;

  /**
   * "Play all" queues the whole list, not just the pages on screen: the queue
   * is built once, so any favourites the user has not scrolled to would
   * otherwise silently never play. Bounded so a pathological library cannot
   * spin here — 30 pages is 3,000 tracks.
   */
  const playAllFavorites = async () => {
    let pages = favorites.data?.pages ?? [];
    let hasNext: boolean | undefined = favorites.hasNextPage;
    let guard = 0;
    while (hasNext && guard < 30) {
      const next = await favorites.fetchNextPage();
      pages = next.data?.pages ?? pages;
      hasNext = next.hasNextPage;
      guard += 1;
    }
    const queue = pages.flat();
    if (queue.length > 0) play({ track: queue[0], queue, context: 'library' });
  };

  return (
    <Screen>
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Library"
          subtitle={stats.data ? describeStats(stats.data) : undefined}
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

        <View style={styles.tabs}>
          <Segmented options={TABS} value={tab} onChange={setTab} />
        </View>

        {loading ? (
          <SkeletonList count={6} />
        ) : error ? (
          <ErrorState
            title="Couldn’t load your library"
            message={error.message}
            onRetry={() => {
              void stats.refetch();
              void playlists.refetch();
            }}
          />
        ) : tab === 'favorites' ? (
          <FavoritesPanel
            favorites={favoriteTracks}
            total={stats.data?.favorites ?? favoriteTracks.length}
            genres={genres.data ?? []}
            recent={recent.data ?? []}
            onMenu={setMenuTrack}
            onPlayAll={() => void playAllFavorites()}
            hasMore={favorites.hasNextPage}
            loadingMore={favorites.isFetchingNextPage}
            onLoadMore={() => void favorites.fetchNextPage()}
          />
        ) : tab === 'playlists' ? (
          <PlaylistsPanel
            playlists={playlists.data ?? []}
            onOpen={(id) => router.push({ pathname: '/playlist/[id]', params: { id } })}
          />
        ) : (
          <HistoryPanel
            entries={historyEntries}
            mostPlayed={mostPlayed.data ?? []}
            hasMore={history.hasNextPage}
            loadingMore={history.isFetchingNextPage}
            onLoadMore={() => void history.fetchNextPage()}
          />
        )}
      </ScrollView>

      <TrackActionsSheet track={menuTrack} onClose={() => setMenuTrack(null)} />
    </Screen>
  );
}

/* --------------------------------------------------------------- favourites */

function FavoritesPanel({
  favorites,
  total,
  genres,
  recent,
  onMenu,
  onPlayAll,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  favorites: readonly Track[];
  total: number;
  genres: readonly { genre: string; playCount: number }[];
  recent: readonly Track[];
  onMenu: (track: Track) => void;
  onPlayAll: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const router = useRouter();
  const { play } = usePlayback();

  if (favorites.length === 0) {
    return (
      <EmptyState
        icon={<Ionicons name="heart-outline" size={32} color={colors.textTertiary} />}
        title="No favourites yet"
        message="Tap the heart on any track and it is stored on-device — available offline, for good."
        action={
          <Button label="Find music" icon="search" onPress={() => router.push('/(tabs)/search')} />
        }
      />
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.playAllRow}>
        <Button label="Play all" icon="play" onPress={onPlayAll} />
        <Text variant="caption" color={colors.textTertiary}>
          {pluralize(total, 'track')}
        </Text>
      </View>

      <View style={styles.card}>
        {favorites.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            favorite
            onMenuPress={onMenu}
            onPress={(selected) => play({ track: selected, queue: favorites, context: 'library' })}
            style={styles.row}
          />
        ))}
      </View>

      {hasMore ? (
        <Button
          label="Load more"
          variant="ghost"
          size="sm"
          icon="chevron-down"
          loading={loadingMore}
          onPress={onLoadMore}
          style={styles.loadMore}
        />
      ) : null}

      <SectionHeader title="Your top genres" />
      {genres.length > 0 ? (
        <View style={styles.chipRail}>
          {genres.map((entry, index) => (
            <Chip
              key={entry.genre}
              label={`${entry.genre} · ${pluralize(entry.playCount, 'play')}`}
              selected={index === 0}
            />
          ))}
        </View>
      ) : (
        <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
          Genres appear once you have played something.
        </Text>
      )}

      <SectionHeader title="Jump back in" />
      <View style={styles.card}>
        {recent.slice(0, 6).map((track) => (
          <ListRow
            key={track.id}
            title={track.title}
            subtitle={formatArtistNames(track.artistNames)}
            leftIcon="musical-note-outline"
            onPress={() => play({ track, queue: recent, context: 'library' })}
            style={styles.row}
          />
        ))}
        {recent.length === 0 ? (
          <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
            Play a favourite to see it here.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- playlists */

function PlaylistsPanel({
  playlists,
  onOpen,
}: {
  playlists: readonly Playlist[];
  onOpen: (id: string) => void;
}) {
  const createPlaylist = useCreatePlaylist();
  const [name, setName] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    createPlaylist.mutate({ name: trimmed });
    setName('');
  };

  return (
    <View style={styles.panel}>
      <View style={styles.createRow}>
        <Input
          icon="add"
          placeholder="New playlist name"
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
          returnKeyType="done"
          maxLength={80}
          autoCapitalize="words"
          accessibilityLabel="New playlist name"
          containerStyle={styles.createInput}
        />
        <Button label="Create" onPress={submit} disabled={name.trim().length === 0} />
      </View>

      {playlists.length === 0 ? (
        <EmptyState
          icon={<Ionicons name="list-outline" size={30} color={colors.textTertiary} />}
          title="No playlists yet"
          message="Group tracks however you like — mood, artist, workout, whatever."
        />
      ) : (
        <View style={styles.card}>
          {playlists.map((playlist) => (
            <ListRow
              key={playlist.id}
              title={playlist.name}
              subtitle={describePlaylist(playlist)}
              leftIcon={playlist.system ? 'sparkles-outline' : 'musical-notes-outline'}
              onPress={() => onOpen(playlist.id)}
              style={styles.row}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ history */

function HistoryPanel({
  entries,
  mostPlayed,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  entries: readonly HistoryEntry[];
  mostPlayed: readonly Track[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const { play } = usePlayback();

  // One queue for the whole page, so tapping any row plays forward through the
  // same list the user is looking at.
  const queue = useMemo(() => entries.map((entry) => entry.track), [entries]);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Ionicons name="time-outline" size={32} color={colors.textTertiary} />}
        title="No listening history"
        message="Once you play something it is recorded here and starts shaping your recommendations."
      />
    );
  }

  return (
    <View style={styles.panel}>
      <SectionHeader title="Recently played" />
      <View style={styles.card}>
        {entries.map((entry, index) => (
          <ListRow
            key={`${entry.track.id}-${entry.playedAt}-${index}`}
            title={entry.track.title}
            subtitle={describeHistoryEntry(entry)}
            leftIcon={entry.completed ? 'checkmark-circle-outline' : 'play-outline'}
            onPress={() => play({ track: entry.track, queue, context: 'history' })}
            style={styles.row}
          />
        ))}
      </View>

      {hasMore ? (
        <Button
          label="Load more"
          variant="ghost"
          size="sm"
          icon="chevron-down"
          loading={loadingMore}
          onPress={onLoadMore}
          style={styles.loadMore}
        />
      ) : null}

      {mostPlayed.length > 0 ? (
        <>
          <SectionHeader title="Most played" />
          <View style={styles.card}>
            {mostPlayed.map((track) => (
              <ListRow
                key={track.id}
                title={track.title}
                subtitle={formatArtistNames(track.artistNames)}
                leftIcon="trophy-outline"
                onPress={() => play({ track, queue: mostPlayed, context: 'history' })}
                style={styles.row}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ helpers */

/** `Daft Punk — Around the World · 2h ago · 3:42 played` */
function describeHistoryEntry(entry: HistoryEntry): string {
  const parts = [formatArtistNames(entry.track.artistNames), formatRelativeTime(entry.playedAt)];
  if (entry.playMs > 0) parts.push(`${formatDuration(entry.playMs)} played`);
  return parts.join(' · ');
}

function describePlaylist(playlist: Playlist): string | undefined {
  const count = playlist.trackCount;
  const label = count === undefined ? undefined : pluralize(count, 'track');
  if (label && playlist.description) return `${label} · ${playlist.description}`;
  return label ?? playlist.description;
}

function describeStats(stats: { tracks: number; favorites: number; playlists: number }): string {
  return [
    pluralize(stats.favorites, 'favourite'),
    pluralize(stats.playlists, 'playlist'),
    `${stats.tracks} cached`,
  ].join(' · ');
}

const styles = StyleSheet.create({
  content: { paddingBottom: MINIPLAYER_BOTTOM_PADDING },
  tabs: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  panel: { gap: spacing.md },
  playAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  chipRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  hint: { paddingHorizontal: spacing.lg },
  loadMore: { alignSelf: 'center' },
  card: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundElevated,
    overflow: 'hidden',
  },
  row: { paddingHorizontal: spacing.md },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  createInput: { flex: 1 },
});