import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useToastTimer } from '@/hooks/useToast';
import { MINI_PLAYER_HEIGHT, useMiniPlayerOffset } from '@/hooks/useMiniPlayer';
import { useUiStore } from '@/store/ui';
import { colors, radius, spacing } from '@/theme/colors';
import { Text } from '@/components/ui/Text';

/**
 * Toast host.
 *
 * Mounted once in the root layout. Sits above the mini player so a confirmation
 * is never hidden behind the dock, and auto-dismisses via `useToastTimer`.
 */

const ICONS = {
  info: 'information-circle' as const,
  success: 'checkmark-circle' as const,
  error: 'alert-circle' as const,
};

const TONES = {
  info: colors.accentBright,
  success: colors.success,
  error: colors.danger,
};

export function ToastHost() {
  const toast = useUiStore((state) => state.toast);
  const insets = useSafeAreaInsets();
  useToastTimer();

  // Sits directly above the mini player dock (when visible) so a confirmation is
  // never hidden behind it. Computed before the early return to keep hook order
  // stable across renders.
  const bottom = useMiniPlayerOffset(insets.bottom, spacing.sm) + MINI_PLAYER_HEIGHT + spacing.sm;

  if (!toast) return null;

  return (
    <View style={[styles.host, { bottom }]} pointerEvents="none">
      <Animated.View
        entering={FadeInDown.duration(160)}
        exiting={FadeOut.duration(120)}
        accessibilityLiveRegion="polite"
        style={styles.toast}>
        <Ionicons name={ICONS[toast.tone]} size={16} color={TONES[toast.tone]} />
        <Text variant="caption" color={colors.text} numberOfLines={2} style={styles.text}>
          {toast.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 420,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundElement,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  text: { flexShrink: 1 },
});