import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { TextInput } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';

import { ThemedText } from '@/components/themed-text';
import { NotificationBell } from '@/components/notification-bell';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, CardShadow, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, CallLog } from '@/lib/api';
import { callFarmer } from '@/lib/call';

const ORANGE = Brand.primary;
const BLUE = '#2F7BD8';

type Filter = 'all' | 'connected' | 'missed';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'connected', label: 'Connected' },
  { key: 'missed', label: 'Not connected' },
];

/** Avatar colours, picked from the name so a farmer keeps the same one. */
const AVATAR_COLORS = [Brand.primary, Brand.secondary, BLUE, '#8B5CF6', '#D9A300', '#E5484D', '#0D9488'];
function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** "Pradeep R" -> "PR". */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A call that actually got through: answered, or ran for some seconds. */
const isConnected = (l: CallLog) => (l.duration ?? 0) > 0 || l.status === 'answered' || l.status === 'completed';

/** What the call's pill says, and its colours. */
function statusOf(l: CallLog): { label: string; fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap } {
  if (isConnected(l)) return { label: 'Connected', fg: Brand.secondaryDark, bg: Brand.secondarySurface, icon: 'checkmark-circle' };
  if (l.status === 'no_answer') return { label: 'Not answered', fg: Brand.danger, bg: Brand.dangerSurface, icon: 'close-circle' };
  if (l.status === 'failed') return { label: 'Failed', fg: Brand.danger, bg: Brand.dangerSurface, icon: 'alert-circle' };
  if (l.status === 'ringing') return { label: 'Ringing', fg: '#9A6B00', bg: Brand.accentSurface, icon: 'notifications' };
  return { label: 'Dialled', fg: '#5F6368', bg: '#EEF0F2', icon: 'call' };
}

/** 75 -> "1m 15s", 3700 -> "1h 1m". */
function talkTime(sec: number) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Group a day's calls under a heading like "Today" / "Yesterday" / "12 Jul".
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Calls tab - every call this agent made to a farmer, newest first: a summary
 * of today and the week on top, then search, a connected / not connected
 * filter, and the calls grouped by day with how each one went.
 */
