import { DarkTheme, type Theme } from 'expo-router';

import { colors, radius, spacing } from './colors';
import { fontFamily } from './typography';

/**
 * Navigation theme derived from the app palette, so headers, tab bars and
 * screen backgrounds all match the custom UI kit.
 */
export const navigationTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.backgroundElevated,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
  fonts: {
    regular: { fontFamily, fontWeight: '400' },
    medium: { fontFamily, fontWeight: '500' },
    bold: { fontFamily, fontWeight: '700' },
    heavy: { fontFamily, fontWeight: '800' },
  },
};

/** Shared style fragments used across screens. */
export const layout = {
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  sectionGap: spacing.xxl,
  hairline: {
    height: 1,
    backgroundColor: colors.border,
  },
  card: {
    backgroundColor: colors.backgroundElement,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  headerTitle: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '600',
    color: colors.text,
  },
};

export { colors, radius, spacing };
export { theme } from './typography';
export type { AppColorName, AppTheme, TextVariant } from './typography';