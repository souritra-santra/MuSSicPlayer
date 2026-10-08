import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, skeleton, spacing } from '@/theme/colors';
import { shadow } from '@/theme/typography';

import { Text } from './Text';

/**
 * Layout + state placeholders.
 *
 * Every async surface in the app renders one of these three states. Having a
 * single implementation is what stops the app from flashing a blank screen on
 * every navigation.
 */

/** Screen container: background colour, safe-area top inset, optional header. */
export function Screen({
  children,
  style,
  edges = ['top'],
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  edges?: ('top' | 'bottom')[];
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        edges.includes('top') && { paddingTop: insets.top },
        edges.includes('bottom') && { paddingBottom: insets.bottom },
        style,
      ]}>
      {children}
    </View>
  );
}

/** Large screen title, matching the pattern players use. */
export function ScreenHeader({
  title,
  subtitle,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.headerText}>
        <Text variant="display" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text variant="heading" numberOfLines={1}>
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text variant="caption" color={colors.accentBright}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Spinner + label for a first-load. */
export function LoadingState({ label = 'Loading…', style }: { label?: string; style?: ViewStyle }) {
  return (
    <View style={[styles.centered, style]}>
      <ActivityIndicator color={colors.accent} />
      <Text variant="caption" color={colors.textTertiary}>
        {label}
      </Text>
    </View>
  );
}

/** Friendly empty state. `action` renders an optional recovery affordance. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  style,
}: {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.centered, style]}>
      {icon}
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="bodySmall" align="center" color={colors.textTertiary}>
          {message}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

/** Error state with a retry affordance. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  style,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.centered, style]}>
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="bodySmall" align="center" color={colors.textTertiary}>
          {message}
        </Text>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}>
          <Text variant="caption" color={colors.accentBright}>
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Full-bleed error for a screen that cannot render at all. */
export function FatalErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <View style={styles.fatal}>
      <Text variant="heading" align="center">
        Couldn’t open your library
      </Text>
      <Text variant="bodySmall" align="center" color={colors.textTertiary}>
        {message ?? 'The local database could not be opened. Restart the app to try again.'}
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
          <Text variant="caption" color={colors.accentBright}>
            Reload
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Shimmering placeholder block.
 *
 * Uses the native driver so the animation keeps running on the UI thread and
 * does not compete with list scrolling for JS frames.
 */
export function Skeleton({
  width,
  height,
  radius: cornerRadius = radius.sm,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const pulse = useShimmer();

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: cornerRadius,
          backgroundColor: skeleton.base,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }),
        },
        style,
      ]}
    />
  );
}

/** Row-shaped skeleton matching `media/TrackRow`. */
export function SkeletonRow() {
  return (
    <View style={styles.skeletonRow}>
      <Skeleton width={48} height={48} radius={radius.sm} />
      <View style={styles.skeletonRowText}>
        <Skeleton width="70%" height={12} />
        <Skeleton width="45%" height={10} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </View>
  );
}

/** Horizontal card skeleton for shelves. */
export function SkeletonShelf({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.skeletonShelf}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.skeletonCard}>
          <Skeleton width={140} height={140} radius={radius.md} />
          <Skeleton width="80%" height={11} />
          <Skeleton width="55%" height={9} />
        </View>
      ))}
    </View>
  );
}

/** One-shot shimmer driver; shared value so lists do not each run their own. */
function useShimmer() {
  const [value] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [value]);

  return value;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerText: { flex: 1, gap: spacing.xs },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  fatal: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  retry: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  skeletonRowText: { flex: 1, gap: spacing.sm },
  skeletonList: { gap: spacing.sm, paddingVertical: spacing.md },
  skeletonShelf: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg },
  skeletonCard: { gap: spacing.sm },
});

export { shadow };