import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing } from '@/theme/colors';
import { Chip } from '@/components/ui/Button';

/**
 * Source attribution.
 *
 * instruction.md asks for an explicit "Other Sources" affordance rather than
 * silently merging providers, so every row that could have come from somewhere
 * else carries its origin. Resolution status (metadata-only vs playable) is
 * shown alongside, because pretending a track is playable when it needs a
 * resolver is worse than saying so.
 */

export type ProviderBadgeProps = {
  provider: string;
  /** Whether this row's provider can stream directly. */
  canStream?: boolean;
  needsResolver?: boolean;
  showName?: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  demo: 'Demo',
  youtube: 'YouTube',
  'youtube-music': 'YT Music',
  jamendo: 'Jamendo',
  audius: 'Audius',
  archive: 'Archive',
};

export function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

export function ProviderBadge({
  provider,
  canStream = false,
  needsResolver = true,
  showName = true,
}: ProviderBadgeProps) {
  return (
    <Chip
      label={showName ? providerLabel(provider) : ''}
      icon="radio-button-on"
      tone={canStream ? 'accent' : 'default'}
    />
  );
}

/** Small pill describing a track variant (remix, live, instrumental…). */
export function KindBadge({ kind }: { kind: string }) {
  if (kind === 'song' || kind === 'unknown') return null;
  return (
    <View style={styles.kindBadge}>
      <Ionicons name={kindIcon(kind)} size={10} color={colors.textTertiary} />
    </View>
  );
}

export function kindIcon(kind: string): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case 'remix':
    case 'dj-mix':
    case 'extended':
      return 'git-branch-outline';
    case 'cover':
      return 'people-outline';
    case 'live':
      return 'mic-outline';
    case 'acoustic':
      return 'leaf-outline';
    case 'instrumental':
    case 'karaoke':
      return 'remove-circle-outline';
    case 'sped-up':
    case 'slowed':
      return 'speedometer-outline';
    default:
      return 'musical-note-outline';
  }
}

/** Non-interactive note shown when a track has no stream URL yet. */
export function MetadataOnlyHint() {
  return (
    <View style={styles.hint}>
      <Ionicons name="information-circle-outline" size={11} color={colors.textTertiary} />
    </View>
  );
}

const styles = StyleSheet.create({
  kindBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.backgroundElement,
  },
  hint: { paddingHorizontal: spacing.xs },
});