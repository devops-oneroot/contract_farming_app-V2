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
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { FilterPicker } from '@/components/filter-picker';
import { api, CatalogCrop, DateRange, Fpo } from '@/lib/api';

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
const PAGE_SIZE = 20;

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picking, setPicking] = useState<'crop' | null>(null);
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

  const load = useCallback(async () => {
    if (!user) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const res = await api.listFposPage({
        agronomistId: user._id,
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
      if (!term && !role && !crop && !dateFilter) setTotalCount(res.total);
    } catch {
      if (ticket === request.current) {
        setFpos([]);
        setHasMore(false);
      }
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [user, term, role, crop, dateFilter]);

  const loadMore = useCallback(async () => {
    if (!user || loadingMore || !hasMore) return;
    const ticket = request.current;
    setLoadingMore(true);
    try {
      const res = await api.listFposPage({
        agronomistId: user._id,
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
  }, [user, term, role, crop, dateFilter, loadingMore, hasMore]);

  // Also refreshes after an edit, since that is where this screen leads.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const renderFpo = ({ item: f }: { item: Fpo }) => {
    const where = place(f);
    return (
      <Pressable
        onPress={() => router.push({ pathname: '/onboard-fpo', params: { fpoId: f._id } } as never)}
        style={({ pressed }) => pressed && { opacity: 0.7 }}>
        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.cardHead}>
            {f.photoUrl ? (
              <TappablePhoto uri={f.photoUrl} style={styles.avatar} caption={f.name} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Ionicons name="business" size={18} color={GREEN} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">{f.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {f.mobile}
                {f.role ? ` · ${f.role}` : ''}
              </ThemedText>
              {where ? (
                <View style={styles.placeRow}>
                  <Ionicons name="location-outline" size={12} color={theme.textSecondary} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                    {where}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            {/* The whole row opens the form, but the pencil says so. */}
            <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
          </View>

          {(f.crops?.length ?? 0) > 0 && (
            <View style={styles.chipWrap}>
              {f.crops.map((c) => (
                <View key={c} style={styles.chip}>
                  <ThemedText type="small" style={styles.chipText}>
                    {c}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}

          <View style={styles.footRow}>
            {f.farmerCount > 0 && (
              <View style={styles.footItem}>
                <Ionicons name="people-outline" size={13} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                  {num(f.farmerCount)} farmers
                </ThemedText>
              </View>
            )}
            {(f.members?.length ?? 0) > 0 && (
              <View style={styles.footItem}>
                <Ionicons name="person-outline" size={13} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                  +{f.members.length} more {f.members.length === 1 ? 'person' : 'people'}
                </ThemedText>
              </View>
            )}
          </View>
        </ThemedView>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">
            My FPOs{totalCount != null ? ` (${totalCount})` : ''}
          </ThemedText>
          <Pressable onPress={() => router.push('/onboard-fpo' as never)} hitSlop={10}>
            <Ionicons name="add-circle" size={26} color={GREEN} />
          </Pressable>
        </View>

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
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator style={{ marginVertical: Spacing.four }} color={GREEN} />
              ) : !hasMore && fpos.length >= PAGE_SIZE ? (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={{ textAlign: 'center', marginVertical: Spacing.four }}>
                  That is everything.
                </ThemedText>
              ) : null
            }
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
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
                  See every FPO onboarded on one date
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
                      label: fmtDate(selected),
                      from: startOfDay(selected),
                      to: endOfDay(selected),
                    });
                    if (Platform.OS !== 'ios') setFilterOpen(false);
                  }
                }}
              />
            ) : null}

            {dateFilter ? (
              <Pressable onPress={() => { setDateFilter(null); setFilterOpen(false); }} style={styles.clearDate}>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
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
  card: { padding: Spacing.three, borderRadius: Spacing.four, marginBottom: Spacing.three },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#d8d8d8' },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.primarySurface,
  },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  small: { fontSize: 11 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Spacing.five,
    backgroundColor: Brand.primarySurface,
  },
  chipText: { color: GREEN, fontWeight: '700', fontSize: 11 },
  footRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
  footItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
