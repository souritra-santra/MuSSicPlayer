import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing } from '@/theme/colors';
import { formatDuration, progressRatio } from '@/utils/format';

import { Text } from '@/components/ui/Text';

/**
 * Seek bar.
 *
 * Fully interactive: tap or drag anywhere on the track to scrub, and the
 * seek fires once on release (dragging updates the thumb locally, so a
 * 2 Hz position feed from the engine never fights the user's finger).
 * Without a known duration the bar degrades to a read-only indicator.
 *
 * Plain responder props rather than `PanResponder`: the handlers are inline
 * closures over the latest render's values, which the React Compiler can
 * reason about, and the touch maths needs no gesture-state bookkeeping —
 * `locationX` is already absolute within the track.
 */

export type SeekBarProps = {
  positionMs: number;
  durationMs?: number;
  onSeek?: (positionMs: number) => void;
  disabled?: boolean;
  compact?: boolean;
};

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function SeekBar({ positionMs, durationMs, onSeek, disabled, compact }: SeekBarProps) {
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);

  const trackWidth = useRef(1);
  const lastRatio = useRef(0);

  const hasDuration = typeof durationMs === 'number' && durationMs > 0;
  const scrubbable = Boolean(onSeek) && hasDuration && !disabled;
  const duration = hasDuration ? (durationMs as number) : 0;

  const ratioAt = (locationX: number) => clampRatio(locationX / Math.max(1, trackWidth.current));

  const beginScrub = (locationX: number) => {
    if (!scrubbable) return;
    lastRatio.current = ratioAt(locationX);
    setScrubRatio(lastRatio.current);
  };

  const continueScrub = (locationX: number) => {
    if (!scrubbable) return;
    const ratio = ratioAt(locationX);
    lastRatio.current = ratio;
    setScrubRatio(ratio);
  };

  const commitScrub = () => {
    const ratio = lastRatio.current;
    setScrubRatio(null);
    if (scrubbable) onSeek?.(ratio * duration);
  };

  const shownRatio = scrubRatio ?? progressRatio(positionMs, hasDuration ? durationMs : undefined);

  return (
    <View style={styles.container}>
      <View
        style={[styles.trackHitArea, compact && styles.trackHitAreaCompact]}
        onLayout={(event) => {
          trackWidth.current = Math.max(1, event.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => scrubbable}
        onMoveShouldSetResponder={() => scrubbable}
        onResponderGrant={(event) => beginScrub(event.nativeEvent.locationX)}
        onResponderMove={(event) => continueScrub(event.nativeEvent.locationX)}
        onResponderRelease={commitScrub}
        onResponderTerminate={() => setScrubRatio(null)}>
        <View style={[styles.track, compact && styles.trackCompact]}>
          <View style={[styles.fill, { width: `${shownRatio * 100}%` }]} />
          <View
            style={[
              styles.thumb,
              { left: `${shownRatio * 100}%` },
              !scrubbable && styles.thumbDisabled,
            ]}
          />
        </View>
      </View>
      <View style={styles.labels}>
        <Text variant="micro" color={colors.textTertiary}>
          {formatDuration(scrubRatio !== null ? scrubRatio * duration : positionMs)}
        </Text>
        <Text variant="micro" color={colors.textTertiary}>
          {formatDuration(hasDuration ? durationMs : undefined)}
        </Text>
      </View>
    </View>
  );
}

/** Thin, non-interactive progress line for the mini player and Now Playing. */
export function ProgressLine({
  ratio,
  color = colors.accent,
  height = 2,
}: {
  ratio: number;
  color?: string;
  height?: number;
}) {
  return (
    <View style={[styles.line, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${Math.min(1, Math.max(0, ratio)) * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** Equaliser glyph shown on the currently playing row. */
export function PlayingIndicator({ animating = true }: { animating?: boolean }) {
  return (
    <View style={styles.eq} accessibilityLabel={animating ? 'Now playing' : 'Paused'}>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={[
            styles.eqBar,
            animating ? { height: [6, 12, 8][index] } : { height: 4 },
          ]}
        />
      ))}
    </View>
  );
}

export function UnavailableNote({ message }: { message: string }) {
  return (
    <View style={styles.unavailable}>
      <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
      <Text variant="caption" color={colors.warning} style={styles.unavailableText}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: spacing.xs },
  trackHitArea: {
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  trackHitAreaCompact: { paddingVertical: spacing.xs },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.backgroundSelected,
    justifyContent: 'center',
  },
  trackCompact: { height: 3 },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    backgroundColor: colors.text,
  },
  thumbDisabled: { opacity: 0.4 },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  line: {
    width: '100%',
    backgroundColor: colors.backgroundSelected,
    overflow: 'hidden',
  },
  eq: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 12,
  },
  eqBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
  },
  unavailableText: { flex: 1 },
});