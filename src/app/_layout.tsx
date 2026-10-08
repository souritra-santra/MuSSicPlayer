import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

import { queryClient } from '@/services/cache/queryClient';
import { bootstrap, startupStep } from '@/services/bootstrap';
import { ensureDatabase } from '@/hooks/useDatabase';
import { runMaintenance } from '@/services/database';
import { useConnectivity } from '@/hooks/useConnectivity';
import { startPlaybackEngine } from '@/services/player/engine';
import { usePlayerStore } from '@/store/player';
import { useSettingsStore } from '@/store/settings';
import { navigationTheme } from '@/theme';
import { colors, spacing } from '@/theme/colors';

import { MiniPlayer } from '@/components/media/MiniPlayer';
import { ToastHost } from '@/components/Toast';
import { Text } from '@/components/ui/Text';

/**
 * Root layout.
 *
 * Order matters here:
 *  1. providers register synchronously (`bootstrap`), because the first search
 *     may be typed before any effect has run;
 *  2. the database opens before the splash screen is dismissed, so the first
 *     screen renders real data instead of flashing a skeleton;
 *  3. the mini player and toast host render *above* the navigator so they
 *     survive tab changes and modal pushes.
 */

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navigationTheme}>
            <AppShell />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  // NetInfo is subscribed once here so connectivity is tracked for the whole
  // app lifetime rather than per screen.
  useConnectivity();

  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        startupStep('bootstrap', bootstrap);
      } catch (error: unknown) {
        // Yields first so a synchronous fault lands in its own render instead of
        // cascading straight out of the mount commit.
        await Promise.resolve();
        if (!cancelled) {
          setFailure(describe(error));
          setReady(true);
        }
        return;
      }

      try {
        const state = await ensureDatabase();
        if (state.status === 'error') {
          setFailure(`Could not open the local library. ${describe(state.error)}`);
        } else if (state.status === 'ready') {
          // Housekeeping on cold start: hit the retention limits and drop
          // expired cache rows. Cheap, bounded, and fire-and-forget — the
          // first screen renders the moment the rehydrate below resolves.
          void runMaintenance(state.db).catch((error: unknown) => {
            console.warn('[startup] maintenance failed', error);
          });

          // The persisted stores read from the SQLite kv-store, which is only
          // open once SQLite is initialised. Rehydrating here means the first
          // rendered frame already has the user's settings and queue.
          await Promise.all([
            useSettingsStore.persist.rehydrate(),
            usePlayerStore.persist.rehydrate(),
          ]);
          // The engine subscribes to the rehydrated store: a restored queue is
          // loaded on the first play tap, never auto-played on boot.
          startPlaybackEngine();
        }
      } catch (error: unknown) {
        setFailure(describe(error));
      }

      if (!cancelled) setReady(true);
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    // A splash screen that refuses to hide must not take the app down with it:
    // the tree underneath is already rendered and usable.
    SplashScreen.hideAsync().catch((error: unknown) => {
      console.warn('[startup] hideAsync failed', error);
    });
  }, [ready]);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="now-playing" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="queue" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="artist/[id]" />
        <Stack.Screen name="album/[id]" />
        <Stack.Screen name="playlist/[id]" />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
      </Stack>

      {/* Docked above the tab bar; hidden on Now Playing. */}
      <MiniPlayer />
      <ToastHost />

      {failure ? <StartupFailure message={failure} /> : null}
    </>
  );
}

/** Anything that reaches the failure screen is already labelled; this is the floor. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Covers the navigator when the local database cannot be opened.
 *
 * A music app with no local library cannot rank, dedupe or keep history, so this
 * is a hard stop rather than a dismissible toast — and it names the actual
 * error so a user reporting a bug has something to quote.
 */
function StartupFailure({ message }: { message: string }) {
  return (
    <View style={styles.failure} accessibilityRole="alert">
      <Text variant="heading" align="center">
        Couldn’t open your library
      </Text>
      <Text variant="bodySmall" align="center" color={colors.textTertiary}>
        {message}
      </Text>
      <Text variant="caption" align="center" color={colors.textDisabled}>
        Restart the app to try again.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  failure: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
});