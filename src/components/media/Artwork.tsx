import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import {
  artworkCachePolicy,
  artworkSizeFor,
  placeholderColor,
  type ArtworkCachePolicy,
} from '@/services/cache/artwork';
import { colors, radius } from '@/theme/colors';

import { Text } from '@/components/ui/Text';

/**
 * Album artwork.
 *
 * Falls back to a deterministic colour block plus a music glyph when a provider
 * has no artwork — a stable placeholder reads better than a grey square that
 * jumps between screens.
 */

/**
 * Accepted for both branches.
 *
 * `expo-image` wants `ImageStyle` and the placeholder `View` wants `ViewStyle`;
 * they differ only in `overflow`, which callers never set on this component.
 */
export type ArtworkStyle = StyleProp<ImageStyle & ViewStyle>;

export type ArtworkProps = {
  uri?: string | null;
  /** Stable seed for the fallback colour (track id works well). */
  seed: string;
  size: number;
  rounded?: boolean;
  /** Cache tier; default `memory-disk` for lists, `disk` for hero images. */
  cache?: ArtworkCachePolicy;
  style?: ArtworkStyle;
};

export function Artwork({
  uri,
  seed,
  size,
  rounded = true,
  cache = 'memory-disk',
  style,
}: ArtworkProps) {
  const cornerRadius = rounded ? radius.sm : 0;
  const shape: ImageStyle & ViewStyle = { width: size, height: size, borderRadius: cornerRadius };

  if (!uri) {
    return (
      <View style={[styles.fallback, shape, { backgroundColor: placeholderColor(seed) }, style]}>
        <Ionicons name="musical-note" size={size * 0.38} color="rgba(255,255,255,0.45)" />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[shape, style]}
      // `memory-disk` keeps the decoded bitmap in RAM for fast scrolling while
      // persisting a downscaled copy, which is what makes back-scroll instant.
      cachePolicy={artworkCachePolicy(cache)}
      contentFit="cover"
      transition={140}
      placeholder={{ blurhash: 'L03rqC%M00%MRj~qIU00t7_3t7' }}
    />
  );
}

/** Circular artist image used on profile rows. */
export function ArtistAvatar({
  uri,
  name,
  size = 40,
  style,
}: {
  uri?: string | null;
  name: string;
  size?: number;
  style?: ArtworkStyle;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const shape: ImageStyle & ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (!uri) {
    return (
      <View
        style={[
          styles.fallback,
          shape,
          { backgroundColor: placeholderColor(name) },
          style,
        ]}>
        <TextInitial name={initial} size={size} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[shape, style]}
      cachePolicy="memory-disk"
      contentFit="cover"
      transition={140}
    />
  );
}

function TextInitial({ name, size }: { name: string; size: number }) {
  return (
    <Text
      variant="subheading"
      color="rgba(255,255,255,0.75)"
      style={{ fontSize: size * 0.42 }}>
      {name}
    </Text>
  );
}

/** Album-art sized dimensions for a list row / card / hero. */
export const ARTWORK_SIZES = {
  row: artworkSizeFor('row'),
  card: artworkSizeFor('card'),
  hero: artworkSizeFor('hero'),
} as const;

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundElement,
    overflow: 'hidden',
  },
});