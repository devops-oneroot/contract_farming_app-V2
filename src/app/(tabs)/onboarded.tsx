import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Linking } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, CardShadow, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Aggregator, api, DateRange, Farmer } from '@/lib/api';
import { callFarmer } from '@/lib/call';

const GREEN = Brand.primary;
const CLAY = Brand.secondary; // aggregators — the buyer/market side
const GREEN_SURFACE = Brand.surface;

type TabKey = 'farmers' | 'aggregators';

// Wait this long after the last keystroke before asking the server, so typing a
// name doesn't fire a request per character.
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The window the list is narrowed to, sent to the server as `?from=&to=`.
 *
 * The bounds are built here from LOCAL midnight to local 23:59:59.999, so
 * "registered on the 12th" means the 12th where the agronomist is standing —
 * the server applies the instants exactly as sent rather than reinterpreting
 * them in its own timezone.
 */
type DateFilter = { label: string } & DateRange;

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const daysAgo = (n: number) => {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
};

/** The one-tap ranges. "Pick a date" is handled separately by the calendar. */
const PRESETS: { key: string; label: string; build: () => DateFilter }[] = [
  {
    key: 'today',
    label: 'Today',
    build: () => ({ label: 'Today', from: startOfDay(new Date()), to: endOfDay(new Date()) }),
  },
  {
    key: 'yesterday',
    label: 'Yesterday',
    build: () => ({ label: 'Yesterday', from: startOfDay(daysAgo(1)), to: endOfDay(daysAgo(1)) }),
  },
  {
    key: 'week',
    label: 'Last 7 days',
    build: () => ({ label: 'Last 7 days', from: startOfDay(daysAgo(6)), to: endOfDay(new Date()) }),
  },
  {
    key: 'month',
    label: 'Last 30 days',
    build: () => ({ label: 'Last 30 days', from: startOfDay(daysAgo(29)), to: endOfDay(new Date()) }),
  },
];

