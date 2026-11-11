import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useContentWidth } from '@/hooks/use-content-width';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, AttendanceDay, isAgronomist, MIN_ATTENDANCE_HOURS } from '@/lib/api';

const ORANGE = Brand.primary; // today
const GREEN = Brand.secondary; // present
const RED = Brand.danger; // absent

const STATUS_COLOR: Record<AttendanceDay['status'], string> = {
  today: ORANGE,
  present: GREEN,
  absent: RED,
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday-first month cells; nulls pad the first and last rows. */
function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—';
const fmtMins = (m?: number | null) =>
  m == null || m < 0 ? '—' : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;

/** Worked minutes for a day; today with no END yet counts up to now. */
function minutesOf(day: AttendanceDay) {
  if (day.workedMinutes != null) return day.workedMinutes;
  if (!day.startAt) return null;
  const end = day.endAt ? new Date(day.endAt).getTime() : day.status === 'today' ? Date.now() : null;
  return end == null ? null : Math.floor((end - new Date(day.startAt).getTime()) / 60000);
}

/**
 * The attendance calendar - read only.
 *
 * Attendance is marked by My Day START / END (time + location); the server
 * decides each day: Present (9+ hours, or a no-field day), Absent (nothing,
 * under 9 hours, or no END). Today has no verdict until it is over.
 */
export default function AttendanceScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const width = useContentWidth();
  const screenBg = scheme === 'dark' ? theme.background : Brand.surface;

  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [days, setDays] = useState<Record<string, AttendanceDay>>({});
  const [loading, setLoading] = useState(true);

  const cells = useMemo(() => monthCells(month), [month]);
  const cellW = (width - Spacing.four * 2) / 7;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Midday on the first and last: the server keys days in IST, and midday
      // can never slip into a neighbouring date.
      const from = new Date(month.getFullYear(), month.getMonth(), 1, 12);
      const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
      const res = await api.listAttendance(user._id, from, to);
      setDays(res.days);
    } catch {
      setDays({});
    } finally {
      setLoading(false);
    }
  }, [user, month]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // The tapped day, shown in the popup.
  const [selected, setSelected] = useState<Date | null>(null);
  const selInfo = selected ? days[keyOf(selected)] : undefined;

  // Month totals.
  const summary = useMemo(() => {
    const v = Object.values(days);
    return {
      present: v.filter((x) => x.status === 'present').length,
      absent: v.filter((x) => x.status === 'absent').length,
    };
  }, [days]);

  const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const stepMonth =(by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  if (user && !isAgronomist(user.role)) {
    return (
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <ScreenHeader onBack={() => router.back()} title="Attendance" />
          <ThemedText themeColor="textSecondary" style={{ padding: Spacing.four }}>
            Attendance is only available for agronomists.
          </ThemedText>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader
          onBack={() => router.back()}
          title="Attendance"
          right={
            <Pressable
              onPress={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
              hitSlop={10}>
              <ThemedText type="small" style={{ color: ORANGE, fontWeight: '700' }}>
                Today
              </ThemedText>
            </Pressable>
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

          {loading && !Object.keys(days).length ? (
            <ActivityIndicator style={{ marginTop: Spacing.five }} color={ORANGE} />
          ) : (
            <View style={styles.grid}>
              {cells.map((d, i) => {
                if (!d) return <View key={`b${i}`} style={{ width: cellW, height: 50 }} />;
                const info = days[keyOf(d)];
                const color = info ? STATUS_COLOR[info.status] : null;
                const isFuture = keyOf(d) > keyOf(today);
                return (
                  <Pressable
                    key={keyOf(d)}
                    disabled={isFuture}
                    onPress={() => setSelected(d)}
                    style={[styles.cell, { width: cellW }, isFuture && { opacity: 0.35 }]}>
                    {/* The day's number sits in its status colour, so the
                        month reads at a glance. */}
                    <View style={[styles.dayNum, color ? { backgroundColor: color } : null]}>
                      <ThemedText
                        type="small"
                        style={{ fontWeight: color ? '800' : '500', color: color ? '#fff' : theme.text }}>
                        {d.getDate()}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Legend */}
          <View style={styles.legend}>
            {[
              { c: ORANGE, t: 'Today' },
              { c: GREEN, t: 'Present' },
              { c: RED, t: 'Absent' },
            ].map((l) => (
              <View key={l.t} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: l.c }]} />
                <ThemedText type="small" style={{ fontSize: 13, fontWeight: '700' }}>
                  {l.t}
                </ThemedText>
              </View>
            ))}
          </View>

          <ThemedView type="card" style={styles.summary}>
            {[
              { v: `${summary.present}/${monthDays}`, l: 'Present', c: GREEN },
              { v: `${summary.absent}/${monthDays}`, l: 'Absent', c: RED },
            ].map((x) => (
              <View key={x.l} style={{ flex: 1, alignItems: 'center' }}>
                <ThemedText type="smallBold" style={{ fontSize: 22, lineHeight: 28, color: x.c }}>
                  {x.v}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                  {x.l} this month
                </ThemedText>
              </View>
            ))}
          </ThemedView>

          {/* How a day gets its colour, and where it is marked. */}
          <Pressable onPress={() => router.push('/tracking' as never)} style={styles.howTo}>
            <Ionicons name="navigate" size={18} color={ORANGE} />
            <View style={{ flex: 1 }}>
              <ThemedText type="small" style={{ fontWeight: '800' }}>
                Marked from My Day START / END
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12, lineHeight: 17 }}>
                {MIN_ATTENDANCE_HOURS}+ hours between START and END is Present. Less, no END, or no START
                is Absent – shown from the next day.
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          {selected ? (
            <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={() => {}}>
              <View style={styles.sheetHead}>
                <ThemedText type="smallBold" style={{ fontSize: 16, flex: 1 }}>
                  {selected.toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </ThemedText>
                <Pressable onPress={() => setSelected(null)} hitSlop={12}>
                  <Ionicons name="close" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>

              {(() => {
                const status =
                  selInfo?.status ?? (keyOf(selected) === keyOf(today) ? 'today' : 'absent');
                const color = STATUS_COLOR[status];
                const word = status === 'today' ? 'Today' : status === 'present' ? 'Present' : 'Absent';
                return (
                  <View style={[styles.badge, { backgroundColor: color }]}>
                    <ThemedText type="small" style={{ color: '#fff', fontWeight: '800' }}>
                      {word}
                    </ThemedText>
                  </View>
                );
              })()}

              {selInfo?.kind === 'no_field' ? (
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
                  No-field day{selInfo.reason ? `: ${selInfo.reason}` : ''}
                </ThemedText>
              ) : selInfo && (selInfo.status !== 'absent' || selInfo.startAt) ? (
                <View style={{ marginTop: Spacing.three, gap: Spacing.two }}>
                  {[
                    { l: 'Start time', v: fmtTime(selInfo.startAt) },
                    {
                      l: 'End time',
                      v: selInfo.endAt
                        ? fmtTime(selInfo.endAt)
                        : selInfo.status === 'today' && selInfo.startAt
                          ? 'In progress'
                          : '—',
                    },
                    {
                      l: selInfo.status === 'today' && !selInfo.endAt ? 'Duration so far' : 'Total duration',
                      v: fmtMins(minutesOf(selInfo)),
                    },
                  ].map((r) => (
                    <View key={r.l} style={styles.row}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {r.l}
                      </ThemedText>
                      <ThemedText type="smallBold">{r.v}</ThemedText>
                    </View>
                  ))}
                  {selInfo.status === 'absent' ? (
                    <ThemedText type="small" style={{ color: RED, fontSize: 12 }}>
                      {selInfo.why === 'no_end'
                        ? 'END was never pressed'
                        : `Under ${MIN_ATTENDANCE_HOURS} hours`}
                    </ThemedText>
                  ) : null}
                  {selInfo.status === 'today' && !selInfo.startAt ? (
                    <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                      Not started yet. Press START on My Day.
                    </ThemedText>
                  ) : null}
                </View>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
                  {keyOf(selected) === keyOf(today)
                    ? 'Not started yet. Press START on My Day.'
                    : 'No START recorded for this day.'}
                </ThemedText>
              )}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
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
  cell: { height: 50, alignItems: 'center', justifyContent: 'center' },
  dayNum: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
    marginTop: Spacing.three,
    justifyContent: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 7 },
  summary: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginTop: Spacing.four,
  },
  howTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: Brand.primarySurface,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  sheet: { borderRadius: Spacing.three, padding: Spacing.four, maxWidth: 420, width: '100%', alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
