import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Track } from '@/types';
import { colors, radius, spacing } from '@/theme/colors';
import { formatArtistNames } from '@/utils/format';
import { useAddToPlaylist, usePlaylists, useRemoveFromPlaylist } from '@/hooks/useLibrary';
import { usePlayback } from '@/hooks/usePlayback';
import { useToast } from '@/hooks/useToast';

import { Artwork } from './Artwork';
import { ListRow } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';

/**
 * Per-track action sheet.
 *
 * One sheet for every list in the app so "play next", "add to queue" and the
 * playlist actions behave identically wherever a track appears. A bottom sheet
 * rather than an alert dialog because the action list grows with context (a
 * playlist screen adds "remove from this playlist").
 *
 * The playlist picker is an inline sub-view rather than a second modal: two
 * stacked modals on Android are a reliable source of back-button bugs.
 */

export type TrackActionsSheetProps = {
  /** `null` closes the sheet. */
  track: Track | null;
  onClose: () => void;
  /** When set, "Remove from this playlist" is offered. */
  playlistId?: string;
};

type Pane = 'actions' | 'playlists';

export function TrackActionsSheet({ track, onClose, playlistId }: TrackActionsSheetProps) {
  const insets = useSafeAreaInsets();
  const [pane, setPane] = useState<Pane>('actions');

  const close = () => {
    setPane('actions');
    onClose();
  };

  return (
    <Modal
      visible={track !== null}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close menu" />

      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        {track ? (
          <View style={styles.header}>
            <Artwork uri={track.artworkUrl} seed={track.id} size={44} />
            <View style={styles.headerText}>
              <Text variant="bodySmall" numberOfLines={1}>
                {track.title}
              </Text>
              <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
                {formatArtistNames(track.artistNames)}
              </Text>
            </View>
          </View>
        ) : null}

        {pane === 'actions' ? (
          <Actions
            track={track}
            playlistId={playlistId}
            onChoosePlaylist={() => setPane('playlists')}
            onDone={close}
          />
        ) : (
          <PlaylistPicker track={track} onClose={close} />
        )}
      </View>
    </Modal>
  );
}

function Actions({
  track,
  playlistId,
  onChoosePlaylist,
  onDone,
}: {
  track: Track | null;
  playlistId?: string;
  onChoosePlaylist: () => void;
  onDone: () => void;
}) {
  const { playNext, addToQueue } = usePlayback();
  const removeFromPlaylist = useRemoveFromPlaylist();

  if (!track) return null;

  return (
    <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
      <ListRow
        title="Play next"
        subtitle="Insert at the front of the queue"
        leftIcon="play-forward-outline"
        onPress={() => {
          playNext(track);
          onDone();
        }}
      />
      <ListRow
        title="Add to queue"
        subtitle="Append to the end"
        leftIcon="list-outline"
        onPress={() => {
          addToQueue(track);
          onDone();
        }}
      />
      <ListRow
        title="Add to playlist"
        leftIcon="albums-outline"
        onPress={onChoosePlaylist}
      />
      {playlistId ? (
        <ListRow
          title="Remove from this playlist"
          leftIcon="remove-circle-outline"
          onPress={() => {
            removeFromPlaylist.mutate({ playlistId, trackId: track.id });
            onDone();
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function PlaylistPicker({ track, onClose }: { track: Track | null; onClose: () => void }) {
  const { data: playlists } = usePlaylists();
  const addToPlaylist = useAddToPlaylist();
  const toast = useToast();

  if (!track) return null;

  const items = playlists ?? [];

  return (
    <View style={styles.picker}>
      <Text label color={colors.textTertiary} style={styles.pickerTitle}>
        Add to playlist
      </Text>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {items.map((playlist) => (
          <ListRow
            key={playlist.id}
            title={playlist.name}
            subtitle={playlist.system ? 'Built-in' : undefined}
            leftIcon="musical-notes-outline"
            onPress={() => {
              addToPlaylist.mutate({ playlistId: playlist.id, trackId: track.id });
              toast.show(`Added to ${playlist.name}`, 'success');
              onClose();
            }}
          />
        ))}
        {items.length === 0 ? (
          <Text variant="caption" color={colors.textTertiary} style={styles.pickerEmpty}>
            No playlists yet — create one from the Library tab.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.backgroundElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerText: { flex: 1, gap: 1 },
  list: { maxHeight: 360 },
  picker: { paddingBottom: spacing.xs },
  pickerTitle: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  pickerEmpty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
});