/** "12 Jul 2026" — short enough to sit beside the number on one line. */
function fmtDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function OnboardedScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [tab, setTab] = useState<TabKey>('farmers');
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [aggregators, setAggregators] = useState<Aggregator[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  // Narrow the list to when people were registered. Null = show everything.
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Debounce the box; `search` is what actually gets sent to the server.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Responses can land out of order once typing outruns the network, so only the
  // newest request is allowed to write to state.
  const reqId = useRef(0);

  const load = useCallback(
    async (q: string, range: DateFilter | null) => {
      if (!user) return;
      const id = ++reqId.current;
      // Both the search text and the date window are applied by the server, so
      // what arrives is already exactly what the list should show.
      const window = range ? { from: range.from, to: range.to } : undefined;
      try {
        const [f, a] = await Promise.all([
          api.listAgronomistFarmers(user._id, q, window).catch(() => []),
          api.listAggregators(user._id, q, window).catch(() => []),
        ]);
        if (id !== reqId.current) return; // a newer request already superseded this one
        setFarmers(f);
        setAggregators(a);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [user]
  );

  // Runs on focus, and again whenever the debounced search or the date filter
  // changes while focused.
  useFocusEffect(
    useCallback(() => {
      load(search, dateFilter);
    }, [load, search, dateFilter])
  );

  const call = (mobile: string) => Linking.openURL(`tel:${mobile}`).catch(() => {});

  // Everything arriving from the server already matches the search and the
  // date window, so there is nothing left to narrow here.
  const list = tab === 'farmers' ? farmers : aggregators;
  const searching = search.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <ThemedText style={styles.headerTitle}>Onboarded</ThemedText>
          {/* Farmers removed from this list are not gone — they wait here. */}
          <Pressable
            onPress={() => router.push('/farmer-trash' as never)}
            hitSlop={10}
            style={({ pressed }) => [styles.trashLink, pressed && { opacity: 0.7 }]}>
            <Ionicons name="trash-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '700' }}>
              Trash
            </ThemedText>
          </Pressable>
        </View>

        {/* Search by name or number, and narrow by registration date */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={theme.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name or number"
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={[styles.searchInput, { color: theme.text }]}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => setFilterOpen(true)}
            style={({ pressed }) => [
              styles.filterBtn,
              dateFilter ? { backgroundColor: GREEN, borderColor: GREEN } : null,
              pressed && { opacity: 0.85 },
            ]}>
            <Ionicons
              name="calendar-outline"
              size={18}
              color={dateFilter ? '#fff' : theme.textSecondary}
            />
          </Pressable>
        </View>

        {/* An active filter has to be visible, or an empty list looks like lost
            data rather than a filter doing its job. */}
        {dateFilter ? (
          <View style={styles.activeFilter}>
            <Ionicons name="funnel" size={12} color={GREEN} />
            <ThemedText type="small" style={styles.activeFilterText}>
              {dateFilter.label}
            </ThemedText>
            <Pressable onPress={() => setDateFilter(null)} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={GREEN} />
            </Pressable>
          </View>
        ) : null}

        {/* Segmented control — counts follow the search so the number always matches the list. */}
        <View style={styles.segment}>
          {(['farmers', 'aggregators'] as TabKey[]).map((k) => {
            const on = tab === k;
            const count = k === 'farmers' ? farmers.length : aggregators.length;
            // Farmers are green (crops), aggregators terracotta (the buyer side).
            const tint = k === 'farmers' ? GREEN : CLAY;
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                style={[styles.segBtn, on && { backgroundColor: tint }]}>
                <ThemedText type="smallBold" style={{ color: on ? '#fff' : theme.textSecondary, textTransform: 'capitalize' }}>
                  {k} ({count})
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(search, dateFilter)} />}>
          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : list.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.empty}>
              <Ionicons name="people-outline" size={40} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {searching
                  ? `No ${tab} match “${search}”.`
                  : dateFilter
                    ? `No ${tab} registered in ${dateFilter.label.toLowerCase()}.`
                    : `No ${tab} onboarded yet.`}
              </ThemedText>
            </ThemedView>
          ) : tab === 'farmers' ? (
            farmers.map((f) => (
              // Opens the farmer detail screen: farm boundary, edit info, and their crops.
              <Pressable
                key={f._id}
                onPress={() => router.push({ pathname: '/farmer', params: { farmerId: f._id, name: f.name } })}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
                {/* Hard right of the card, above the call button, so the dates
                    line up in a column down the whole list. */}
                {fmtDate(f.createdAt) ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.dateText}>
                    {fmtDate(f.createdAt)}
                  </ThemedText>
                ) : null}
                <View style={styles.cardBody}>
                  <View style={styles.avatar}>
                    <ThemedText style={styles.avatarText}>
                      {f.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {f.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {f.mobile}
                    </ThemedText>
                    {/* Did this agronomist register them, or were they handed
                        over? The date above is the farmer's record date, so it
                        only means "onboarded on" when this agronomist created
                        it; for a handed-over farmer it is when they first
                        registered. */}
                    {(() => {
                      const mine = !!f.onboardedBy && f.onboardedBy === user?._id;
                      return (
                        <View
                          style={[
                            styles.originChip,
                            { borderColor: mine ? GREEN : Brand.secondary },
                          ]}>
                          <Ionicons
                            name={mine ? 'person-add-outline' : 'swap-horizontal-outline'}
                            size={11}
                            color={mine ? GREEN : Brand.secondary}
                          />
                          <ThemedText
                            type="small"
                            style={{
                              color: mine ? GREEN : Brand.secondary,
                              fontWeight: '700',
                              fontSize: 11,
                            }}>
                            {mine ? 'Onboarded by you' : 'Assigned to you'}
                          </ThemedText>
                        </View>
                      );
                    })()}
                  </View>
                  <Pressable
                    onPress={() => callFarmer(user, { _id: f._id, name: f.name, mobile: f.mobile })}
                    hitSlop={8}
                    style={styles.callBtn}>
                    <Ionicons name="call" size={16} color="#fff" />
                  </Pressable>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                </View>
              </Pressable>
            ))
          ) : (
            aggregators.map((a) => (
              <View key={a._id} style={[styles.card, styles.cardBody]}>
                <View style={styles.aggIcon}>
                  <Ionicons name="business" size={20} color={CLAY} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {a.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {[a.company, a.mobile].filter(Boolean).join(' · ')}
                  </ThemedText>
                </View>
                {a.mobile ? (
                  <Pressable onPress={() => call(a.mobile)} hitSlop={8} style={styles.callBtn}>
                    <Ionicons name="call" size={16} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Filter by when someone was registered. */}
      <Modal
        visible={filterOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFilterOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <ThemedText type="smallBold" style={{ fontSize: 16 }}>
              Filter by date
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
              Show only people registered in this period.
            </ThemedText>

            <View style={styles.presetWrap}>
              {PRESETS.map((preset) => {
                const on = dateFilter?.label === preset.label;
                return (
                  <Pressable
                    key={preset.key}
                    onPress={() => {
                      setDateFilter(preset.build());
                      setFilterOpen(false);
                    }}
                    style={[
                      styles.preset,
                      {
                        backgroundColor: on ? GREEN : theme.backgroundElement,
                        borderColor: on ? GREEN : 'transparent',
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                      {preset.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [
                styles.pickDate,
                { backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.85 },
              ]}>
              <Ionicons name="calendar" size={18} color={GREEN} />
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Pick an exact day</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                  See everyone registered on one date
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>

            {pickerOpen ? (
              <DateTimePicker
                value={dateFilter ? dateFilter.from : new Date()}
                mode="date"
                maximumDate={new Date()}
                onChange={(event, selected) => {
                  if (Platform.OS !== 'ios') setPickerOpen(false);
                  if (event.type === 'set' && selected) {
                    setDateFilter({
                      label: fmtDate(selected.toISOString()),
                      from: startOfDay(selected),
                      to: endOfDay(selected),
                    });
                    if (Platform.OS !== 'ios') setFilterOpen(false);
                  }
                }}
              />
            ) : null}
            {Platform.OS === 'ios' && pickerOpen ? (
              <Pressable
                onPress={() => {
                  setPickerOpen(false);
                  setFilterOpen(false);
                }}
                style={styles.doneBtn}>
                <ThemedText type="linkPrimary">Done</ThemedText>
              </Pressable>
            ) : null}

            {dateFilter ? (
              <Pressable
                onPress={() => {
                  setDateFilter(null);
                  setFilterOpen(false);
                }}
                style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.85 }]}>
                <ThemedText type="smallBold" style={{ color: Brand.danger }}>
                  Clear filter
                </ThemedText>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  trashLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateText: { fontSize: 11, fontWeight: '600', alignSelf: 'flex-end' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
    ...CardShadow,
  },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'transparent',
    ...CardShadow,
  },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Brand.primarySurface,
  },
  activeFilterText: { color: GREEN, fontWeight: '700', fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  preset: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  pickDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.three,
  },
  doneBtn: { alignSelf: 'flex-end', padding: Spacing.two },
  clearBtn: { alignItems: 'center', paddingVertical: Spacing.three, marginTop: Spacing.two },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  searchInput: { flex: 1, paddingVertical: Spacing.three, fontSize: 15 },
  segment: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.04)',
    padding: 4,
    borderRadius: Spacing.five,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.five },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two },
  empty: {
    marginTop: Spacing.four,
    padding: Spacing.five,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: Spacing.three,
  },
  card: {
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Radius.lg,
    ...CardShadow,
  },
  // The avatar / details / call row. Sits under the date, which is pinned to
  // the card's right edge.
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  // Outline chip — states the farmer's origin without competing with their name.
  originChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Spacing.four,
    borderWidth: 1,
  },
  aggIcon: {
    width: 44,
    height: 44,
    borderRadius: Spacing.three,
    backgroundColor: Brand.secondarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
