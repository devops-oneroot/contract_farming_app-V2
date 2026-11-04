import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { DayWorkSheet } from '@/components/day-work-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { api, isSenior, TeamDay, TeamMember, TeamStatus } from '@/lib/api';

const GREEN = Brand.primary;
const AMBER = Brand.accent;

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const fmtDay = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';

const isToday = (d: Date) => d.toDateString() === new Date().toDateString();

/**
 * How each state reads and colours.
 *
 * Colour carries the meaning at a glance, but never alone: every state is also
 * spelled out, because a senior scanning fifteen rows in sunlight should not
 * have to tell amber from green to know who is out.
 */
const STATUS: Record<
  TeamStatus,
  { label: string; color: string; surface: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  working: { label: 'Out now', color: GREEN, surface: Brand.primarySurface, icon: 'walk' },
  paused: { label: 'On a break', color: AMBER, surface: Brand.accentSurface, icon: 'pause-circle' },
  ended: {
    label: 'Day ended',
    color: '#6b7280',
    surface: 'rgba(127,127,127,0.12)',
    icon: 'checkmark-circle',
  },
  no_field: {
    label: 'No field work',
    color: Brand.secondary,
    surface: Brand.secondarySurface,
    icon: 'home',
  },
  not_started: {
    label: 'Not started',
    color: '#9ca3af',
    surface: 'rgba(127,127,127,0.10)',
    icon: 'ellipse-outline',
  },
};

/**
 * What the whole team did on one day — senior agronomists only.
 *
 * A senior is accountable for work they cannot watch being done, and until now
 * the only way to know how a day had gone was to ring each agent in turn.
 * Everything here was already being recorded by the app; this screen only puts
 * one day's worth of it side by side.
 *
 * Read-only by design. It answers "what is happening" and hands off to the
 * agent's own day report for "what exactly" — it deliberately does not become a
 * second place where a visit or a farmer can be edited.
 */
