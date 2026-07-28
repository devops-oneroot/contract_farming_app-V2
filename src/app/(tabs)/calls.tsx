import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, CallLog } from '@/lib/api';
import { callFarmer } from '@/lib/call';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

// Group a day's calls under a heading like "Today" / "Yesterday" / "12 Jul".
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CallsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLogs(await api.listCallLogs(user._id));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Sections: [{ label, items }] preserving newest-first order.
  const sections = useMemo(() => {
    const out: { label: string; items: CallLog[] }[] = [];
    for (const l of logs) {
      const label = dayLabel(l.calledAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(l);
      else out.push({ label, items: [l] });
    }
    return out;
  }, [logs]);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle" style={{ fontSize: 22 }}>
            Call Logs
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Calls you made to farmers
          </ThemedText>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : logs.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.empty}>
              <Ionicons name="call-outline" size={40} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                No calls yet. Tap the call button on a farmer or task to get started.
              </ThemedText>
            </ThemedView>
          ) : (
            sections.map((sec) => (
              <View key={sec.label} style={{ gap: Spacing.two }}>
                <ThemedText type="smallBold" style={styles.sectionLabel}>
                  {sec.label}
                </ThemedText>
                {sec.items.map((l) => (
                  <View key={l._id} style={styles.card}>
                    <View style={styles.avatar}>
                      <ThemedText style={styles.avatarText}>
                        {(l.farmerName || '?').charAt(0).toUpperCase()}
                      </ThemedText>
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {l.farmerName || l.farmerMobile}
                      </ThemedText>
                      <View style={styles.metaRow}>
                        <Ionicons name="arrow-up" size={12} color={GREEN} />
                        <ThemedText type="small" themeColor="textSecondary">
                          {l.farmerMobile} ·{' '}
                          {new Date(l.calledAt).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </ThemedText>
                      </View>
                    </View>
                    <Pressable
                      onPress={() =>
                        callFarmer(user, { _id: l.farmer, name: l.farmerName, mobile: l.farmerMobile })
                      }
                      hitSlop={8}
                      style={styles.callBtn}>
                      <Ionicons name="call" size={16} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  sectionLabel: { fontSize: 13, color: GREEN, marginTop: Spacing.two },
  empty: {
    marginTop: Spacing.four,
    padding: Spacing.five,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: Spacing.three,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  callBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
