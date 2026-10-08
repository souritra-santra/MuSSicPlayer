import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing } from '@/theme/colors';
import { fontWeight } from '@/theme/typography';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { Text } from './Text';

/**
 * Pressable primitives.
 *
 * Haptics fire on Android via `expo-haptics`; on iOS the system already
 * provides feedback for presses in most contexts, so they are intentionally
 * skipped there rather than doubling up.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
};

const HEIGHTS: Record<ButtonSize, number> = { sm: 34, md: 44, lg: 54 };

function variantStyle(variant: ButtonVariant): ViewStyle {
  switch (variant) {
    case 'primary':
      return { backgroundColor: colors.accent, borderColor: colors.accent };
    case 'secondary':
      return { backgroundColor: colors.backgroundElement, borderColor: colors.border };
    case 'danger':
      return { backgroundColor: 'rgba(248, 113, 113, 0.14)', borderColor: 'rgba(248, 113, 113, 0.4)' };
    case 'ghost':
    default:
      return { backgroundColor: 'transparent', borderColor: 'transparent' };
  }
}

function textColor(variant: ButtonVariant): string {
  if (variant === 'primary') return '#FFFFFF';
  if (variant === 'danger') return colors.danger;
  return colors.text;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const inactive = disabled || loading;
  const tint = inactive ? colors.textDisabled : textColor(variant);

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS === 'android') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        variantStyle(variant),
        { height: HEIGHTS[size], paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg },
        fullWidth && styles.fullWidth,
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <>
          {icon && iconPosition === 'left' && (
            <Ionicons name={icon} size={size === 'sm' ? 14 : 18} color={tint} />
          )}
          <Text
            variant={size === 'sm' ? 'caption' : 'body'}
            style={{ color: tint, fontWeight: fontWeight.semibold }}>
            {label}
          </Text>
          {icon && iconPosition === 'right' && (
            <Ionicons name={icon} size={size === 'sm' ? 14 : 18} color={tint} />
          )}
        </>
      )}
    </Pressable>
  );
}

export type IconButtonProps = {
  name: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  size?: number;
  color?: string;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  style?: ViewStyle;
  /** Renders a circular accent-tinted background (used for the mini player). */
  prominent?: boolean;
};

export function IconButton({
  name,
  onPress,
  size = 22,
  color,
  active = false,
  disabled = false,
  accessibilityLabel,
  style,
  prominent = false,
}: IconButtonProps) {
  const tint = disabled ? colors.textDisabled : color ?? (active ? colors.accent : colors.text);

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS === 'android') void Haptics.selectionAsync();
        onPress?.();
      }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => [
        styles.iconButton,
        prominent && styles.prominent,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      <Ionicons name={name} size={size} color={tint} />
    </Pressable>
  );
}

/** Small pill used for filters and metadata (provider, kind, count). */
export type ChipProps = {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'default' | 'accent' | 'warning';
  style?: ViewStyle;
};

export function Chip({ label, onPress, selected = false, icon, tone = 'default', style }: ChipProps) {
  const backgroundColor =
    tone === 'accent'
      ? colors.accentSoft
      : tone === 'warning'
        ? colors.offlineSoft
        : selected
          ? colors.accentSoft
          : colors.backgroundElement;
  const textColor =
    tone === 'accent' || selected
      ? colors.accentBright
      : tone === 'warning'
        ? colors.offline
        : colors.textSecondary;

  const content = (
    <>
      {icon && <Ionicons name={icon} size={12} color={textColor} />}
      <Text variant="caption" style={{ color: textColor }}>
        {label}
      </Text>
    </>
  );

  if (!onPress) {
    return <View style={[styles.chip, { backgroundColor }, style]}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, { backgroundColor }, pressed && styles.pressed, style]}>
      {content}
    </Pressable>
  );
}

/** Grouped control (segmented picker). */
export type SegmentedProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
};

export function Segmented<T extends string>({ options, value, onChange, style }: SegmentedProps<T>) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && styles.segmentSelected]}>
            <Text
              variant="caption"
              style={{ color: selected ? colors.text : colors.textSecondary, fontWeight: '600' }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled row with a value and optional control on the right. */
export function ListRow({
  title,
  subtitle,
  leftIcon,
  right,
  onPress,
  accessibilityLabel,
  style,
}: {
  title: string;
  subtitle?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const body = (
    <>
      {leftIcon && (
        <View style={styles.rowIcon}>
          <Ionicons name={leftIcon} size={18} color={colors.textSecondary} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text>{title}</Text>
        {subtitle ? (
          <Text variant="caption" color={colors.textTertiary} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </>
  );

  if (!onPress) return <View style={[styles.row, style]}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    borderRadius: radius.pill,
  },
  prominent: {
    backgroundColor: colors.backgroundElement,
    width: 40,
    height: 40,
    padding: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundElement,
    borderRadius: radius.md,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  segmentSelected: { backgroundColor: colors.backgroundSelected },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundElement,
  },
  rowText: { flex: 1, gap: 2 },
});