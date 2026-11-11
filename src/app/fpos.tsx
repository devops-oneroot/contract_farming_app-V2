import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { TextInput } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { FilterPicker } from '@/components/filter-picker';
import { api, CatalogCrop, DateRange, Fpo, fpoOwnerId, fpoOwnerName } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

/** Long enough that typing a name is one request, not eight. */
const SEARCH_DEBOUNCE_MS = 350;
/**
 * A number is only worth asking the server about once most of it is typed.
 * Four digits of a mobile number match half the roster — the results are noise
 * until then, and every one of those keystrokes would be a request.
 *
 * Names are different: three letters of a name usually narrow it usefully, so
 * they are searched as typed.
 */
const MIN_NUMBER_DIGITS = 8;
const isNumber = (q: string) => /^\d+$/.test(q);
/** Enough to fill a tall screen, small enough to arrive on a field connection. */
/**
 * Rows per request, matching the People tab. Small on purpose: this opens on a
 * phone over a village connection, and the first screenful arriving quickly
 * matters more than holding every FPO at once.
 */
const PAGE_SIZE = 10;

/** Matches the list offered at onboarding, so every chip can return rows. */
const ROLES = ['President', 'Secretary', 'CEO', 'Director', 'Board member'];

/**
 * The window the list is narrowed to, sent to the server as `?from=&to=`.
 *
 * Built from LOCAL midnight to local 23:59:59.999, so "onboarded on the 12th"
 * means the 12th where the agronomist is standing. Same shape and same
 * behaviour as the People tab's date filter — one pattern, not two.
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

/** The one-tap ranges. "Pick an exact day" is handled by the calendar. */
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

/** "12 Jul 2026" — the label a picked day gets. */
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const num = (n: number) => n.toLocaleString('en-IN');

/** Taluk and district, skipping whichever of them the record lacks. */
const place = (f: Fpo) =>
  [f.address?.taluk, f.address?.district].filter(Boolean).join(', ');

/**
 * The FPOs this agronomist has onboarded: how many, who they are, and a way in
 * to correct any of them.
 *
 * Searched on the server, over every person on the record rather than only the
 * primary contact — whoever is looking has a name, not a slot number.
 */
