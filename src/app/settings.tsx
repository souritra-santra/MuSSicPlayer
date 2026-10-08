import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';

import { colors, radius, spacing } from '@/theme/colors';
import { formatBytes, pluralize } from '@/utils/format';
import { useSettingsStore, selectResolverConfig } from '@/store/settings';
import { getAllProviders } from '@/services/providers';
import { clearArtworkCaches } from '@/services/cache/artwork';
import { useToast } from '@/hooks/useToast';
import { describeResolver, normalizeEndpoint } from '@/services/player/resolver';
import {
  useLibraryStats,
  useTrackCountsByProvider,
  useClearHistory,
} from '@/hooks/useLibrary';
import { Button, Chip, IconButton, ListRow, Segmented } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Feedback';
import { Text } from '@/components/ui/Text';

/**
 * Settings.
 *
 * Three groups: playback (stream resolution and how it fails), sources (which
 * providers are enabled), and data (what is stored on-device).
 *
 * YouTube works without any configuration thanks to the built-in extractor, so
 * the resolver endpoint is an optional override. It still gets explanation,
 * because once supplied it also covers other video sources as a fallback.
 */

const QUALITY_OPTIONS = [
  { value: 'best' as const, label: 'Best' },
  { value: '128' as const, label: '128' },
  { value: '96' as const, label: '96' },
  { value: '64' as const, label: '64' },
];

