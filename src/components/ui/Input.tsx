import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing } from '@/theme/colors';

/**
 * Text field.
 *
 * Controlled by the caller so the search box can debounce on change without
 * fighting an internal state copy.
 */

export type InputProps = TextInputProps & {
  /** Optional leading icon (magnifier, etc). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Renders a clear affordance when `value` is non-empty. */
  onClear?: () => void;
  containerStyle?: ViewStyle;
};

export function Input({
  icon,
  onClear,
  value,
  containerStyle,
  style,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.container,
        focused && styles.containerFocused,
        containerStyle,
      ]}>
      {icon && (
        <Ionicons name={icon} size={18} color={focused ? colors.accent : colors.textTertiary} />
      )}
      <TextInput
        {...rest}
        value={value}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        style={[styles.input, style]}
      />
      {onClear && value && value.length > 0 ? (
        <Ionicons
          name="close-circle"
          size={18}
          color={colors.textTertiary}
          onPress={onClear}
          suppressHighlighting
          accessibilityRole="button"
          accessibilityLabel="Clear"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundElement,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  containerFocused: { borderColor: colors.accent },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    padding: 0,
    // Android adds vertical padding that misaligns the row; remove it.
    ...({ includeFontPadding: false } as object),
  },
});