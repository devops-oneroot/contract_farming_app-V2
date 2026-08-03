import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CallFab } from '@/components/call-fab';
import { ThemedText } from '@/components/themed-text';
import { Brand, CardShadow, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, DayStats, isSenior, StaffRole, TrackingSession } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;
const LOGO = require('@/assets/images/logo.png');

const ROLES: { key: StaffRole; label: string; desc: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'field_guy', label: 'Field Guy', desc: 'Track visits & tasks in field', icon: 'walk-outline' },
  { key: 'agronomist', label: 'Agronomist', desc: 'Analyze crops & give recommendations', icon: 'leaf-outline' },
  { key: 'junior_agronomist', label: 'Junior Agronomist', desc: 'Analyze crops & give recommendations', icon: 'school-outline' },
  { key: 'senior_agronomist', label: 'Senior Agronomist', desc: 'Analyze crops & give recommendations', icon: 'star-outline' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First name only — a full name pushes the date onto a second line. */
const firstName = (name?: string) => (name ?? '').trim().split(/\s+/)[0] || 'there';

export function AgronomistHome() {
  const theme = useTheme();
  const router = useRouter();
  const scheme = useColorScheme();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [selectedRole, setSelectedRole] = useState<StaffRole>('agronomist');

  // A senior sees everyone's waiting reports; anyone else sees their own.
  const senior = isSenior(user?.role);
  const [openCount, setOpenCount] = useState(0);
  const [stats, setStats] = useState<DayStats | null>(null);
  const [session, setSession] = useState<TrackingSession | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      // Independent: a slow or failed one must not blank the others.
      api
        .listDiseaseReports(senior ? { status: 'open' } : { reporterId: user._id, status: 'open' })
        .then((rs) => setOpenCount(rs.length))
        .catch(() => setOpenCount(0));
      api.getDayStats(user._id).then(setStats).catch(() => setStats(null));
      api.currentTracking(user._id).then(setSession).catch(() => setSession(null));
    }, [user, senior])
  );

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const openRole = (role: (typeof ROLES)[number]) => {
    setSelectedRole(role.key);
    router.push({ pathname: '/agent-actions', params: { role: role.key, label: role.label } } as never);
  };

  const tracking = !!session && !session.endAt;

  const actions: {
    key: string;
    label: string;
    sub: string;
    icon: keyof typeof Ionicons.glyphMap;
    tint: string;
    well: string;
    route: string;
    badge?: number;
  }[] = [
    {
      key: 'visits',
      label: 'Farm Visits',
      sub: 'Nearest first',
      icon: 'map',
      tint: GREEN,
      well: Brand.primarySurface,
      route: '/farm-visits',
    },
    {
      key: 'disease',
      label: senior ? 'Disease Reports' : 'My Reports',
      sub: senior ? 'Awaiting advice' : 'Advice received',
      icon: 'bug',
      tint: Brand.danger,
      well: Brand.dangerSurface,
      route: '/disease-reports',
      badge: openCount,
    },
    {
      key: 'day',
      label: 'My Day',
      sub: tracking ? 'Recording' : 'Start tracking',
      icon: 'navigate',
      tint: Brand.secondary,
      well: Brand.secondarySurface,
      route: '/tracking',
    },
    {
      key: 'report',
      label: 'Daily Report',
      sub: 'End of day',
      icon: 'document-text',
      tint: Brand.accent,
      well: Brand.accentSurface,
      route: '/daily-report',
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.avatar}>
              <ThemedText style={styles.avatarText}>
                {user?.name?.charAt(0)?.toUpperCase() ?? '?'}
              </ThemedText>
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.greeting}>
                {greeting()}, {firstName(user?.name)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {today}
              </ThemedText>
            </View>
            <View style={styles.logoPill}>
              <Image source={LOGO} style={styles.logoImg} contentFit="contain" />
            </View>
          </View>

          {/* Whether the day is being tracked — a status, so it leads and reads
              at a glance rather than sitting in the action grid. */}
          <Pressable
            onPress={() => router.push('/tracking' as never)}
            style={({ pressed }) => [
              styles.statusCard,
              { backgroundColor: tracking ? GREEN : '#fff' },
              pressed && { opacity: 0.9 },
            ]}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: tracking ? '#fff' : theme.textSecondary },
              ]}
            />
            <View style={{ flex: 1 }}>
              <ThemedText
                type="smallBold"
                style={{ fontSize: 15, color: tracking ? '#fff' : theme.text }}>
                {tracking ? `Tracking · ${stats?.distanceKm ?? 0} km today` : 'Not tracking'}
              </ThemedText>
              <ThemedText
                type="small"
                style={{ color: tracking ? 'rgba(255,255,255,0.85)' : theme.textSecondary }}>
                {tracking ? 'Tap to see your day' : 'Tap START when you set off'}
              </ThemedText>
            </View>
            <View style={[styles.statusPill, { backgroundColor: tracking ? 'rgba(255,255,255,0.2)' : GREEN }]}>
              <ThemedText type="small" style={{ color: '#fff', fontWeight: '800' }}>
                {tracking ? 'END' : 'START'}
              </ThemedText>
            </View>
          </Pressable>

          {/* Today, measured. Same numbers the daily report files. */}
          <View style={styles.statRow}>
            {[
              { value: String(stats?.visits ?? 0), label: 'Visits' },
              { value: String(stats?.newFarmers ?? 0), label: 'Onboarded' },
              { value: `${stats?.distanceKm ?? 0}`, label: 'km' },
            ].map((s) => (
              <View key={s.label} style={styles.statCard}>
                <ThemedText style={styles.statValue}>{s.value}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                  {s.label}
                </ThemedText>
              </View>
            ))}
          </View>

          {/* Actions as a grid — four stacked full-width rows pushed the role
              picker off the first screen entirely. */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Quick actions
          </ThemedText>
          <View style={styles.grid}>
            {actions.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => router.push(a.route as never)}
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}>
                <View style={[styles.tileIcon, { backgroundColor: a.well }]}>
                  <Ionicons name={a.icon} size={22} color={a.tint} />
                </View>
                {a.badge ? (
                  <View style={styles.badge}>
                    <ThemedText style={styles.badgeText}>{a.badge}</ThemedText>
                  </View>
                ) : null}
                <ThemedText type="smallBold" style={{ fontSize: 14 }} numberOfLines={1}>
                  {a.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }} numberOfLines={1}>
                  {a.sub}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Work as
          </ThemedText>
          {ROLES.map((r) => {
            const on = selectedRole === r.key;
            return (
              <Pressable
                key={r.key}
                onPress={() => openRole(r)}
                style={({ pressed }) => [
                  styles.roleCard,
                  { borderColor: on ? GREEN : 'transparent' },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={styles.roleIcon}>
                  <Ionicons name={r.icon} size={20} color={GREEN} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" style={{ fontSize: 15 }}>
                    {r.label}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {r.desc}
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      <CallFab />
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: 120, gap: Spacing.three },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.two },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  greeting: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  logoPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...CardShadow,
  },
  logoImg: { width: 22, height: 22 },
  sectionTitle: { fontSize: 15, marginTop: Spacing.one },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Spacing.four,
    ...CardShadow,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.five,
  },

  statRow: { flexDirection: 'row', gap: Spacing.two },
  statCard: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#fff',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    ...CardShadow,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: GREEN },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    gap: 2,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
    ...CardShadow,
  },
  tileIcon: {
    width: 42,
    height: 42,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  badge: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: Brand.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1.5,
    ...CardShadow,
  },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: Spacing.three,
    backgroundColor: Brand.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
