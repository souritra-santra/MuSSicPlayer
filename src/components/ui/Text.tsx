import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { colors } from '@/theme/colors';
import { textStyles, type TextVariant } from '@/theme/typography';

/**
 * Text primitive.
 *
 * Every string in the app goes through this so typography stays consistent and
 * a variant change is a one-line edit rather than a sweep through screens.
 */

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  /** Renders as uppercase micro-label. */
  label?: boolean;
  numberOfLines?: number;
};

export function Text({
  variant = 'body',
  color,
  align,
  label,
  style,
  ...rest
}: TextProps) {
  const variantStyle = textStyles[label ? 'label' : variant];
  return (
    <RNText
      {...rest}
      style={[
        variantStyle,
        color ? { color } : undefined,
        align ? { textAlign: align } : undefined,
        style,
      ]}
    />
  );
}

/** Section eyebrow: uppercase, letter-spaced, tertiary colour. */
export function Eyebrow(props: TextProps) {
  return <Text {...props} label color={colors.textTertiary} />;
}

/** Muted metadata line under a title. */
export function Subtitle(props: TextProps) {
  return <Text {...props} variant="bodySmall" color={colors.textSecondary} />;
}

/** Numeric chip text (duration, counts). */
export function Mono(props: TextProps) {
  return <Text {...props} variant="caption" color={colors.textTertiary} />;
}