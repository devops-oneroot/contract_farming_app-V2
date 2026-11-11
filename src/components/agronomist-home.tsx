import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { BannerCarousel, type BannerSlide } from '@/components/banner-carousel';
import { CallFab } from '@/components/call-fab';
import { DailyNoticeToast } from '@/components/daily-notice-toast';
import { Photos } from '@/constants/photos';
import { ThemedText } from '@/components/themed-text';
import { Brand, CardShadow, LogoAspect, Logos, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useContentWidth } from '@/hooks/use-content-width';
import { useTheme } from '@/hooks/use-theme';
import { api, Attendance, DayStats, isSenior, StaffRole, TrackingSession } from '@/lib/api';
import { flushPendingStop } from '@/lib/tracking';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

const ROLES: { key: StaffRole; label: string; desc: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'field_guy', label: 'Field Guy', desc: 'Track visits & tasks in field', icon: 'walk-outline' },
  { key: 'agronomist', label: 'Agronomist', desc: 'Analyze crops & give recommendations', icon: 'leaf-outline' },
  { key: 'junior_agronomist', label: 'Junior Agronomist', desc: 'Analyze crops & give recommendations', icon: 'school-outline' },
  { key: 'senior_agronomist', label: 'Senior Agronomist', desc: 'Analyze crops & give recommendations', icon: 'star-outline' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/** First name only — a full name pushes the date onto a second line. */
const firstName = (name?: string) => (name ?? '').trim().split(/\s+/)[0] || 'there';

// Quick-action grid: three across on a phone, four on a tablet.
const GRID_GAP = 10;

export function AgronomistHome() {
  const theme = useTheme();
  const router = useRouter();
  const scheme = useColorScheme();
  const width = useContentWidth();
  const cols = width >= 560 ? 4 : 3;
  // The logo is the header's anchor; a little smaller on a narrow phone so the name still fits beside it.
  const logoH = width < 360 ? 26 : 32;
  // Measured, not a percentage: three percentages plus their gaps overflow the
  // row by a pixel on some widths and the grid falls back to two columns.
  const tileWidth = Math.floor((width - Spacing.four * 2 - GRID_GAP * (cols - 1)) / cols);
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [selectedRole, setSelectedRole] = useState<StaffRole>('agronomist');

  // A senior sees everyone's waiting reports; anyone else sees their own.
  const senior = isSenior(user?.role);
  const [openCount, setOpenCount] = useState(0);
  const [stats, setStats] = useState<DayStats | null>(null);
  const [session, setSession] = useState<TrackingSession | null>(null);
  // Today's attendance row - present once START (or a no-field day) has been used.
  const [todayAtt, setTodayAtt] = useState<Attendance | null>(null);
  const [fpoCount, setFpoCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      // Independent: a slow or failed one must not blank the others.
      api
        .listDiseaseReports(senior ? { status: 'open' } : { reporterId: user._id, status: 'open' })
        .then((rs) => setOpenCount(rs.length))
        .catch(() => setOpenCount(0));
      api.getDayStats(user._id).then(setStats).catch(() => setStats(null));
      // An END (the day's attendance) that couldn't reach the server is retried
      // every time the home screen is opened, until it lands.
      flushPendingStop().catch(() => {});
      api.currentTracking(user._id).then(setSession).catch(() => setSession(null));
      api.currentAttendance(user._id).then(setTodayAtt).catch(() => setTodayAtt(null));
      api
        .listFpos({ agronomistId: user._id })
        .then((fs) => setFpoCount(fs.length))
        .catch(() => setFpoCount(0));
    }, [user, senior])
  );

  // In full where there is room beside the greeting; "Wed, Nov 4" on phones up to 400pt wide.
  const today = new Date().toLocaleDateString(
    undefined,
    width < 400 ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long' }
  );

  const openRole = (role: (typeof ROLES)[number]) => {
    setSelectedRole(role.key);
    router.push({ pathname: '/agent-actions', params: { role: role.key, label: role.label } } as never);
  };

  const tracking = !!session && !session.endAt;
  // START is once a day (the server refuses a second one), so after today's
  // END the dashboard stops offering it.
  const usedToday =
    !tracking && !!todayAtt && new Date(todayAtt.startAt).toDateString() === new Date().toDateString();

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
      // One name for both sides of the same screen: a senior gives advisory
      // here, an agronomist receives it. The subtitle says which.
      label: 'Advisory Section',
      sub: senior ? 'Awaiting advice' : 'Advice received',
      icon: 'bug',
      tint: Brand.danger,
      well: Brand.dangerSurface,
      route: '/disease-reports',
      badge: openCount,
    },
    {
      key: 'given',
      label: 'Products Given',
      sub: 'Who got what',
      icon: 'cube',
      tint: Brand.secondary,
      well: Brand.secondarySurface,
      route: '/products-given',
    },
    {
      key: 'stock',
      label: 'My Stock',
      sub: 'Received & in hand',
      icon: 'file-tray-stacked',
      tint: GREEN,
      well: Brand.primarySurface,
      route: '/stock-ledger',
    },
    {
      key: 'day',
      label: 'My Day',
      sub: tracking ? 'Recording' : usedToday ? 'Done for today' : 'Start tracking',
      icon: 'navigate',
      tint: Brand.secondary,
      well: Brand.secondarySurface,
      route: '/tracking',
    },
    {
      key: 'calendar',
      label: 'Calendar',
      sub: 'Follow-ups & history',
      icon: 'calendar',
      tint: Brand.accent,
      well: Brand.accentSurface,
      route: '/calendar',
    },
    {
      key: 'attendance',
      label: 'Attendance',
      sub: 'Present / absent',
      icon: 'finger-print',
      tint: Brand.secondary,
      well: Brand.secondarySurface,
      route: '/attendance',
    },
    /**
     * Seniors only. Spread away rather than rendered and hidden, so the tile
     * does not exist at all for an ordinary agronomist — and the screen behind
     * it checks the role again, since a hidden tile is not access control.
     */
    ...(senior
      ? [
          {
            key: 'team',
            label: 'Team',
            sub: "Everyone's work today",
            icon: 'people' as const,
            tint: Brand.primary,
            well: Brand.primarySurface,
            route: '/team',
          },
        ]
      : []),
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

  const slides: BannerSlide[] = [
    { image: require('@/assets/images/banners/contract-farming.jpg') },
    {
      image: Photos.fieldVisit,
      kicker: 'IN THE FIELD',
      title: 'Every visit grows a better harvest',
      cta: 'Plan visits',
      onPress: () => router.push('/farm-visits' as never),
    },
    { image: require('@/assets/images/banners/partnership.jpg') },
  ];

  const statCells = [
    { value: String(stats?.visits ?? 0), label: 'Visits', icon: 'location' as const, tint: GREEN, well: Brand.primarySurface, route: null },
    {
      value: String(stats?.newFarmers ?? 0),
      label: 'Onboarded',
      icon: 'person-add' as const,
      tint: Brand.secondary,
      well: Brand.secondarySurface,
      // Opens the People list narrowed to exactly what this counts:
      // farmers YOU registered, today. `t` forces a fresh param on
      // every tap so returning to the tab re-applies the scope.
      route: {
        pathname: '/(tabs)/onboarded',
        params: { scope: 'onboardedToday', t: String(Date.now()) },
      },
    },
    { value: `${stats?.distanceKm ?? 0}`, label: 'km today', icon: 'navigate' as const, tint: Brand.accent, well: Brand.accentSurface, route: '/tracking' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero: who, when, and whether the day is being recorded. Full-bleed
            colour with a curved foot, so the first screen has a face rather
            than a list of boxes. */}
        <View style={styles.hero}>
          {/* Decoration only - large faded leaves behind the content. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[styles.blob, { width: 220, height: 220, top: -70, right: -60 }]} />
            <View style={[styles.blob, { width: 140, height: 140, bottom: -30, left: -40 }]} />
            <Ionicons name="leaf" size={150} color="rgba(255,255,255,0.07)" style={styles.heroLeaf} />
          </View>

          <SafeAreaView edges={['top']}>
            {/* The brand, large, on the left; the avatar on the right opens Profile. */}
            <View style={styles.header}>
              <Image
                source={Logos.horizontalWhite}
                style={{ height: logoH, width: logoH * LogoAspect.horizontal }}
                contentFit="contain"
                accessibilityLabel="OneRoot"
              />
              <Pressable
                onPress={() => router.push('/(tabs)/profile' as never)}
                hitSlop={6}
                accessibilityLabel="Profile"
                style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.85 }]}>
                <ThemedText style={styles.avatarText}>
                  {user?.name?.charAt(0)?.toUpperCase() ?? '?'}
                </ThemedText>
              </Pressable>
            </View>

            {/* Greeting above the name on the left; the date on the right, level with the name. */}
            <View style={styles.dayRow}>
              <View style={styles.who}>
                <ThemedText style={styles.hello} numberOfLines={1}>
                  {greeting()} 👋
                </ThemedText>
                <ThemedText style={styles.name} numberOfLines={1}>
                  {firstName(user?.name)}
                </ThemedText>
              </View>
              <View style={styles.datePill}>
                <Ionicons name="calendar-outline" size={12} color="#fff" />
                <ThemedText style={styles.today} numberOfLines={1}>
                  {today}
                </ThemedText>
              </View>
            </View>

            {/* Whether the day is being tracked — a status, so it leads and reads
                at a glance, fixed in place rather than one slide among photos
                that might be showing something else. */}
            <Pressable
              onPress={() => router.push('/tracking' as never)}
              style={({ pressed }) => [styles.statusCard, pressed && { opacity: 0.9 }]}>
              <View style={[styles.statusIcon, tracking && styles.statusIconOn]}>
                <Ionicons
                  name={tracking ? 'radio' : usedToday ? 'checkmark-done' : 'navigate-outline'}
                  size={20}
                  color={tracking ? GREEN : '#fff'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" style={{ fontSize: 15, color: '#fff' }}>
                  {tracking
                    ? `Tracking · ${stats?.distanceKm ?? 0} km today`
                    : usedToday
                      ? `Day done · ${stats?.distanceKm ?? 0} km today`
                      : 'Not tracking'}
                </ThemedText>
                <ThemedText type="small" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  {tracking
                    ? 'Tap to see your day'
                    : usedToday
                      ? 'START is once a day – tap to see your day'
                      : 'Tap START when you set off – this marks your attendance'}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.statusPill,
                  tracking && { backgroundColor: Brand.danger },
                  usedToday && { backgroundColor: 'rgba(255,255,255,0.35)' },
                ]}>
                <ThemedText
                  type="small"
                  style={{ color: tracking || usedToday ? '#fff' : GREEN, fontWeight: '800' }}>
                  {tracking ? 'END' : usedToday ? 'DONE' : 'START'}
                </ThemedText>
              </View>
            </Pressable>

            {/* Campaign photos, sliding on the orange. */}
            <View style={styles.carousel}>
              <BannerCarousel slides={slides} onDark />
            </View>
          </SafeAreaView>
        </View>

        {/* Today, measured. Same numbers the daily report files. Overlaps the
            hero's foot, which is what ties the two together. */}
        <View style={styles.statsCard}>
          {statCells.map((s, i) => (
            <Pressable
              key={s.label}
              onPress={s.route ? () => router.push(s.route as never) : undefined}
              disabled={!s.route}
              style={({ pressed }) => [
                styles.statCell,
                i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.backgroundSelected },
                pressed && s.route && { opacity: 0.7 },
              ]}>
              <View style={[styles.statIcon, { backgroundColor: s.well }]}>
                <Ionicons name={s.icon} size={16} color={s.tint} />
              </View>
              <ThemedText style={styles.statValue}>{s.value}</ThemedText>
              <View style={styles.statLabelRow}>
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                  {s.label}
                </ThemedText>
                {s.route ? <Ionicons name="chevron-forward" size={11} color={theme.textSecondary} /> : null}
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.content}>
          {/* Actions as a grid — four stacked full-width rows pushed the role
              picker off the first screen entirely. */}
          <View style={styles.sectionRow}>
            <ThemedText style={[styles.sectionTitle, { flex: 1 }]}>Quick actions</ThemedText>
            {/* Same button as the one beside the Farm Visits search bar, so
                registering a farmer looks the same wherever it is offered. */}
            <Pressable
              onPress={() => router.push('/onboard-farmer' as never)}
              hitSlop={8}
              accessibilityLabel="Add a farmer"
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="person-add" size={15} color="#fff" />
              <ThemedText type="small" style={{ color: '#fff', fontWeight: '800' }}>
                Farmer
              </ThemedText>
            </Pressable>
          </View>
          <View style={styles.grid}>
            {actions.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => router.push(a.route as never)}
                style={({ pressed }) => [
                  styles.tile,
                  { width: tileWidth },
                  pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
                ]}>
                <View style={[styles.tileIcon, { backgroundColor: a.well }]}>
                  <Ionicons name={a.icon} size={20} color={a.tint} />
                  {a.badge ? (
                    <View style={styles.badge}>
                      <ThemedText style={styles.badgeText}>{a.badge}</ThemedText>
                    </View>
                  ) : null}
                </View>
                {/* Name and subtitle at the foot of the tile, so they line up
                    across a row whether the name takes one line or two. */}
                <View>
                  <ThemedText type="smallBold" style={styles.tileLabel} numberOfLines={2}>
                    {a.label}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tileSub} numberOfLines={1}>
                    {a.sub}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </View>

          <ThemedText style={styles.sectionTitle}>Work as</ThemedText>
        </View>
        {/* Sideways: four roles stacked took a whole screen of scrolling. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roleRow}>
          {ROLES.map((r) => {
            const on = selectedRole === r.key;
            return (
              <Pressable
                key={r.key}
                onPress={() => openRole(r)}
                style={({ pressed }) => [
                  styles.roleCard,
                  on && { borderColor: GREEN, backgroundColor: Brand.primarySurface },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={[styles.roleIcon, on && { backgroundColor: GREEN }]}>
                  <Ionicons name={r.icon} size={20} color={on ? '#fff' : GREEN} />
                </View>
                <ThemedText type="smallBold" style={{ fontSize: 14 }} numberOfLines={1}>
                  {r.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }} numberOfLines={2}>
                  {r.desc}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.content}>
          {/* Sits at the bottom on purpose: onboarding an FPO is occasional
              work, unlike the daily visit-and-report loop above it. */}
          <ThemedText style={styles.sectionTitle}>FPO onboarding</ThemedText>
          {/* The list, not the form: seeing what is already there before
              adding is what stops the same FPO being registered twice. The
              list carries its own + button. */}
          <Pressable
            onPress={() => router.push('/fpos' as never)}
            style={({ pressed }) => [styles.fpoCard, pressed && { opacity: 0.9 }]}>
            <Ionicons name="business" size={110} color="rgba(255,255,255,0.12)" style={styles.fpoArt} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.fpoTitle}>My FPOs</ThemedText>
              <ThemedText type="small" style={{ color: 'rgba(255,255,255,0.88)' }} numberOfLines={2}>
                {fpoCount > 0
                  ? `${fpoCount} onboarded · tap to view or edit`
                  : 'None yet — tap to onboard your first'}
              </ThemedText>
              <View style={styles.fpoCta}>
                <ThemedText type="small" style={{ color: Brand.secondaryDark, fontWeight: '800' }}>
                  {fpoCount > 0 ? 'View FPOs' : 'Onboard FPO'}
                </ThemedText>
                <Ionicons name="arrow-forward" size={14} color={Brand.secondaryDark} />
              </View>
            </View>
            {fpoCount > 0 && (
              <View style={styles.fpoCount}>
                <ThemedText style={styles.fpoCountText}>{fpoCount}</ThemedText>
              </View>
            )}
          </Pressable>
        </View>
      </ScrollView>

      <CallFab />
      {/* Once a day: attendance and the visit target. Over everything else. */}
      <DailyNoticeToast userId={user?._id} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: 120 },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.three },

  hero: {
    backgroundColor: Brand.primaryDark,
    paddingHorizontal: Spacing.four,
    paddingBottom: 56,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
  },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroLeaf: { position: 'absolute', right: -24, top: 40, transform: [{ rotate: '-20deg' }] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Brand.primaryDark, fontSize: 18, fontWeight: '800' },
  hello: { color: 'rgba(255,255,255,0.88)', fontSize: 18, lineHeight: 18, fontWeight: '600' },
  dayRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.two, marginTop: Spacing.three },
  who: { flexShrink: 1 },
  name: { color: '#fff', fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginBottom: 4,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  today: { flexShrink: 1, color: '#fff', fontSize: 12, fontWeight: '600' },


  statsCard: {
    flexDirection: 'row',
    marginHorizontal: Spacing.four,
    marginTop: -36,
    marginBottom: Spacing.four,
    paddingVertical: Spacing.three,
    backgroundColor: '#fff',
    borderRadius: Radius.xl,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 4 },
  statIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 22, lineHeight: 26, fontWeight: '800', color: Brand.ink },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },

  carousel: { marginTop: Spacing.two },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.xl,
    // Frosted: a lighter pane of the hero rather than a separate white box.
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconOn: { backgroundColor: '#fff' },
  statusPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: '#fff',
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, marginTop: Spacing.one },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    backgroundColor: GREEN,
    ...CardShadow,
  },

  // Three across, icon over label - the "services" grid of most store apps.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tile: {
    // Icon at the top, name and subtitle at the foot: the same height and the
    // same baseline whether the name takes one line or two.
    minHeight: 116,
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
    ...CardShadow,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  tileLabel: { fontSize: 12, lineHeight: 15 },
  tileSub: { fontSize: 10, lineHeight: 13, marginTop: 1 },
  badge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: Brand.danger,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, lineHeight: 13, fontWeight: '800' },

  roleRow: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  roleCard: {
    width: 150,
    gap: 4,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    ...CardShadow,
  },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: Brand.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },

  fpoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.xl,
    backgroundColor: Brand.secondary,
    overflow: 'hidden',
    ...CardShadow,
  },
  fpoArt: { position: 'absolute', right: -14, bottom: -22, transform: [{ rotate: '-8deg' }] },
  fpoTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  fpoCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: '#fff',
  },
  fpoCount: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  fpoCountText: { color: '#fff', fontSize: 18, fontWeight: '800' },
});
