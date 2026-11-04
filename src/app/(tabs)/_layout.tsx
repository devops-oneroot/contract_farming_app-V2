import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, Radius } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
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
// 56 left the label clipped under the icon well; this fits both with room.
const BAR_CONTENT_HEIGHT = 64;
/** Kept clear of the very bottom edge when the system reserves nothing. */
const MIN_BOTTOM_PAD = 8;

/**
 * One tab: icon above its name. The active tab is a soft green pill holding
 * both, with the icon and name in green - obvious at a glance, even in sunlight. The icon is also
 * filled when active and outlined when not, so the shape carries the state as
 * well as the colour.
 */
function TabIcon({ name, label, focused }: { name: string; label: string; focused: boolean }) {
  const theme = useTheme();
  const color = focused ? GREEN : theme.textSecondary;
  return (
    <View style={[styles.pill, focused && styles.pillActive]}>
      <Ionicons name={(focused ? name : `${name}-outline`) as never} color={color} size={21} />
      <ThemedText numberOfLines={1} style={[styles.label, { color }, focused && styles.labelActive]}>
        {label}
      </ThemedText>
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
            backgroundColor: theme.card,
            height: BAR_CONTENT_HEIGHT + bottomPad,
            paddingBottom: bottomPad,
          },
        ],
        // The label is drawn inside the pill (TabIcon), so it highlights with the icon.
        tabBarShowLabel: false,
        tabBarItemStyle: styles.item,
        tabBarIconStyle: styles.iconSlot,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon name="home" label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="pending"
        options={{
          title: 'Tasks',
          // Agronomist-only tab.
          href: isAgronomist ? undefined : null,
          tabBarIcon: ({ focused }) => <TabIcon name="clipboard" label="Tasks" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="onboarded"
        options={{
          title: 'People',
          href: isAgronomist ? undefined : null,
          tabBarIcon: ({ focused }) => <TabIcon name="people" label="People" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: 'Calls',
          href: isAgronomist ? undefined : null,
          tabBarIcon: ({ focused }) => <TabIcon name="call" label="Calls" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon name="person" label="Profile" focused={focused} />,
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
    // Lifted off the screen by a soft shadow rather than ruled off by a line,
    // with the top corners rounded to match the cards above it.
    borderTopWidth: 0,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 12,
    ...Platform.select({ web: { boxShadow: '0 -2px 12px rgba(0,0,0,0.08)' } as object }),
  },
  item: { paddingTop: 0, justifyContent: 'center' },
  // Room for the pill: by default the icon slot is only as big as an icon.
  iconSlot: { width: '100%', height: 52 },
  pill: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  pillActive: { backgroundColor: Brand.primarySurface },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.1 },
  labelActive: { fontWeight: '800' },
});
