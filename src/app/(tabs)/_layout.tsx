import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, Radius } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { isAgronomist as isAgronomistRole } from '@/lib/api';

const GREEN = Brand.primary;

/**
 * Height of the bar's own content — the icon well plus its label. The system's
 * bottom inset is added to this at runtime rather than baked in: on a phone
 * using three-button navigation Android reserves around 48dp down there, and a
 * fixed height leaves the tabs sitting underneath the Back/Home/Recents keys.
 * Gesture navigation reserves far less, and an older device none at all.
 */
const BAR_CONTENT_HEIGHT = 56;
/** Kept clear of the very bottom edge when the system reserves nothing. */
const MIN_BOTTOM_PAD = 8;

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
  const insets = useSafeAreaInsets();
  const isAgronomist = isAgronomistRole(user?.role);

  // Whatever the system navigation takes, the bar grows by exactly that much.
  const bottomPad = Math.max(insets.bottom, MIN_BOTTOM_PAD);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: [
          styles.bar,
          {
            backgroundColor: theme.background,
            borderTopColor: theme.backgroundElement,
            height: BAR_CONTENT_HEIGHT + bottomPad,
            paddingBottom: bottomPad,
          },
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
    //
    // `height` and `paddingBottom` are set at runtime from the safe-area inset
    // — see BAR_CONTENT_HEIGHT.
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
