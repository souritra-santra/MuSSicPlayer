/**
 * Dark-first design tokens for the music player UI.
 *
 * The app is intentionally dark-only (see `userInterfaceStyle: "dark"` in
 * app.json), which keeps contrast predictable on low-memory devices and avoids
 * a light/dark flash on cold start.
 */

export const palette = {
  // Neutrals — deep, slightly blue-tinted greys so artwork colours pop.
  ink900: '#07070A',
  ink850: '#0B0B0F',
  ink800: '#121218',
  ink700: '#181821',
  ink600: '#1F1F2B',
  ink500: '#2A2A38',
  ink400: '#3A3A4B',

  // Text
  text: '#F5F6FA',
  textSecondary: '#A7ACBD',
  textTertiary: '#6F7488',
  textDisabled: '#4A4E60',

  // Brand
  accent: '#8B5CF6',
  accentBright: '#A78BFA',
  accentDim: '#4C1D95',
  accentSoft: 'rgba(139, 92, 246, 0.16)',
  gradientFrom: '#7C3AED',
  gradientTo: '#EC4899',

  // Status
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  offline: '#F59E0B',
  offlineSoft: 'rgba(245, 158, 11, 0.16)',

  // Surfaces
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  overlay: 'rgba(7, 7, 10, 0.72)',
  scrim: 'rgba(7, 7, 10, 0.9)',
} as const;

export const colors = {
  background: palette.ink850,
  backgroundElevated: palette.ink800,
  backgroundElement: palette.ink700,
  backgroundSelected: palette.ink600,
  backgroundPressed: palette.ink500,
  overlay: palette.overlay,
  scrim: palette.scrim,

  text: palette.text,
  textSecondary: palette.textSecondary,
  textTertiary: palette.textTertiary,
  textDisabled: palette.textDisabled,

  accent: palette.accent,
  accentBright: palette.accentBright,
  accentDim: palette.accentDim,
  accentSoft: palette.accentSoft,
  gradient: [palette.gradientFrom, palette.gradientTo] as const,

  success: palette.success,
  warning: palette.warning,
  danger: palette.danger,
  offline: palette.offline,
  offlineSoft: palette.offlineSoft,

  border: palette.border,
  borderStrong: palette.borderStrong,
} as const;

/** Skeleton base + shimmer colours. */
export const skeleton = {
  base: palette.ink600,
  highlight: palette.ink400,
} as const;

/** Shared spacing scale (4pt grid). */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Corner radii. */
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;