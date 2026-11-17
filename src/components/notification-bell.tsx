import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, CardShadow } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { refreshUnread, useUnread } from '@/lib/notifications';

/**
 * The bell in every header: the unread count on it, and the Notifications
 * screen behind it. `light` is for the coloured headers (Home, Profile),
 * where it sits white on the brand colour.
 */
export function NotificationBell({ light = false }: { light?: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const unread = useUnread();

  // Fresh whenever a screen with a bell comes back into view.
  useFocusEffect(
    useCallback(() => {
      refreshUnread(user?._id);
    }, [user?._id])
  );

  return (
    <Pressable
      onPress={() => router.push('/notifications' as never)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      style={({ pressed }) => [
        styles.btn,
        light ? styles.light : [{ backgroundColor: theme.card }, CardShadow],
        pressed && { opacity: 0.75 },
      ]}>
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={21} color={light ? '#fff' : theme.text} />
      {unread > 0 ? (
        <View style={[styles.badge, { borderColor: light ? Brand.primary : theme.card }]}>
          <ThemedText style={styles.badgeText}>{unread > 99 ? '99+' : unread}</ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  light: { backgroundColor: 'rgba(255,255,255,0.18)' },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: Brand.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 12 },
});
