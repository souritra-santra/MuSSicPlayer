import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useConnectivity } from '@/hooks/useConnectivity';
import { colors, spacing } from '@/theme/colors';

import { Text } from '@/components/ui/Text';

/**
 * Offline banner.
 *
 * Shown when the device reports no connectivity. Informational, not blocking:
 * the library and cached search results still work, so the copy says what
 * continues to work rather than just "you are offline".
 */

export function OfflineBanner() {
  const { isOnline, isConstrained } = useConnectivity();

  if (isOnline) return null;

  return (
    <View style={[styles.banner, isConstrained && styles.bannerConstrained]} accessibilityRole="alert">
      <Ionicons
        name={isConstrained ? 'cellular-outline' : 'cloud-offline-outline'}
        size={14}
        color={colors.offline}
      />
      <Text variant="micro" color={colors.offline} style={styles.text}>
        {isConstrained
          ? 'Metered connection — streaming may pause to save data'
          : 'Offline — your library and saved searches still work'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.offlineSoft,
  },
  bannerConstrained: { backgroundColor: 'rgba(251, 191, 36, 0.14)' },
  text: { flexShrink: 1 },
});