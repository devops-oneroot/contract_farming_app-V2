import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { DayWorkSheet } from '@/components/day-work-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useContentWidth } from '@/hooks/use-content-width';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Agenda, api } from '@/lib/api';
import { callFarmer } from '@/lib/call';

const GREEN = Brand.primary;
const AMBER = Brand.accent;
const CLAY = Brand.secondary;
const GREEN_SURFACE = Brand.surface;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Local YYYY-MM-DD, matching how the server keys its days. */
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const sameDay = (a: Date, b: Date) => keyOf(a) === keyOf(b);

/**
 * The cells of a month, Monday-first, padded so the first row starts on the
 * right weekday. Nulls are the blanks before the 1st and after the last.
 */
function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  // getDay() is Sunday-first; the grid is Monday-first, as a working week reads.
  const lead = (first.getDay() + 6) % 7;

  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d += 1) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * The month at a glance: which days owe a follow-up, and which already have
 * work recorded against them.
 *
 * Follow-ups and records are marked in different colours on purpose. One is a
 * promise the agent has still to keep; the other is what they already did, and
 * a calendar that blurs the two cannot answer "what do I owe this week".
 */
export default function CalendarScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const width = useContentWidth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date>(today);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const cells = useMemo(() => monthCells(month), [month]);
  // Seven across, inside the screen's padding.
  const cellW = (width - Spacing.four * 2) / 7;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const from = new Date(month.getFullYear(), month.getMonth(), 1);
      const to = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      setAgenda(await api.getAgenda(user._id, from, to));
    } catch {
      setAgenda(null);
    } finally {
      setLoading(false);
    }
  }, [user, month]);

  // Refetched on focus: a follow-up marked elsewhere should be gone from here.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const dayOf = (d: Date) => agenda?.days[keyOf(d)];

  /** The follow-ups owed on the selected day. */
  const dueToday = useMemo(
    () => (agenda?.followUps ?? []).filter((f) => sameDay(new Date(f.dueAt), selected)),
    [agenda, selected]
  );

  const stepMonth = (by: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + by, 1);
    setMonth(next);
    // Land on the 1st, so the panel below never describes a day off-screen.
    setSelected(next);
  };

  const selectedInfo = dayOf(selected);
  const hasRecords =
    !!selectedInfo &&
    (selectedInfo.onboarded > 0 || selectedInfo.visits > 0 || selectedInfo.sales > 0);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader
          onBack={() => router.back()}
          title="Calendar"
          right={
            <>
              <Pressable
                onPress={() => {
                  setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                  setSelected(new Date());
                }}
                hitSlop={10}>
                <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                  Today
                </ThemedText>
              </Pressable>
            </>
          }
        />

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.monthBar}>
            <Pressable onPress={() => stepMonth(-1)} hitSlop={12} style={styles.arrow}>
              <Ionicons name="chevron-back" size={20} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold" style={{ fontSize: 16 }}>
              {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </ThemedText>
            <Pressable onPress={() => stepMonth(1)} hitSlop={12} style={styles.arrow}>
              <Ionicons name="chevron-forward" size={20} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w) => (
              <ThemedText
                key={w}
                type="small"
                themeColor="textSecondary"
                style={[styles.weekday, { width: cellW }]}>
                {w}
              </ThemedText>
            ))}
          </View>

          {loading && !agenda ? (
            <ActivityIndicator style={{ marginTop: Spacing.five }} color={GREEN} />
          ) : (
            <View style={styles.grid}>
              {cells.map((d, i) => {
                if (!d) return <View key={`b${i}`} style={{ width: cellW, height: 54 }} />;
                const info = dayOf(d);
                const isToday = sameDay(d, today);
                const isSelected = sameDay(d, selected);
                return (
                  <Pressable
                    key={keyOf(d)}
                    onPress={() => setSelected(d)}
                    style={[styles.cell, { width: cellW }]}>
                    <View
                      style={[
                        styles.dayNum,
                        isSelected && { backgroundColor: GREEN },
                        !isSelected && isToday && { borderWidth: 1.5, borderColor: GREEN },
                      ]}>
                      <ThemedText
                        type="small"
                        style={{
                          fontWeight: isToday || isSelected ? '800' : '500',
                          color: isSelected ? '#fff' : theme.text,
                        }}>
                        {d.getDate()}
                      </ThemedText>
                    </View>
                    {/* Amber for a promise still owed, green for work done —
                        the two things a calendar must not blur together. */}
                    <View style={styles.dots}>
                      {info?.followUps ? <View style={[styles.dot, { backgroundColor: AMBER }]} /> : null}
                      {info?.onboarded ? <View style={[styles.dot, { backgroundColor: GREEN }]} /> : null}
                      {info?.visits ? <View style={[styles.dot, { backgroundColor: CLAY }]} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.legend}>
            {[
              { c: AMBER, t: 'Follow-up due' },
              { c: GREEN, t: 'Onboarded' },
              { c: CLAY, t: 'Visited' },
            ].map((l) => (
              <View key={l.t} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: l.c }]} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                  {l.t}
                </ThemedText>
              </View>
            ))}
          </View>

          <ThemedText type="smallBold" style={{ marginTop: Spacing.four }}>
            {selected.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </ThemedText>

          {/* What is owed on this day, and who to ring about it. */}
          <View style={{ marginTop: Spacing.two }}>
            <View style={styles.sectionHead}>
              <Ionicons name="alarm-outline" size={15} color={AMBER} />
              <ThemedText type="small" style={{ color: AMBER, fontWeight: '700' }}>
                Follow-ups due ({dueToday.length})
              </ThemedText>
            </View>
            {dueToday.length ? (
              dueToday.map((f) => (
                <ThemedView key={f.id} type="card" style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small" style={{ fontWeight: '700' }} numberOfLines={1}>
                      {f.name || 'Farmer'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                      {[f.mobile || 'no number', f.place].filter(Boolean).join(' · ')}
                    </ThemedText>
                    {f.note ? (
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        numberOfLines={2}
                        style={styles.small}>
                        {f.note}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View style={{ gap: Spacing.two, alignItems: 'flex-end' }}>
                    {f.mobile ? (
                      <Pressable
                        onPress={() => callFarmer(user, { _id: f.id, name: f.name, mobile: f.mobile })}
                        hitSlop={8}
                        style={styles.callBtn}>
                        <Ionicons name="call" size={14} color="#fff" />
                      </Pressable>
                    ) : null}
                    {/* Straight to Mark Visit: a follow-up is work owed, and
                        the farmer's page is a detour on the way to closing it. */}
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/visit-farmer',
                          params: { farmerId: f.id, farmerName: f.name },
                        } as never)
                      }
                      hitSlop={8}>
                      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                    </Pressable>
                  </View>
                </ThemedView>
              ))
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                Nothing owed on this day.
              </ThemedText>
            )}
          </View>

          {/* What already happened. The detail is the same sheet the Daily
              Report uses, so there is one place that renders a day. */}
          <View style={{ marginTop: Spacing.four }}>
            <View style={styles.sectionHead}>
              <Ionicons name="checkmark-done-outline" size={15} color={GREEN} />
              <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                Recorded that day
              </ThemedText>
            </View>
            {hasRecords ? (
              <Pressable
                onPress={() => setSheetOpen(true)}
                style={({ pressed }) => [styles.viewBtn, pressed && { opacity: 0.85 }]}>
                <Ionicons name="list-outline" size={18} color={GREEN} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                    View that day in full
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                    {[
                      selectedInfo?.onboarded ? `${selectedInfo.onboarded} onboarded` : '',
                      selectedInfo?.visits ? `${selectedInfo.visits} visits` : '',
                      selectedInfo?.sales ? `${selectedInfo.sales} sales` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={GREEN} />
              </Pressable>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                Nothing was recorded on this day.
              </ThemedText>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      <DayWorkSheet
        visible={sheetOpen}
        userId={user?._id}
        date={selected.toISOString()}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  arrow: { padding: Spacing.two },
  weekRow: { flexDirection: 'row' },
  weekday: { textAlign: 'center', fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { height: 54, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 4 },
  dayNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 3, marginTop: 3, height: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    marginTop: Spacing.two,
    justifyContent: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  callBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { fontSize: 11, marginTop: 1 },
  empty: { fontSize: 12, paddingBottom: Spacing.two },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: GREEN,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
});
