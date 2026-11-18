import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { SafeAreaView } from '@/components/safe-area-view';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, AppNotification } from '@/lib/api';
import { setUnread } from '@/lib/notifications';

/** How each kind of notification looks, and where tapping it goes. */
const KIND: Record<string, { icon: keyof typeof Ionicons.glyphMap; tint: string; bg: string }> = {
  'disease-report': { icon: 'bug', tint: Brand.danger, bg: Brand.dangerSurface },
  'disease-reply': { icon: 'chatbubbles', tint: Brand.secondary, bg: Brand.secondarySurface },
  'product-photo': { icon: 'leaf', tint: Brand.primary, bg: Brand.primarySurface },
};
const FALLBACK = { icon: 'notifications' as const, tint: Brand.primary, bg: Brand.primarySurface };

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Today / Yesterday / Earlier, so a long list reads in time order. */
function groupOf(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  return 'Earlier';
}

/**
 * Every notification this user was sent - disease reports to answer, replies
 * to their own reports, products applied by their farmers - newest first.
 * Opening the screen marks them read; tapping one opens what it is about.
 */
export default function NotificationsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : Brand.surface;

  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // No user yet (the session is still being restored): show the empty list
    // instead of a spinner nothing will ever stop. Reloads once they arrive.
    if (!user?._id) {
      setItems((v) => v ?? []);
      setRefreshing(false);
      return;
    }
    try {
      // A request that never answers (bad signal, a server waking up) must not
      // hold the screen on the spinner for ever: give up after 20 s and say so.
      const r = await Promise.race([
        api.listNotifications(user._id, 100),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Taking too long. Check your internet and pull down to retry.')), 20_000)
        ),
      ]);
      setItems(r.items);
      setError(null);
      // Seen now: clear the badge everywhere, and on the server.
      if (r.unread > 0) {
        setUnread(0);
        api.markNotificationsRead(user._id).catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load notifications.');
      setItems((v) => v ?? []);
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  // On every return to the screen (fresh list), and once on mount as well: if
  // the focus event does not reach this screen, it must still load.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  useEffect(() => {
    load();
  }, [load]);

  const open = (n: AppNotification) => {
    const t = n.data?.type;
    if (t === 'disease-report' || t === 'disease-reply') router.push('/disease-reports' as never);
    else if (t === 'product-photo' && n.data.farmerId) {
      router.push({ pathname: '/farmer', params: { farmerId: String(n.data.farmerId), name: '' } } as never);
    }
  };

  let lastGroup = '';

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader title="Notifications" onBack={() => router.back()} bell={false} />

        {items === null ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={Brand.primary} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load();
                }}
              />
            }>
            {error ? (
              <View style={styles.errorBox}>
                <ThemedText type="small" style={{ color: Brand.danger, flex: 1 }}>
                  {error}
                </ThemedText>
                <Pressable
                  onPress={() => {
                    setRefreshing(true);
                    load();
                  }}
                  hitSlop={8}>
                  <ThemedText type="smallBold" style={{ color: Brand.primary }}>
                    Try again
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            {items.length === 0 && !error ? (
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: Brand.primarySurface }]}>
                  <Ionicons name="notifications-off-outline" size={30} color={Brand.primary} />
                </View>
                <ThemedText type="smallBold">No notifications yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  Disease reports, replies to your reports and updates from your farmers will show here.
                </ThemedText>
              </View>
            ) : null}

            {items.map((n) => {
              const k = KIND[n.data?.type ?? ''] ?? FALLBACK;
              const g = groupOf(n.createdAt);
              const header = g !== lastGroup ? g : null;
              lastGroup = g;
              const tappable = !!n.data?.type && n.data.type in KIND;
              return (
                <View key={n._id}>
                  {header ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.group}>
                      {header.toUpperCase()}
                    </ThemedText>
                  ) : null}
                  <Pressable
                    onPress={() => open(n)}
                    disabled={!tappable}
                    style={({ pressed }) => [
                      styles.item,
                      { backgroundColor: scheme === 'dark' ? theme.backgroundElement : Brand.card },
                      !n.read && { borderLeftColor: Brand.primary, borderLeftWidth: 3 },
                      pressed && { opacity: 0.85 },
                    ]}>
                    <View style={[styles.icon, { backgroundColor: k.bg }]}>
                      <Ionicons name={k.icon} size={18} color={k.tint} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.titleRow}>
                        <ThemedText type="smallBold" style={{ flex: 1 }} numberOfLines={2}>
                          {n.title}
                        </ThemedText>
                        {!n.read ? <View style={styles.dot} /> : null}
                      </View>
                      {n.body ? (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                          {n.body}
                        </ThemedText>
                      ) : null}
                      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                        {ago(n.createdAt)}
                      </ThemedText>
                    </View>
                    {tappable ? <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Brand.dangerSurface,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  group: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: Spacing.three, marginBottom: Spacing.two },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    marginBottom: Spacing.two,
  },
  icon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Brand.primary, marginTop: 5 },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
