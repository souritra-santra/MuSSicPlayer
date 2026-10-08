import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/colors';

/**
 * Tab navigator.
 *
 * Uses the JS `Tabs` (from `expo-router/js-tabs`) rather than the native
 * bottom tabs: the mini player docks above the bar, and a JS tab bar makes it
 * possible to reserve the space predictably and animate it.
 *
 * All headers are off — each screen renders its own large title via
 * `ui/ScreenHeader` so the typography stays consistent with the rest of the UI
 * kit.
 */

/** Height of the bar's own content, excluding the system inset. */
export const TAB_BAR_HEIGHT = 58;

/** Shared by the layout and the mini player so the dock never overlaps it. */
export const TAB_BAR_TOTAL_HEIGHT = TAB_BAR_HEIGHT;

type TabIconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<'index' | 'search' | 'library', { active: TabIconName; inactive: TabIconName }> = {
  index: { active: 'home', inactive: 'home-outline' },
  search: { active: 'search', inactive: 'search-outline' },
  library: { active: 'library', inactive: 'library-outline' },
};

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentBright,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: styles.label,
        tabBarStyle: [
          styles.bar,
          { height: TAB_BAR_TOTAL_HEIGHT + insets.bottom, paddingBottom: insets.bottom },
        ],
        sceneStyle: { backgroundColor: colors.background },
        // Each tab keeps its scroll position and mounted state, which matters
        // on low-memory devices where remounting the whole library is visible.
        lazy: true,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? ICONS.index.active : ICONS.index.inactive} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? ICONS.search.active : ICONS.search.inactive} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? ICONS.library.active : ICONS.library.inactive}
              size={22}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.backgroundElevated,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xs,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});