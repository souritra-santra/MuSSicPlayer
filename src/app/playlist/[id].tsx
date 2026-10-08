import { ScrollView, StyleSheet, Modal, Pressable, View } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '@/types';
import { colors, radius, spacing } from '@/theme/colors';
import { pluralize } from '@/utils/format';
import {
  useDeletePlaylist,
  usePlaylist,
  usePlaylistTracks,
  useRenamePlaylist,
} from '@/hooks/useLibrary';
import { usePlayback } from '@/hooks/usePlayback';
import { useToast } from '@/hooks/useToast';
import { MINIPLAYER_BOTTOM_PADDING } from '@/hooks/useMiniPlayer';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
 * Playlist detail.
 *
 * The one detail page that is fully local and fully functional in Phase 1 —
 * playlists are created and populated entirely on-device.
 */

export default function PlaylistScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = id ?? '';

  const { data: playlist, isLoading: loadingMeta, error: metaError } = usePlaylist(playlistId);
  const { data: tracks, isLoading: loadingTracks } = usePlaylistTracks(playlistId);
  const { play } = usePlayback();
  const deletePlaylist = useDeletePlaylist();
  const renamePlaylist = useRenamePlaylist();
  const toast = useToast();
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const loading = loadingMeta || loadingTracks;
  const error = metaError;
  const items = tracks ?? [];

  const handleDelete = () => {
    if (!playlist || playlist.system) return;
    deletePlaylist.mutate(playlistId, {
      onSuccess: (deleted) => {
        if (!deleted) {
          toast.show('Could not delete that playlist', 'error');
          return;
        }
        toast.show(`Deleted ${playlist.name}`, 'success');
        router.replace('/(tabs)/library');
      },
      onError: () => toast.show('Could not delete that playlist', 'error'),
    });
  };

  const startRename = () => {
    setRenameValue(playlist?.name ?? '');
    setRenaming(true);
  };

  const submitRename = () => {
    const name = renameValue.trim();
    if (name.length === 0 || name === playlist?.name) {
      setRenaming(false);
      return;
    }
    renamePlaylist.mutate(
      { id: playlistId, name },
      {
        onSuccess: (renamed) => {
          if (!renamed) {
            toast.show('Could not rename that playlist', 'error');
            return;
          }
          toast.show(`Renamed to ${name}`, 'success');
          setRenaming(false);
        },
        onError: () => toast.show('Could not rename that playlist', 'error'),
      },
    );
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.headerBar}>
        <IconButton name="arrow-back" accessibilityLabel="Go back" onPress={() => router.back()} />
        {playlist && !playlist.system ? (
          <View style={styles.headerActions}>
            <IconButton
              name="create-outline"
              size={18}
              color={colors.textTertiary}
              accessibilityLabel={`Rename ${playlist.name}`}
              onPress={startRename}
            />
            <IconButton
              name="trash-outline"
              size={18}
              color={colors.textTertiary}
              accessibilityLabel={`Delete ${playlist.name}`}
              onPress={handleDelete}
            />
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <LoadingState label="Loading playlist…" />
        ) : error ? (
          <ErrorState message={error.message} />
        ) : !playlist ? (
          <EmptyState
            icon={<Ionicons name="list-outline" size={34} color={colors.textTertiary} />}
            title="Playlist not found"
            message="It may have been deleted."
            action={
              <Button
                label="Back to library"
                onPress={() => router.replace('/(tabs)/library')}
              />
            }
          />
        ) : (
          <>
            <View style={styles.hero}>
              <Artwork uri={playlist.artworkUrl} seed={playlist.id} size={140} rounded={false} cache="disk" />
              <View style={styles.heroText}>
                <Text variant="title" numberOfLines={2}>
                  {playlist.name}
                </Text>
                {playlist.description ? (
                  <Text variant="bodySmall" color={colors.textSecondary} numberOfLines={3}>
                    {playlist.description}
                  </Text>
                ) : null}
                <Text variant="caption" color={colors.textTertiary}>
                  {pluralize(items.length, 'track')}
                </Text>
                {items.length > 0 ? (
                  <Button
                    label="Play all"
                    icon="play"
                    onPress={() => play({ track: items[0], queue: items, context: 'playlist' })}
                    style={styles.playAll}
                  />
                ) : null}
              </View>
            </View>

            {items.length > 0 ? (
              <>
                <SectionHeader title="Tracks" />
                <View>
                  {items.map((track, index) => (
                    <TrackRow
                      key={`${track.id}-${index}`}
                      track={track}
                      index={index}
                      onMenuPress={setMenuTrack}
                      onPress={(selected) => play({ track: selected, queue: items, context: 'playlist' })}
                    />
                  ))}
                </View>
              </>
            ) : (
              <EmptyState
                icon={<Ionicons name="add-circle-outline" size={32} color={colors.textTertiary} />}
                title="This playlist is empty"
                message="Open a track and add it from the row menu."
              />
            )}
          </>
        )}
      </ScrollView>

      <TrackActionsSheet
        track={menuTrack}
        playlistId={playlistId}
        onClose={() => setMenuTrack(null)}
      />

      <Modal
        visible={renaming}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setRenaming(false)}>
        <Pressable
          style={styles.dialogScrim}
          onPress={() => setRenaming(false)}
          accessibilityLabel="Close rename dialog"
        />
        <View style={styles.dialogCenter} pointerEvents="box-none">
          <View style={styles.dialog}>
            <Text variant="title" numberOfLines={1}>
              Rename playlist
            </Text>
            <Input
              icon="list-outline"
              value={renameValue}
              onChangeText={setRenameValue}
              onSubmitEditing={submitRename}
              returnKeyType="done"
              maxLength={80}
              autoCapitalize="words"
              autoFocus
              selectTextOnFocus
              accessibilityLabel="Playlist name"
              containerStyle={styles.dialogInput}
            />
            <View style={styles.dialogButtons}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setRenaming(false)}
              />
              <Button
                label="Save"
                onPress={submitRename}
                disabled={renameValue.trim().length === 0}
                loading={renamePlaylist.isPending}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  content: { paddingBottom: MINIPLAYER_BOTTOM_PADDING },
  dialogScrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  dialogCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundElevated,
  },
  dialogInput: { width: '100%' },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  hero: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  heroText: { flex: 1, gap: spacing.xs, justifyContent: 'center' },
  playAll: { marginTop: spacing.md, alignSelf: 'flex-start' },
});