import { Platform } from 'react-native';

import { colors, radius, skeleton, spacing } from './colors';

/**
 * Type scale. Sizes are deliberately a little tighter than the platform
 * defaults because dense track rows read better at smaller sizes on phones.
 */
export const fontSize = {
  display: 30,
  title: 24,
  heading: 19,
  subheading: 16,
  body: 15,
  bodySmall: 13,
  caption: 12,
  micro: 11,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const lineHeight = {
  tight: 1.15,
  snug: 1.3,
  normal: 1.45,
} as const;

export const letterSpacing = {
  tight: -0.4,
  normal: 0,
  wide: 0.6,
} as const;

export const fontFamily = Platform.select({
  android: 'sans-serif',
  ios: 'System',
  default: 'System',
});

/** Ready-made text styles, referenced by `ui/Text`. */
export const textStyles = {
  display: {
    fontSize: fontSize.display,
    lineHeight: fontSize.display * lineHeight.tight,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.tight,
    color: colors.text,
  },
  title: {
    fontSize: fontSize.title,
    lineHeight: fontSize.title * lineHeight.tight,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.tight,
    color: colors.text,
  },
  heading: {
    fontSize: fontSize.heading,
    lineHeight: fontSize.heading * lineHeight.snug,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  subheading: {
    fontSize: fontSize.subheading,
    lineHeight: fontSize.subheading * lineHeight.snug,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: fontSize.body * lineHeight.normal,
    fontWeight: fontWeight.regular,
    color: colors.text,
  },
  bodySecondary: {
    fontSize: fontSize.body,
    lineHeight: fontSize.body * lineHeight.normal,
    fontWeight: fontWeight.regular,
    color: colors.textSecondary,
  },
  bodySmall: {
    fontSize: fontSize.bodySmall,
    lineHeight: fontSize.bodySmall * lineHeight.normal,
    fontWeight: fontWeight.regular,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: fontSize.caption,
    lineHeight: fontSize.caption * lineHeight.snug,
    fontWeight: fontWeight.regular,
    color: colors.textTertiary,
  },
  label: {
    fontSize: fontSize.caption,
    lineHeight: fontSize.caption * lineHeight.snug,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.wide,
    color: colors.textSecondary,
  },
  micro: {
    fontSize: fontSize.micro,
    lineHeight: fontSize.micro * lineHeight.snug,
    fontWeight: fontWeight.medium,
    color: colors.textTertiary,
  },
} as const;

export type TextVariant = keyof typeof textStyles;

/** Animation durations shared by skeletons and transitions. */
export const duration = {
  fast: 120,
  normal: 220,
  slow: 380,
} as const;

/** Standard elevation shadows (Android uses `elevation`). */
export const shadow = {
  none: {},
  card: Platform.select({
    android: { elevation: 2 },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
  }),
  floating: Platform.select({
    android: { elevation: 12 },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
    },
  }),
} as const;

export const theme = {
  colors,
  skeleton,
  spacing,
  radius,
  fontSize,
  fontWeight,
  textStyles,
  duration,
  shadow,
} as const;

export type AppTheme = typeof theme;
export type AppColorName = keyof typeof colors;