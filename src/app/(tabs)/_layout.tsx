import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { Brand, Radius } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { isAgronomist as isAgronomistRole } from '@/lib/api';

const GREEN = Brand.primary;

/**
 * Filled when active, outlined when not — the shape carries the state as well
 * as the colour, which survives being glanced at in sunlight.
 */
function TabIcon({
  name,
  color,
  focused,
}: {
  name: string;
  color: string;
  focused: boolean;
}) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Ionicons name={(focused ? name : `${name}-outline`) as never} color={color} size={22} />
    </View>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  const { user } = useAuth();
  const isAgronomist = isAgronomistRole(user?.role);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: [
          styles.bar,
          { backgroundColor: theme.background, borderTopColor: theme.backgroundElement },
        ],
        tabBarItemStyle: styles.item,
        tabBarLabelStyle: styles.label,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: (p) => <TabIcon name="home" {...p} />,
        }}
      />
      <Tabs.Screen
        name="pending"
        options={{
          title: 'Tasks',
          // Agronomist-only tab.
          href: isAgronomist ? undefined : null,
          tabBarIcon: (p) => <TabIcon name="checkbox" {...p} />,
        }}
      />
      <Tabs.Screen
        name="onboarded"
        options={{
          title: 'People',
          href: isAgronomist ? undefined : null,
          tabBarIcon: (p) => <TabIcon name="people" {...p} />,
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: 'Calls',
          href: isAgronomist ? undefined : null,
          tabBarIcon: (p) => <TabIcon name="call" {...p} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: (p) => <TabIcon name="person" {...p} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    // Docked, NOT floating. A floating bar is drawn over the screen, so every
    // screen has to reserve space for it by hand — and anything laid out to the
    // bottom (Profile's Log Out) ends up underneath it. Docked, the navigator
    // sizes the content above the bar and nothing can be covered.
    height: Platform.select({ ios: 84, android: 68 }),
    paddingBottom: Platform.select({ ios: 24, android: 10 }),
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: { paddingTop: 2 },
  label: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  iconWrap: {
    width: 40,
    height: 26,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A soft well behind the active icon, so the current tab is obvious even
  // where the green tint alone is hard to pick out.
  iconWrapActive: { backgroundColor: Brand.primarySurface },
});