export default function FposScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [fpos, setFpos] = useState<Fpo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  /** Whose FPOs to show, by the agronomist who onboarded them. Null = everyone. */
  const [onboardedBy, setOnboardedBy] = useState<string | null>(null);
  /** The agronomists to choose between. Loaded once and kept. */
  const [staff, setStaff] = useState<{ _id: string; name: string }[]>([]);
  const pageRef = useRef(1);
  /** A slow first page for "ram" must not land on top of results for "ramesh". */
  const request = useRef(0);
  // Names and numbers only. Role is picked, not typed.
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [crop, setCrop] = useState<string | null>(null);
  // Null = show everything, exactly as on the People tab.
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  /**
   * Which date the calendar is being opened for: one exact day, or either end
   * of a range. One picker for all three, as on the People tab.
   */
  const [pickerFor, setPickerFor] = useState<'day' | 'from' | 'to' | null>(null);
  /** Both ends of a custom range, applied together or not at all. */
  const [rangeFrom, setRangeFrom] = useState<Date | null>(null);
  const [rangeTo, setRangeTo] = useState<Date | null>(null);
  const [picking, setPicking] = useState<'crop' | 'who' | null>(null);
  const [catalog, setCatalog] = useState<CatalogCrop[]>([]);

  useEffect(() => {
    // Only fills the crop picker — its failure costs a filter, not the list.
    api.listCropCatalog().then(setCatalog).catch(() => {});
  }, []);
  /** The unfiltered total, so searching never makes it look like work vanished. */
  const [totalCount, setTotalCount] = useState<number | null>(null);

  useEffect(() => {
    const q = query.trim();
    // Half a phone number is not a search. Until it is long enough the term
    // stays empty, so the list shows everything rather than a wrong subset.
    const tooShort = isNumber(q) && q.length < MIN_NUMBER_DIGITS;
    const t = setTimeout(() => setTerm(tooShort ? '' : q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  /** The agronomists to choose between, for the "Onboarded by" filter. */
  useEffect(() => {
    api
      .listAgronomistsWithCounts()
      .then((list) => setStaff(list.map((a) => ({ _id: a._id, name: a.name }))))
      .catch(() => setStaff([]));
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const res = await api.listFposPage({
        /**
         * Everyone's FPOs, not only this agent's.
         *
         * An FPO is an organisation the whole team deals with, and an agent
         * standing in a village needs to find whoever is in front of them —
         * scoping the list to their own meant an FPO a colleague onboarded
         * could not be looked up at all, and two agents would register the same
         * one twice. Each row says whose it is instead.
         */
        agronomistId: onboardedBy ?? undefined,
        search: term || undefined,
        role: role ?? undefined,
        crop: crop ?? undefined,
        range: dateFilter ?? undefined,
        page: 1,
        limit: PAGE_SIZE,
      });
      if (ticket !== request.current) return;
      pageRef.current = 1;
      setFpos(res.items);
      setHasMore(res.hasMore);
      // Only a wholly unfiltered load can speak for the total.
      if (!term && !role && !crop && !dateFilter && !onboardedBy) setTotalCount(res.total);
    } catch {
      if (ticket === request.current) {
        setFpos([]);
        setHasMore(false);
      }
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [user, term, role, crop, dateFilter, onboardedBy]);

  const loadMore = useCallback(async () => {
    if (!user || loadingMore || !hasMore) return;
    const ticket = request.current;
    setLoadingMore(true);
    try {
      const res = await api.listFposPage({
        agronomistId: onboardedBy ?? undefined,
        search: term || undefined,
        role: role ?? undefined,
        crop: crop ?? undefined,
        range: dateFilter ?? undefined,
        page: pageRef.current + 1,
        limit: PAGE_SIZE,
      });
      // The filter changed while this was in flight — this page belongs to a
      // list that no longer exists.
      if (ticket !== request.current) return;
      pageRef.current += 1;
      setFpos((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
    } catch {
      if (ticket === request.current) setHasMore(false);
    } finally {
      if (ticket === request.current) setLoadingMore(false);
    }
  }, [user, term, role, crop, dateFilter, onboardedBy, loadingMore, hasMore]);

  // Also refreshes after an edit, since that is where this screen leads.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const renderFpo = ({ item: f }: { item: Fpo }) => {
    const where = place(f);
    const mine = fpoOwnerId(f) === user?._id;
    const who = fpoOwnerName(f);
    /**
     * How big this FPO is, on one line rather than three tiles.
     *
     * The figures matter, but not enough to cost a row each — an agent scanning
     * a list wants to recognise the FPO and get on, and a card that fills half
     * the screen means scrolling to see the next one.
     *
     * `contacts` counts the representative plus their members, which is the
     * number a person would say out loud.
     */
    const facts = [
      f.farmerCount > 0 ? `${num(f.farmerCount)} farmers` : '',
      (f.members?.length ?? 0) > 0 ? `${f.members.length + 1} contacts` : '',
      (f.crops?.length ?? 0) > 0 ? f.crops.join(', ') : '',
    ].filter(Boolean);

    return (
      <ThemedView type="card" style={styles.card}>
        {/* Two distinct targets, side by side: the details, and the sale. They
            were a full-width button nested inside a card-wide Pressable, where
            the outer one usually won and "Give product" opened the edit form
            instead. */}
        <Pressable
          onPress={() => router.push({ pathname: '/onboard-fpo', params: { fpoId: f._id } } as never)}
          style={({ pressed }) => [styles.cardMain, pressed && { opacity: 0.7 }]}>
          {f.photoUrl ? (
            <TappablePhoto uri={f.photoUrl} style={styles.avatar} caption={f.name} />
          ) : (
            // The FPO's initial, not a generic building: scanning a list, the
            // letter tells them apart and the same icon on every row does not.
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <ThemedText style={styles.avatarText}>
                {f.name?.charAt(0)?.toUpperCase() ?? '?'}
              </ThemedText>
            </View>
          )}

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.nameRow}>
              <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                {f.name}
              </ThemedText>
              {/* Whose FPO this is, now that the list is everyone's. Marked only
                  when it belongs to someone else — "yours" is the assumption. */}
              {!mine && who ? (
                <View style={styles.byTag}>
                  <ThemedText type="small" style={styles.byTagText}>
                    {who}
                  </ThemedText>
                </View>
              ) : null}
            </View>

            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {f.mobile}
              {f.role ? ` · ${f.role}` : ''}
            </ThemedText>

            {/* Place and figures share the last line, truncated rather than
                wrapped: a third line here is what made the card tall. */}
            {where || facts.length ? (
              <View style={styles.metaRow}>
                {where ? (
                  <Ionicons name="location-outline" size={11} color={theme.textSecondary} />
                ) : null}
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={1}
                  style={styles.meta}>
                  {[where, ...facts].filter(Boolean).join(' · ')}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </Pressable>

        {/* Selling to the FPO itself, as a bulk buyer for its members. Its own
            square target on the right, so it is never hit by someone aiming at
            the card — and costs no extra height. */}
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/give-product',
              params: {
                fpoId: f._id,
                fpoName: f.name,
                // Its crops travel as names: an FPO has no Crop records, so
                // there is nothing to look up on the other side.
                fpoCrops: (f.crops ?? []).join(','),
              },
            } as never)
          }
          hitSlop={6}
          accessibilityLabel={`Give product to ${f.name}`}
          style={({ pressed }) => [styles.sellBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="cart" size={16} color="#fff" />
        </Pressable>
      </ThemedView>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader
          onBack={() => router.back()}
          title={<>FPOs{totalCount != null ? ` (${totalCount})` : ''}</>}
          right={
            <>
              <Pressable onPress={() => router.push('/onboard-fpo' as never)} hitSlop={10}>
                <Ionicons name="add-circle" size={26} color={GREEN} />
              </Pressable>
            </>
          }
        />

        {/* Outside the list: filtering a long one should not mean scrolling
            back up to change what was searched. */}
        <View style={styles.tools}>
          {/* Search, then the calendar — the same arrangement as the People tab. */}
          <View style={styles.searchRow}>
            <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="search" size={18} color={theme.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Name or number"
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, { color: theme.text }]}
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => setFilterOpen(true)}
              style={({ pressed }) => [
                styles.calendarBtn,
                {
                  backgroundColor: dateFilter ? GREEN : theme.backgroundElement,
                },
                pressed && { opacity: 0.85 },
              ]}>
              <Ionicons
                name="calendar-outline"
                size={18}
                color={dateFilter ? '#fff' : theme.textSecondary}
              />
            </Pressable>
          </View>

          {/* Says why the list has not reacted yet, so a half-typed number
              does not read as a search that stopped working. */}
          {isNumber(query.trim()) && query.trim().length < MIN_NUMBER_DIGITS ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.searchHint}>
              Enter {MIN_NUMBER_DIGITS} digits to search by number
            </ThemedText>
          ) : null}

          {/* An active filter has to be visible, or an empty list looks like
              lost data rather than a filter doing its job. */}
          {dateFilter ? (
            <View style={styles.activeFilter}>
              <Ionicons name="funnel" size={12} color={GREEN} />
              <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
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
              <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                {onboardedBy === user?._id
                  ? 'Onboarded by you'
                  : `By ${staff.find((a) => a._id === onboardedBy)?.name ?? 'agent'}`}
              </ThemedText>
              <Pressable onPress={() => setOnboardedBy(null)} hitSlop={10}>
                <Ionicons name="close-circle" size={16} color={GREEN} />
              </Pressable>
            </View>
          ) : null}

          {/* The crop pill is pinned; only the roles scroll past it. Crop is
              the filter an agent changes least and looks for most, so it must
              not be the one that slides out of reach. */}
          <View style={styles.filterBar}>
            <Pressable
              onPress={() => setPicking('crop')}
              style={[
                styles.pill,
                styles.cropPill,
                { backgroundColor: crop ? GREEN : theme.backgroundElement },
              ]}>
              <Ionicons name="leaf-outline" size={13} color={crop ? '#fff' : theme.textSecondary} />
              <ThemedText
                type="small"
                numberOfLines={1}
                style={[styles.pillText, { color: crop ? '#fff' : theme.text }]}>
                {crop ?? 'All crops'}
              </ThemedText>
              <Ionicons name="chevron-down" size={13} color={crop ? '#fff' : theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => setPicking('who')}
              style={[
                styles.pill,
                { backgroundColor: onboardedBy ? GREEN : theme.backgroundElement },
              ]}>
              <Ionicons
                name="people-outline"
                size={13}
                color={onboardedBy ? '#fff' : theme.textSecondary}
              />
              <ThemedText
                type="small"
                numberOfLines={1}
                style={[styles.pillText, { color: onboardedBy ? '#fff' : theme.text }]}>
                {onboardedBy
                  ? onboardedBy === user?._id
                    ? 'You'
                    : (staff.find((a) => a._id === onboardedBy)?.name ?? 'Agent')
                  : 'Anyone'}
              </ThemedText>
              <Ionicons
                name="chevron-down"
                size={13}
                color={onboardedBy ? '#fff' : theme.textSecondary}
              />
            </Pressable>

            {/* Marks where the fixed part ends and the scrolling part begins. */}
            <View style={[styles.pillDivider, { backgroundColor: theme.backgroundElement }]} />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.roleRow}>
              {ROLES.map((r) => {
                const on = role === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => setRole(on ? null : r)}
                    style={[styles.pill, { backgroundColor: on ? GREEN : theme.backgroundElement }]}>
                    <ThemedText
                      type="small"
                      style={[styles.pillText, { color: on ? '#fff' : theme.text }]}>
                      {r}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
        ) : (
          <FlatList
            data={fpos}
            keyExtractor={(f) => f._id}
            renderItem={renderFpo}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
            onEndReachedThreshold={0.4}
            onEndReached={loadMore}
            /**
             * What the bottom of the list means, the same way the People tab
             * says it. Scrolling brings the next page in on its own; the button
             * is what is left when that misses — a short list that never
             * scrolls, or a request that failed — so the agent is never stuck
             * at a stale end.
             */
            ListFooterComponent={
              fpos.length === 0 ? null : (
                <View style={styles.listFoot}>
                  {loadingMore ? (
                    <View style={styles.footRowCenter}>
                      <ActivityIndicator size="small" color={GREEN} />
                      <ThemedText type="small" themeColor="textSecondary">
                        Loading more…
                      </ThemedText>
                    </View>
                  ) : hasMore ? (
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
                      All {totalCount ?? fpos.length} FPOs shown
                    </ThemedText>
                  )}
                </View>
              )
            }
            ListEmptyComponent={
              <ThemedView type="card" style={styles.empty}>
                <Ionicons
                  name={term ? 'search-outline' : 'business-outline'}
                  size={36}
                  color={theme.textSecondary}
                />
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  {term
                    ? `No name or number matches “${term}”.`
                    : crop
                      ? `No FPO of yours deals in ${crop}${dateFilter ? ' then' : ''}.`
                      : dateFilter
                        ? `Nothing onboarded ${dateFilter.label.toLowerCase()}.`
                        : role
                          ? `No ${role.toLowerCase()} on your FPOs.`
                          : 'You have not onboarded any FPO yet. Tap + to add one.'}
                </ThemedText>
              </ThemedView>
            }
          />
        )}
      </SafeAreaView>

      <FilterPicker
        visible={picking === 'who'}
        title="Onboarded by"
        allLabel="Everyone"
        options={staff.map((a) => ({
          value: a._id,
          label: a._id === user?._id ? `${a.name} (you)` : a.name,
        }))}
        selected={onboardedBy}
        onSelect={setOnboardedBy}
        onClose={() => setPicking(null)}
      />
      <FilterPicker
        visible={picking === 'crop'}
        title="Crops"
        allLabel="All crops"
        options={catalog.map((c) => ({ value: c.name, label: c.name, imageUrl: c.imageUrl }))}
        selected={crop}
        onSelect={setCrop}
        onClose={() => setPicking(null)}
      />
      {/* Filter by when an FPO was onboarded. Same sheet, same wording and
          same behaviour as the People tab's date filter. */}
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
              Show only FPOs onboarded in this period.
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
                  See every FPO onboarded on one date
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>

            {/* A range of the agent's own choosing, the same control the People
                tab has. The count in the title is the server's total for the
                window, so "how many FPOs between these dates" is answered on
                apply. */}
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
                          {value ? fmtDate(value) : 'Select'}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  disabled={!rangeFrom || !rangeTo}
                  onPress={() => {
                    if (!rangeFrom || !rangeTo) return;
                    // Either order works; whichever is earlier is the start.
                    const [a, b] =
                      rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom];
                    setDateFilter({
                      label: `${fmtDate(a)} – ${fmtDate(b)}`,
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
                      label: fmtDate(selected),
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
                  // One end of a range stays on the sheet so the other can be
                  // picked; an exact day is the whole answer and closes it.
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
                style={styles.clearDate}>
                <ThemedText type="small" themeColor="textSecondary">
                  Clear date filter
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  calendarBtn: {
    width: 44,
    height: 44,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginHorizontal: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.five,
    backgroundColor: Brand.primarySurface,
  },
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
    borderRadius: Spacing.five,
    borderWidth: 1,
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
  pickDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.three,
  },
  clearDate: { alignItems: 'center', paddingVertical: Spacing.three, marginTop: Spacing.two },
  container: { flex: 1 },
  tools: { paddingBottom: Spacing.two, gap: Spacing.two },
  search: {
    // flex, not a margin: the row already provides the outer padding, and a
    // margin here left no width for the calendar button beside it.
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.two, fontSize: 15 },
  searchHint: { fontSize: 11, marginHorizontal: Spacing.four },
  // Padded rather than margined, so the pills scroll out under the screen edge
  // instead of stopping short of it.
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Left padding only: the scrolling roles should run out under the right
    // edge rather than stopping short of it.
    paddingLeft: Spacing.four,
  },
  // The pinned pill must not be squeezed by a long role list beside it.
  cropPill: { flexShrink: 0, maxWidth: 150 },
  roleRow: { gap: Spacing.two, alignItems: 'center', paddingRight: Spacing.four },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.five,
  },
  pillText: { fontWeight: '600', fontSize: 13 },
  pillDivider: { width: 1, height: 18, marginHorizontal: Spacing.one },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  empty: { padding: Spacing.five, borderRadius: Spacing.four, alignItems: 'center', gap: Spacing.two },
  /** One row: details on the left, the sale button on the right. */
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#d8d8d8' },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  meta: { flex: 1, fontSize: 11 },
  /** How big this FPO is, as figures rather than a grey run-on line. */
  /** Separates the details from the action, so neither is hit by accident. */
  listFoot: { alignItems: 'center', paddingVertical: Spacing.four, gap: Spacing.two },
  footRowCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
  /** Sell to this FPO. Outlined, so it reads as an action on the card rather
   *  than another fact about it. */
  sellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  /** Onboarded by a colleague, not by the agent reading this. */
  byTag: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Spacing.four,
    backgroundColor: Brand.secondarySurface,
  },
  byTagText: { color: Brand.secondary, fontWeight: '700', fontSize: 10 },
  footRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});