export default function TeamScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();

  const [date, setDate] = useState(new Date());
  const [picker, setPicker] = useState(false);
  const [data, setData] = useState<TeamDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Whose full day is open, if any. */
  const [openFor, setOpenFor] = useState<TeamMember | null>(null);

  const senior = isSenior(user?.role);

  const load = useCallback(async () => {
    if (!user || !senior) return;
    setError(null);
    try {
      // Local midnight as an instant: `toISOString()` on the date alone would
      // shift the day backwards for every timezone ahead of UTC, IST included.
      const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      setData(await api.getTeamDay(user._id, local.toISOString()));
    } catch (e: any) {
      setError(e?.message || 'Could not load the team.');
    } finally {
      setLoading(false);
    }
  }, [user, senior, date]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /**
   * Not a senior: say so rather than showing an empty screen. The server would
   * refuse regardless — this is only about what the refusal looks like.
   */
  if (!senior) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <TopBar title="Team" onBack={() => router.back()} theme={theme} />
          <View style={styles.locked}>
            <Ionicons name="lock-closed-outline" size={40} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
              Only senior agronomists can see the team&apos;s work.
            </ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const t = data?.totals;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title="Team" onBack={() => router.back()} theme={theme} />

        {/* Which day. Stepping back a day is one tap, because "how did
            yesterday go" is the question asked straight after "how is today
            going". */}
        <View style={styles.dayRow}>
          <Pressable
            onPress={() => setDate((d) => new Date(d.getTime() - 86400000))}
            hitSlop={10}
            style={styles.dayArrow}>
            <Ionicons name="chevron-back" size={18} color={theme.text} />
          </Pressable>
          <Pressable onPress={() => setPicker(true)} style={styles.dayPick}>
            <Ionicons name="calendar-outline" size={16} color={GREEN} />
            <ThemedText type="smallBold">{isToday(date) ? 'Today' : fmtDay(date)}</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setDate((d) => new Date(Math.min(d.getTime() + 86400000, Date.now())))}
            hitSlop={10}
            disabled={isToday(date)}
            style={[styles.dayArrow, isToday(date) && { opacity: 0.3 }]}>
            <Ionicons name="chevron-forward" size={18} color={theme.text} />
          </Pressable>
        </View>

        {picker && (
          <DateTimePicker
            value={date}
            mode="date"
            maximumDate={new Date()}
            onChange={(e, sel) => {
              if (Platform.OS !== 'ios') setPicker(false);
              if (e.type === 'set' && sel) setDate(sel);
            }}
          />
        )}
        {Platform.OS === 'ios' && picker && (
          <Pressable onPress={() => setPicker(false)} style={styles.doneBtn}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
            {error ? (
              <ThemedView type="card" style={styles.empty}>
                <ThemedText type="small" themeColor="textSecondary">
                  {error}
                </ThemedText>
              </ThemedView>
            ) : null}

            {/* The day in one block, before any of the per-person detail. */}
            {t ? (
              <ThemedView type="card" style={styles.summary}>
                <View style={styles.sumRow}>
                  <Sum label="Out now" value={`${t.active}/${t.people}`} tint={GREEN} />
                  <Sum label="Onboarded" value={String(t.onboarded)} />
                  <Sum label="Visits" value={String(t.visits)} />
                </View>
                <View style={styles.sumRow}>
                  <Sum label="Sales" value={money(t.salesValue)} />
                  <Sum label="Distance" value={`${t.distanceKm} km`} />
                  <Sum label="Reports" value={`${t.reportsFiled}/${t.people}`} />
                </View>
                {t.areas.length ? (
                  <View style={styles.areaRow}>
                    <Ionicons name="map" size={13} color={Brand.secondary} />
                    <ThemedText type="small" style={styles.areaText}>
                      {t.areas.join(' · ')}
                    </ThemedText>
                  </View>
                ) : null}
              </ThemedView>
            ) : null}

            {data?.team.map((m) => {
              const st = STATUS[m.status];
              const did = m.onboarded + m.visits + m.sales;
              return (
                <Pressable
                  key={m._id}
                  onPress={() => setOpenFor(m)}
                  style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
                  <View style={styles.cardTop}>
                    <View style={[styles.avatar, { backgroundColor: st.color }]}>
                      <ThemedText style={styles.avatarText}>
                        {m.name?.charAt(0)?.toUpperCase() ?? '?'}
                      </ThemedText>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.nameRow}>
                        <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                          {m.name}
                        </ThemedText>
                        {/* Seniors are marked, so a senior reading this can tell
                            which rows are peers and which are their team. */}
                        {isSenior(m.role) ? (
                          <View style={styles.seniorTag}>
                            <ThemedText type="small" style={styles.seniorTagText}>
                              Senior
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <View style={[styles.statusChip, { backgroundColor: st.surface }]}>
                        <Ionicons name={st.icon} size={11} color={st.color} />
                        <ThemedText
                          type="small"
                          style={{ color: st.color, fontWeight: '700', fontSize: 11 }}>
                          {st.label}
                          {m.status === 'working' && m.startedAt
                            ? ` · since ${fmtTime(m.startedAt)}`
                            : ''}
                          {m.status === 'ended' && m.endedAt ? ` · ${fmtTime(m.endedAt)}` : ''}
                        </ThemedText>
                      </View>
                    </View>
                    {m.mobile ? (
                      <Pressable
                        onPress={() => Linking.openURL(`tel:${m.mobile}`).catch(() => {})}
                        hitSlop={8}
                        style={styles.callBtn}>
                        <Ionicons name="call" size={15} color="#fff" />
                      </Pressable>
                    ) : null}
                  </View>

                  {/* Where the day actually happened. Directly under the name
                      because "which village is he in" is the second question a
                      senior asks, straight after "is he out at all". */}
                  {m.areas.length ? (
                    <View style={styles.areaRow}>
                      <Ionicons name="location" size={12} color={Brand.secondary} />
                      <ThemedText type="small" style={styles.areaText} numberOfLines={2}>
                        {m.areas.join(' · ')}
                      </ThemedText>
                      {/* Said, not implied: a GPS-derived place is where the
                          phone was, which is not the same claim as a farm
                          recorded at that address. */}
                      {m.areasFromGps ? (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.fromGps}>
                          from GPS
                        </ThemedText>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Why they stayed in, in their own words — the reason is the
                      whole point of a no-field day being a state at all. */}
                  {m.noFieldReason ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.reason}>
                      {m.noFieldReason}
                    </ThemedText>
                  ) : null}

                  <View style={styles.statRow}>
                    <Stat label="Onboarded" value={String(m.onboarded)} />
                    <Stat label="Visits" value={String(m.visits)} />
                    <Stat label="Sales" value={m.sales ? money(m.salesValue) : '—'} />
                    <Stat label="Distance" value={m.distanceKm ? `${m.distanceKm} km` : '—'} />
                  </View>

                  <View style={styles.footRow}>
                    <View style={styles.footItem}>
                      <Ionicons
                        name={m.reportFiled ? 'document-text' : 'document-outline'}
                        size={12}
                        color={m.reportFiled ? GREEN : theme.textSecondary}
                      />
                      <ThemedText
                        type="small"
                        style={{
                          fontSize: 11,
                          color: m.reportFiled ? GREEN : theme.textSecondary,
                        }}>
                        {m.reportFiled ? `Report ${fmtTime(m.reportAt)}` : 'No report yet'}
                      </ThemedText>
                    </View>
                    {m.lastSeen ? (
                      <View style={styles.footItem}>
                        <Ionicons name="location-outline" size={12} color={theme.textSecondary} />
                        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                          Last seen {fmtTime(m.lastSeen.at)}
                        </ThemedText>
                      </View>
                    ) : null}
                    {did > 0 ? (
                      <ThemedText type="small" style={styles.openHint}>
                        See the day ›
                      </ThemedText>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}

            {data && data.team.length === 0 ? (
              <ThemedView type="card" style={styles.empty}>
                <ThemedText type="small" themeColor="textSecondary">
                  No agronomists on the team yet.
                </ThemedText>
              </ThemedView>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* The same sheet an agent sees for their own day, pointed at a colleague
          — one definition of "the day", so the two can never disagree. */}
      <DayWorkSheet
        visible={!!openFor}
        userId={openFor?._id}
        date={new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString()}
        onClose={() => setOpenFor(null)}
      />
    </ThemedView>
  );
}

function TopBar({ title, onBack, theme }: { title: string; onBack: () => void; theme: any }) {
  return (
    <ScreenHeader
      onBack={onBack}
      title={title}
    />
  );
}

function Sum({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <ThemedText type="smallBold" style={tint ? { color: tint } : undefined}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
        {label}
      </ThemedText>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="smallBold" style={{ fontSize: 13 }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 10 }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  locked: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.five,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingBottom: Spacing.two,
  },
  dayArrow: { padding: Spacing.one },
  dayPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: 6,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: `${GREEN}44`,
    backgroundColor: Brand.primarySurface,
  },
  doneBtn: { alignItems: 'center', paddingVertical: Spacing.two },
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  summary: { padding: Spacing.three, borderRadius: Radius.lg, gap: Spacing.three },
  sumRow: { flexDirection: 'row', gap: Spacing.two },
  card: {
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Radius.lg,
    gap: Spacing.three,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  seniorTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Spacing.four,
    backgroundColor: Brand.secondarySurface,
  },
  seniorTagText: { color: Brand.secondary, fontWeight: '700', fontSize: 10 },
  statusChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Spacing.four,
  },
  callBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reason: { fontStyle: 'italic', marginTop: -Spacing.one },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -Spacing.one },
  areaText: { color: Brand.secondary, fontWeight: '700', fontSize: 12, flexShrink: 1 },
  fromGps: { fontSize: 10, fontStyle: 'italic' },
  statRow: { flexDirection: 'row', gap: Spacing.two },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(127,127,127,0.08)',
    gap: 1,
  },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  footItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  openHint: { marginLeft: 'auto', color: GREEN, fontWeight: '700', fontSize: 11 },
  empty: { padding: Spacing.five, borderRadius: Radius.lg, alignItems: 'center' },
});