export default function SettingsScreen() {
  const router = useRouter();

  const endpoint = useSettingsStore((state) => state.resolverEndpoint);
  const apiKey = useSettingsStore((state) => state.resolverApiKey);
  const quality = useSettingsStore((state) => state.resolverQuality);
  const disabledProviders = useSettingsStore((state) => state.disabledProviders);
  const autoplay = useSettingsStore((state) => state.autoplay);
  const excludeExplicit = useSettingsStore((state) => state.excludeExplicit);
  const preloadNext = useSettingsStore((state) => state.preloadNext);
  const cacheSearchResults = useSettingsStore((state) => state.cacheSearchResults);
  const setResolverEndpoint = useSettingsStore((state) => state.setResolverEndpoint);
  const setResolverApiKey = useSettingsStore((state) => state.setResolverApiKey);
  const setResolverQuality = useSettingsStore((state) => state.setResolverQuality);
  const toggleProvider = useSettingsStore((state) => state.toggleProvider);
  const setAutoplay = useSettingsStore((state) => state.setAutoplay);
  const setExcludeExplicit = useSettingsStore((state) => state.setExcludeExplicit);
  const setPreloadNext = useSettingsStore((state) => state.setPreloadNext);
  const setCacheSearchResults = useSettingsStore((state) => state.setCacheSearchResults);
  const resetSettings = useSettingsStore((state) => state.resetSettings);

  const stats = useLibraryStats();
  const providerCounts = useTrackCountsByProvider();
  const clearHistory = useClearHistory();
  const toast = useToast();

  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [clearingArtwork, setClearingArtwork] = useState(false);

  const clearArtwork = async () => {
    setClearingArtwork(true);
    try {
      await clearArtworkCaches();
      toast.show('Artwork cache cleared', 'success');
    } catch (error) {
      toast.show(
        `Could not clear artwork cache: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    } finally {
      setClearingArtwork(false);
    }
  };

  const providers = getAllProviders();
  // `useShallow` matters here: the selector builds a fresh object, and Zustand
  // v5 compares with `Object.is` by default, so without it every store write
  // would look like a change and re-render this screen.
  const resolverConfig = useSettingsStore(useShallow(selectResolverConfig));
  const resolverConfigured = resolverConfig !== null;

  const saveEndpoint = () => setResolverEndpoint(normalizeEndpoint(draftEndpoint));
  const saveKey = () => setResolverApiKey(draftKey);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.headerBar}>
        <IconButton
          name="arrow-back"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
        />
        <ScreenHeader title="Settings" />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ------------------------------------------------------- playback */}
        <SectionHeader title="Playback" />
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons
              name={resolverConfigured ? 'checkmark-circle' : 'sparkles-outline'}
              size={18}
              color={resolverConfigured ? colors.success : colors.accent}
            />
            <Text variant="subheading">Stream resolver</Text>
          </View>
          <Text variant="bodySmall" color={colors.textTertiary} style={styles.explainer}>
            {describeResolver(resolverConfig)}
          </Text>
          <Text variant="caption" color={colors.textTertiary} style={styles.explainer}>
            YouTube results play out of the box through a built-in stream extractor. YouTube
            currently streams most songs to third-party apps as a short preview, so full-length
            playback of this track works once the resolver is set. The endpoint is also a
            fallback for restricted videos and other video sources. Any cobalt-compatible
            endpoint works; the repo ships a reference yt-dlp resolver under server/ that
            plays full tracks (see server/README.md). Public cobalt instances use bot
            protection and ask third-party apps not to hardcode them, so you supply your own
            endpoint if you want one.
          </Text>

          <Input
            icon="link-outline"
            placeholder="https://your-resolver.example"
            value={draftEndpoint}
            onChangeText={setDraftEndpoint}
            onBlur={saveEndpoint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={saveEndpoint}
            accessibilityLabel="Resolver endpoint URL"
          />

          <Input
            icon="key-outline"
            placeholder="API token (optional)"
            value={draftKey}
            onChangeText={setDraftKey}
            onBlur={saveKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel="Resolver API token"
          />

          <Text label color={colors.textTertiary} style={styles.fieldLabel}>
            Stream quality
          </Text>
          <Segmented
            options={QUALITY_OPTIONS}
            value={quality}
            onChange={setResolverQuality}
          />
        </View>

        <View style={styles.card}>
          <ToggleRow
            title="Autoplay next track"
            subtitle="Continue to the next queue item when one finishes"
            value={autoplay}
            onChange={setAutoplay}
          />
          <ToggleRow
            title="Hide explicit tracks"
            subtitle="Filter results and queues"
            value={excludeExplicit}
            onChange={setExcludeExplicit}
          />
          <ToggleRow
            title="Preload next track"
            subtitle="Reduces gaps between songs"
            value={preloadNext}
            onChange={setPreloadNext}
          />
        </View>

        {/* -------------------------------------------------------- sources */}
        <SectionHeader title="Sources" />
        <View style={styles.card}>
          {providers.map((provider, index) => {
            const enabled = !disabledProviders.includes(provider.id);
            return (
              <View key={provider.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <ToggleRow
                  title={provider.displayName}
                  subtitle={provider.description}
                  value={enabled}
                  onChange={() => toggleProvider(provider.id)}
                  right={
                    <View style={styles.capabilityRow}>
                      {provider.capabilities.canStream ? (
                        <Chip label="Streams" tone="accent" />
                      ) : (
                        <Chip label="Metadata" />
                      )}
                      {provider.capabilities.needsResolver ? <Chip label="Resolver" /> : null}
                    </View>
                  }
                />
              </View>
            );
          })}
        </View>

        {/* ----------------------------------------------------------- data */}
        <SectionHeader title="Your data" />
        <View style={styles.card}>
          <Text variant="bodySmall" color={colors.textTertiary} style={styles.explainer}>
            Everything is stored in a local SQLite file on this device. No account, no server, no
            analytics. Search history and cached metadata can be cleared at any time.
          </Text>

          {stats.data ? (
            <View style={styles.statGrid}>
              <Stat label="Cached tracks" value={String(stats.data.tracks)} />
              <Stat label="Artists" value={String(stats.data.artists)} />
              <Stat label="Albums" value={String(stats.data.albums)} />
              <Stat label="Favourites" value={String(stats.data.favorites)} />
              <Stat label="History" value={pluralize(stats.data.historyEntries, 'entry', 'entries')} />
              {stats.data.databaseBytes ? (
                <Stat label="Database" value={formatBytes(stats.data.databaseBytes)} />
              ) : null}
            </View>
          ) : null}

          {providerCounts.data && Object.keys(providerCounts.data).length > 0 ? (
            <View style={styles.capabilityRow}>
              {Object.entries(providerCounts.data).map(([provider, count]) => (
                <Chip key={provider} label={`${provider} · ${count}`} />
              ))}
            </View>
          ) : null}

          <ToggleRow
            title="Cache search results"
            subtitle="Keeps metadata so past searches work offline"
            value={cacheSearchResults}
            onChange={setCacheSearchResults}
          />

          <Button
            label="Clear artwork cache"
            variant="secondary"
            icon="image-outline"
            onPress={clearArtwork}
            loading={clearingArtwork}
            fullWidth
          />

          <Button
            label="Clear listening history"
            variant="danger"
            icon="trash-outline"
            onPress={() => clearHistory.mutate()}
            loading={clearHistory.isPending}
            fullWidth
          />
        </View>

        <Button
          label="Reset all settings"
          variant="ghost"
          onPress={resetSettings}
          style={styles.reset}
        />

        <Text variant="micro" align="center" color={colors.textDisabled} style={styles.footer}>
          v1.1 · built-in extractor · on-device recommendations · offline cache
        </Text>
      </ScrollView>
    </Screen>
  );
}

/* ------------------------------------------------------------------ helpers */

function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
  right,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  right?: React.ReactNode;
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      onPress={() => onChange(!value)}
      right={
        right ?? (
          <Switch
            value={value}
            onValueChange={onChange}
            trackColor={{ false: colors.backgroundSelected, true: colors.accentDim }}
            thumbColor={value ? colors.accentBright : colors.textTertiary}
            accessibilityLabel={title}
          />
        )
      }
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="micro" color={colors.textTertiary}>
        {label}
      </Text>
      <Text variant="subheading">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  card: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundElevated,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  explainer: { marginTop: -spacing.xs },
  fieldLabel: { marginTop: -spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  capabilityRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: { minWidth: '30%', gap: 2 },
  reset: { alignSelf: 'center' },
  footer: { paddingHorizontal: spacing.lg },
});