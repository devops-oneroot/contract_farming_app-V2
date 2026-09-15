import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Linking } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import { FilterPicker } from '@/components/filter-picker';
import { Aggregator, api, DateRange, Farmer, onboarderId, onboarderName } from '@/lib/api';
import { limitSearch } from '@/lib/mobile';
import { callFarmer } from '@/lib/call';

const GREEN = Brand.primary;
const CLAY = Brand.secondary; // aggregators — the buyer/market side
const GREEN_SURFACE = Brand.surface;

type TabKey = 'farmers' | 'aggregators';

// Wait this long after the last keystroke before asking the server, so typing a
// name doesn't fire a request per character.
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Append a page, dropping anyone already held.
 *
 * The list is newest-first, so a farmer registered between two requests pushes
 * everyone down a place and the row on the boundary arrives twice. Without this
 * they would render twice under the same key.
 */
function merge<T extends { _id: string }>(prev: T[], next: T[]) {
  const seen = new Set(prev.map((r) => r._id));
  return [...prev, ...next.filter((r) => !seen.has(r._id))];
}

/**
 * Rows fetched per request. Small on purpose: this list opens on a phone over
 * a village mobile connection, and the first screenful arriving quickly matters
 * more than having the whole roster in hand.
 */
const PAGE_SIZE = 10;

/** How close to the bottom starts the next page — about one card's warning. */
const LOAD_MORE_SLACK = 320;

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

/**
 * When a record was created, as one short line: "17 Aug - 6:34 pm".
 *
 * The time is here because a day alone cannot separate two farmers registered
 * on the same round, and an agent retracing a morning needs to know which came
 * first. Kept to a single line so it can sit beside the name instead of
 * claiming a row of its own above the card.
 *
 * The year is dropped for the current one. It is the same on nearly every row,
 * and spelling it out is what stopped the date fitting next to the name.
 */