export default function CallsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : Brand.surface;

  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLogs(await api.listCallLogs(user._id));
    } catch {
      // keep what is shown; pull to refresh tries again
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /** Today, the last 7 days, how many got through, and the time spent talking. */
  const summary = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const week = logs.filter((l) => new Date(l.calledAt) >= weekAgo);
    return {
      today: logs.filter((l) => sameDay(new Date(l.calledAt), now)).length,
      week: week.length,
      connected: week.filter(isConnected).length,
      talk: week.reduce((s, l) => s + (l.duration ?? 0), 0),
    };
  }, [logs]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (filter === 'connected' && !isConnected(l)) return false;
      if (filter === 'missed' && isConnected(l)) return false;
      if (!q) return true;
      return (l.farmerName || '').toLowerCase().includes(q) || (l.farmerMobile || '').includes(q);
    });
  }, [logs, query, filter]);

  // Sections: [{ label, items }] preserving newest-first order.
  const sections = useMemo(() => {
    const out: { label: string; items: CallLog[] }[] = [];
    for (const l of shown) {
      const label = dayLabel(l.calledAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(l);
      else out.push({ label, items: [l] });
    }
    return out;
  }, [shown]);

  const tiles: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; tint: string }[] = [
    { label: 'Today', value: String(summary.today), icon: 'today-outline', tint: ORANGE },
    { label: 'This week', value: String(summary.week), icon: 'calendar-outline', tint: BLUE },
    { label: 'Connected', value: String(summary.connected), icon: 'checkmark-done-outline', tint: Brand.secondary },
    { label: 'Talk time', value: talkTime(summary.talk), icon: 'time-outline', tint: Brand.accent },
  ];

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.headerTitle}>Call Logs</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Calls you made to farmers
            </ThemedText>
          </View>
          <NotificationBell />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[ORANGE]}
              tintColor={ORANGE}
            />
          }>
          {/* The week at a glance. */}
          <ThemedView style={styles.summary}>
            {tiles.map((t, i) => (
              <View key={t.label} style={[styles.tile, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.backgroundSelected }]}>
                <View style={[styles.tileIcon, { backgroundColor: `${t.tint}1F` }]}>
                  <Ionicons name={t.icon} size={16} color={t.tint} />
                </View>
                <ThemedText style={styles.tileValue} numberOfLines={1}>
                  {t.value}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.tileLabel} numberOfLines={1}>
                  {t.label}
                </ThemedText>
              </View>
            ))}
          </ThemedView>

          {/* Search and filter. */}
          <View style={[styles.search, { backgroundColor: theme.card }]}>
            <Ionicons name="search" size={17} color={theme.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by farmer name or number"
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.text }]}
              returnKeyType="search"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.chips}>
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[styles.chip, on ? styles.chipOn : { backgroundColor: theme.card }]}>
                  <ThemedText style={[styles.chipText, { color: on ? '#fff' : theme.text }]}>{f.label}</ThemedText>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={ORANGE} />
          ) : sections.length === 0 ? (
            <ThemedView style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="call-outline" size={30} color={ORANGE} />
              </View>
              <ThemedText type="smallBold">{logs.length ? 'No calls match' : 'No calls yet'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {logs.length
                  ? 'Try another name or number, or clear the filter.'
                  : 'Tap the call button on a farmer or a task to get started.'}
              </ThemedText>
            </ThemedView>
          ) : (
            sections.map((sec) => (
              <View key={sec.label} style={{ gap: Spacing.two }}>
                <View style={styles.sectionRow}>
                  <ThemedText type="smallBold" style={styles.sectionLabel}>
                    {sec.label}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                    {sec.items.length} call{sec.items.length === 1 ? '' : 's'}
                  </ThemedText>
                </View>
                {sec.items.map((l) => {
                  const name = l.farmerName || l.farmerMobile || 'Unknown';
                  const st = statusOf(l);
                  return (
                    <ThemedView key={l._id} style={styles.card}>
                      <View style={[styles.avatar, { backgroundColor: avatarColor(name) }]}>
                        <ThemedText style={styles.avatarText}>{initials(name)}</ThemedText>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ThemedText style={styles.name} numberOfLines={1}>
                          {name}
                        </ThemedText>
                        <View style={styles.metaRow}>
                          <Ionicons name="arrow-up-outline" size={12} color={ORANGE} style={{ transform: [{ rotate: '45deg' }] }} />
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={{ fontSize: 12 }}>
                            {l.farmerMobile} ·{' '}
                            {new Date(l.calledAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </ThemedText>
                        </View>
                        <View style={styles.tagRow}>
                          <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                            <Ionicons name={st.icon} size={11} color={st.fg} />
                            <ThemedText style={[styles.statusText, { color: st.fg }]}>{st.label}</ThemedText>
                          </View>
                          {(l.duration ?? 0) > 0 && (
                            <View style={styles.durationPill}>
                              <Ionicons name="time-outline" size={11} color="#5F6368" />
                              <ThemedText style={styles.durationText}>{talkTime(l.duration ?? 0)}</ThemedText>
                            </View>
                          )}
                          {l.recordingUrl ? (
                            <View style={styles.durationPill}>
                              <Ionicons name="mic-outline" size={11} color="#5F6368" />
                              <ThemedText style={styles.durationText}>Recorded</ThemedText>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <Pressable
                        onPress={() => callFarmer(user, { _id: l.farmer, name: l.farmerName, mobile: l.farmerMobile })}
                        hitSlop={8}
                        accessibilityLabel={`Call ${name} again`}
                        style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.8 }]}>
                        <Ionicons name="call" size={17} color="#fff" />
                      </Pressable>
                    </ThemedView>
                  );
                })}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  summary: { flexDirection: 'row', borderRadius: Radius.lg, paddingVertical: Spacing.three, ...CardShadow },
  tile: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  tileIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  tileValue: { fontSize: 17, fontWeight: '800', lineHeight: 22 },
  tileLabel: { fontSize: 11 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    ...CardShadow,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 15 },
  chips: { flexDirection: 'row', gap: Spacing.two, marginTop: -Spacing.one },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, ...CardShadow },
  chipOn: { backgroundColor: ORANGE },
  chipText: { fontSize: 13, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.one },
  sectionLabel: { fontSize: 14, color: ORANGE },
  empty: {
    marginTop: Spacing.three,
    padding: Spacing.five,
    borderRadius: Radius.lg,
    alignItems: 'center',
    gap: Spacing.two,
    ...CardShadow,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Brand.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    ...CardShadow,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700' },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#EEF0F2',
  },
  durationText: { fontSize: 11, fontWeight: '600', color: '#5F6368' },
  callBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Brand.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