function fmtStamp(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export default function OnboardedScreen() {
  const params = useLocalSearchParams<{ scope?: string; t?: string }>();
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [tab, setTab] = useState<TabKey>('farmers');
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [aggregators, setAggregators] = useState<Aggregator[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * How far down each list has been read, and whether the server has more.
   *
   * Kept per tab: switching to aggregators and back must not throw away the
   * farmers already scrolled through, and each side runs out at its own point.
   * `total` is the server's count of everything matching the filters, which is
   * what the tab badges show — `items.length` would only ever say 10.
   */
  const [farmerPage, setFarmerPage] = useState({ page: 1, hasMore: false, total: 0 });
  const [aggPage, setAggPage] = useState({ page: 1, hasMore: false, total: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  // Narrow the list to when people were registered. Null = show everything.
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  /**
   * Which date the calendar is being opened for: one exact day, or either
   * end of a range. One picker, three jobs — a second DateTimePicker on the
   * sheet would fight the first for the screen on Android.
   */
  const [pickerFor, setPickerFor] = useState<'day' | 'from' | 'to' | null>(null);
  /**
   * The two ends of a custom range while they are being chosen. Applied only
   * when both are set and the agent taps Apply, so half a range never narrows
   * the list.
   */
  const [rangeFrom, setRangeFrom] = useState<Date | null>(null);
  const [rangeTo, setRangeTo] = useState<Date | null>(null);
  /**
   * Whose farmers to show, by the agronomist who registered them. Null is
   * everyone's.
   *
   * Replaces an "only mine" boolean that could be switched off but never on —
   * the home screen's "Onboarded" tile was the only thing that ever set it.
   * That tile now sets this to the current agent, which asks the same question
   * and lets any other agent be chosen too.
   */
  const [onboardedBy, setOnboardedBy] = useState<string | null>(null);
  const [whoOpen, setWhoOpen] = useState(false);
  /** The agronomists to choose between, with how many each registered. */
  const [staff, setStaff] = useState<{ _id: string; name: string; onboardedCount?: number }[]>([]);

  /**
   * The agronomists to choose between. Loaded once and kept: the counts come
   * from the server's own onboarded tally, so the picker and the list can
   * never disagree about how many someone registered.
   */
  useEffect(() => {
    api
      .listAgronomistsWithCounts()
      .then(setStaff)
      .catch(() => setStaff([]));
  }, []);

  // Debounce the box; `search` is what actually gets sent to the server.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Responses can land out of order once typing outruns the network, so only the
  // newest request is allowed to write to state.
  const reqId = useRef(0);

  const load = useCallback(
    async (q: string, range: DateFilter | null, by: string | null) => {
      if (!user) return;
      const id = ++reqId.current;
      // Every reload — a new filter, a new search, a pull to refresh — clears
      // the list to a spinner. This used to leave the OLD rows on screen for
      // the second or two the request took, so applying a date range looked
      // like it had done nothing, and then the numbers changed by themselves.
      setLoading(true);
      // Search, date window and scope are all applied by the server, so what
      // arrives is already exactly what the list should show.
      const window = range ? { from: range.from, to: range.to } : undefined;
      const empty = { items: [], total: 0, hasMore: false };
      try {
        const [f, a] = await Promise.all([
          /**
           * Every farmer, not only this agent's.
           *
           * The tab is a directory: an agent standing in a village needs to
           * find whoever is in front of them, and scoping it to their own
           * roster meant a farmer a colleague registered simply could not be
           * looked up. "Onboarded by you" narrows it back when that is the
           * question being asked.
           */
          api
            .listAllFarmersPage({
              search: q,
              range: window,
              onboardedBy: by ?? undefined,
              page: 1,
              limit: PAGE_SIZE,
            })
            .catch(() => empty),
          // Everyone's, for the same reason: an aggregator is a buyer the team
          // deals with, not one agent's private contact.
          api
            .listAggregatorsPage({ search: q, range: window, page: 1, limit: PAGE_SIZE })
            .catch(() => empty),
        ]);
        if (id !== reqId.current) return; // a newer request already superseded this one
        setFarmers(f.items as Farmer[]);
        setAggregators(a.items as Aggregator[]);
        // Back to page 1 for both: the filters just changed, so how far the
        // old list had been read says nothing about this one.
        setFarmerPage({ page: 1, hasMore: f.hasMore, total: f.total });
        setAggPage({ page: 1, hasMore: a.hasMore, total: a.total });
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [user]
  );

  /**
   * Fetch the next page of whichever tab is showing.
   *
   * Only the visible tab grows. Loading the other one in the background would
   * spend a field agent's data on a list they are not looking at, and the two
   * run out at different points anyway.
   */
  const loadMore = useCallback(async () => {
    const meta = tab === 'farmers' ? farmerPage : aggPage;
    if (loading || loadingMore || !meta.hasMore) return;

    // Tied to the same counter the first load uses: if a search or filter lands
    // while this page is in flight, its rows belong to a list that no longer
    // exists and must not be appended to the new one.
    const id = reqId.current;
    const next = meta.page + 1;
    const window = dateFilter ? { from: dateFilter.from, to: dateFilter.to } : undefined;
    setLoadingMore(true);
    try {
      if (tab === 'farmers') {
        const r = await api.listAllFarmersPage({
          search,
          range: window,
          onboardedBy: onboardedBy ?? undefined,
          page: next,
          limit: PAGE_SIZE,
        });
        if (id !== reqId.current) return;
        setFarmers((prev) => merge(prev, r.items as Farmer[]));
        setFarmerPage({ page: next, hasMore: r.hasMore, total: r.total });
      } else {
        const r = await api.listAggregatorsPage({
          search,
          range: window,
          page: next,
          limit: PAGE_SIZE,
        });
        if (id !== reqId.current) return;
        setAggregators((prev) => merge(prev, r.items as Aggregator[]));
        setAggPage({ page: next, hasMore: r.hasMore, total: r.total });
      }
    } catch {
      // Leave the list as it is; the footer's tap target is still there to retry.
    } finally {
      if (id === reqId.current) setLoadingMore(false);
    }
  }, [tab, farmerPage, aggPage, loading, loadingMore, search, dateFilter, onboardedBy]);

  // Runs on focus, and again whenever the debounced search or the date filter
  // changes while focused.
  useFocusEffect(
    useCallback(() => {
      load(search, dateFilter, onboardedBy);
    }, [load, search, dateFilter, onboardedBy])
  );

  /**
   * Arriving from the home screen's "Onboarded" tile: preset today's window.
   * The tile counts farmers who joined this agent's list today, which is what
   * this list shows anyway, so narrowing by date is all that is needed for the
   * rows to match the number that was tapped.
   */
  useEffect(() => {
    if (params.scope !== 'onboardedToday') return;
    setTab('farmers');
    setOnboardedBy(user?._id ?? null);
    setDateFilter({
      label: 'Today',
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    });
  }, [params.scope, params.t]);

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
              onChangeText={(v) => setQuery(limitSearch(v))}
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
          {/* Whose farmers. Now that the tab lists everyone's, "who registered
              this one" is the question the list most needs narrowing by. */}
          <Pressable
            onPress={() => setWhoOpen(true)}
            style={({ pressed }) => [
              styles.filterBtn,
              onboardedBy ? { backgroundColor: GREEN, borderColor: GREEN } : null,
              pressed && { opacity: 0.85 },
            ]}>
            <Ionicons
              name="people-outline"
              size={18}
              color={onboardedBy ? '#fff' : theme.textSecondary}
            />
          </Pressable>
        </View>

        {/* An active filter has to be visible, or an empty list looks like lost
            data rather than a filter doing its job. */}
        {dateFilter || onboardedBy ? (
          <View style={styles.filterChips}>
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
            {onboardedBy ? (
              <View style={styles.activeFilter}>
                <Ionicons name="person-add" size={12} color={GREEN} />
                <ThemedText type="small" style={styles.activeFilterText}>
                  {onboardedBy === user?._id
                    ? 'Onboarded by you'
                    : `By ${staff.find((a) => a._id === onboardedBy)?.name ?? 'agent'}`}
                </ThemedText>
                <Pressable onPress={() => setOnboardedBy(null)} hitSlop={10}>
                  <Ionicons name="close-circle" size={16} color={GREEN} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Segmented control — counts follow the search so the number always matches the list. */}
        <View style={styles.segment}>
          {(['farmers', 'aggregators'] as TabKey[]).map((k) => {
            const on = tab === k;
            // The server's count of everything matching the filters. Using how
            // many are loaded would freeze at 10 and then climb as the agent
            // scrolled, which reads as records appearing out of nowhere.
            // The old total would sit on the tab while the new one is fetched,
            // and a number that is about to change is worse than none.
            const count = loading ? '…' : k === 'farmers' ? farmerPage.total : aggPage.total;
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
          // Fires while the finger is still moving, so the next page is usually
          // in place before the agent reaches the end of what is loaded.
          scrollEventThrottle={16}
          onScroll={(e) => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            const fromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
            if (fromBottom < LOAD_MORE_SLACK) loadMore();
          }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => load(search, dateFilter, onboardedBy)}
            />
          }>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={GREEN} />
              {/* Says what is being fetched, so a filter that takes a moment
                  reads as "working on it" rather than "did that do anything?". */}
              <ThemedText type="small" themeColor="textSecondary">
                {searching
                  ? `Searching ${tab} for “${search}”…`
                  : dateFilter
                    ? `Loading ${tab} registered ${dateFilter.label}…`
                    : `Loading ${tab}…`}
              </ThemedText>
            </View>
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
                      // Read through the helper: this endpoint populates
                      // `onboardedBy`, the agronomist-scoped one sends an id,
                      // and comparing the object directly is always false.
                      const by = onboarderId(f);
                      const mine = !!by && by === user?._id;
                      const who = onboarderName(f);
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
                            {/* Now that the list is everyone's, whose farmer
                                this is matters more than whether it is yours. */}
                            {mine ? 'Onboarded by you' : who ? `By ${who}` : 'From dashboard'}
                          </ThemedText>
                        </View>
                      );
                    })()}
                  </View>
                  {/* Everything on the right edge in one column: the stamp
                      above, the buttons below. It costs no height — the call
                      button and the line of text together are no taller than
                      the three lines of detail beside them — and it keeps the
                      dates in a straight column down the list, which is what
                      makes them scannable. */}
                  <View style={styles.rightCol}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.stampText}>
                      {fmtStamp(f.createdAt)}
                    </ThemedText>
                    <View style={styles.actions}>
                      <Pressable
                        onPress={() => callFarmer(user, { _id: f._id, name: f.name, mobile: f.mobile })}
                        hitSlop={8}
                        style={styles.callBtn}>
                        <Ionicons name="call" size={16} color="#fff" />
                      </Pressable>
                      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                    </View>
                  </View>
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

          {/* What the bottom of the list means. Scrolling normally brings the
              next page in on its own; the button is what is left when that
              misses — a short list that never scrolls, or a request that
              failed — so the agent is never stuck at a stale end. */}
          {!loading && list.length > 0 ? (
            <View style={styles.listFoot}>
              {loadingMore ? (
                <View style={styles.footRow}>
                  <ActivityIndicator size="small" color={GREEN} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Loading more…
                  </ThemedText>
                </View>
              ) : (tab === 'farmers' ? farmerPage : aggPage).hasMore ? (
                <Pressable
                  onPress={loadMore}
                  style={({ pressed }) => [styles.loadMoreBtn, pressed && { opacity: 0.8 }]}>
                  <Ionicons name="chevron-down" size={14} color={GREEN} />
                  <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                    Load {PAGE_SIZE} more
                  </ThemedText>
                </Pressable>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  All {(tab === 'farmers' ? farmerPage : aggPage).total} {tab} shown
                </ThemedText>
              )}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <FilterPicker
        visible={whoOpen}
        title="Onboarded by"
        allLabel="Everyone"
        options={staff.map((a) => ({
          value: a._id,
          label:
            (a._id === user?._id ? `${a.name} (you)` : a.name) +
            (a.onboardedCount != null ? ` — ${a.onboardedCount}` : ''),
        }))}
        selected={onboardedBy}
        onSelect={setOnboardedBy}
        onClose={() => setWhoOpen(false)}
      />

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
              onPress={() => setPickerFor('day')}
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

            {/* A range of the agent's own choosing: from one date to another.
                The count on the tab is the server's total for the window, so
                "how many did we onboard between these dates" is answered the
                moment it is applied. */}
            <View style={[styles.pickDate, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="calendar-number-outline" size={18} color={GREEN} />
              <View style={{ flex: 1, gap: Spacing.two }}>
                <ThemedText type="smallBold">Pick a date range</ThemedText>
                <View style={styles.rangeRow}>
                  {(['from', 'to'] as const).map((end) => {
                    const value = end === 'from' ? rangeFrom : rangeTo;
                    return (
                      <Pressable
                        key={end}
                        onPress={() => setPickerFor(end)}
                        style={({ pressed }) => [
                          styles.rangeField,
                          {
                            backgroundColor: theme.background,
                            borderColor: value ? GREEN : 'transparent',
                          },
                          pressed && { opacity: 0.85 },
                        ]}>
                        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                          {end === 'from' ? 'From' : 'To'}
                        </ThemedText>
                        <ThemedText
                          type="smallBold"
                          style={{ color: value ? theme.text : theme.textSecondary }}>
                          {value ? fmtDate(value.toISOString()) : 'Select'}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  disabled={!rangeFrom || !rangeTo}
                  onPress={() => {
                    if (!rangeFrom || !rangeTo) return;
                    // Whichever was tapped first is the start; nobody should
                    // have to know that before choosing.
                    const [a, b] =
                      rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom];
                    setDateFilter({
                      label: `${fmtDate(a.toISOString())} – ${fmtDate(b.toISOString())}`,
                      from: startOfDay(a),
                      to: endOfDay(b),
                    });
                    setFilterOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.applyBtn,
                    (!rangeFrom || !rangeTo) && { opacity: 0.4 },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Apply range
                  </ThemedText>
                </Pressable>
              </View>
            </View>

            {pickerFor ? (
              <DateTimePicker
                value={
                  pickerFor === 'from'
                    ? (rangeFrom ?? new Date())
                    : pickerFor === 'to'
                      ? (rangeTo ?? new Date())
                      : (dateFilter?.from ?? new Date())
                }
                mode="date"
                maximumDate={new Date()}
                onChange={(event, selected) => {
                  const which = pickerFor;
                  if (Platform.OS !== 'ios') setPickerFor(null);
                  if (event.type !== 'set' || !selected) return;
                  if (which === 'from') {
                    setRangeFrom(selected);
                  } else if (which === 'to') {
                    setRangeTo(selected);
                  } else {
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
            {Platform.OS === 'ios' && pickerFor ? (
              <Pressable
                onPress={() => {
                  // Picking one end of a range stays on the sheet so the other
                  // end can be picked; an exact day is the whole answer and
                  // closes it.
                  const wasDay = pickerFor === 'day';
                  setPickerFor(null);
                  if (wasDay) setFilterOpen(false);
                }}
                style={styles.doneBtn}>
                <ThemedText type="linkPrimary">Done</ThemedText>
              </Pressable>
            ) : null}

            {dateFilter ? (
              <Pressable
                onPress={() => {
                  setDateFilter(null);
                  setRangeFrom(null);
                  setRangeTo(null);
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
  listFoot: { alignItems: 'center', paddingVertical: Spacing.four, gap: Spacing.two },
  loadingWrap: { alignItems: 'center', gap: Spacing.three, marginTop: Spacing.six },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  loadMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: `${GREEN}55`,
    backgroundColor: Brand.primarySurface,
  },
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
  rightCol: { alignItems: 'flex-end', gap: Spacing.two },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // Never wrapped: half a date on two lines is worse than a name that had to
  // give up a few characters, so the detail column yields the width instead.
  stampText: { fontSize: 11, fontWeight: '600' },
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
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  rangeRow: { flexDirection: 'row', gap: Spacing.two },
  rangeField: {
    flex: 1,
    gap: 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1.5,
  },
  applyBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.two,
    backgroundColor: GREEN,
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
  // Avatar, details, call button — the whole card is now this one row.
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
