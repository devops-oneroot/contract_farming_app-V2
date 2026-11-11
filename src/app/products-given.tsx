import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { TextInput } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { FilterPicker } from '@/components/filter-picker';
import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop, Farmer, Product, ProductSale, saleBuyer } from '@/lib/api';
import { DateFilter, DateFilterSheet } from '@/components/date-filter-sheet';
import { limitSearch } from '@/lib/mobile';

const GREEN = Brand.primary;
const AMBER = Brand.accent;
const GREEN_SURFACE = Brand.surface;

/** Big enough to fill a tall screen, small enough to arrive on a field connection. */
const PAGE_SIZE = 20;
/** Long enough that typing a village name is one request, not eight. */
const SEARCH_DEBOUNCE_MS = 350;

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "how many days" is the question, so lead with the number and keep it short. */
function ago(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  const months = Math.round(d / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

/**
 * Was this typed up long after the sale happened?
 *
 * `soldAt` is what the agent says, `createdAt` is when the record reached us;
 * a wide gap between them means the sale was entered from memory rather than
 * on the day. Two days of slack keeps normal evening catch-up out of it.
 */
const LATE_ENTRY_MS = 2 * 86_400_000;
const enteredLate = (s: ProductSale) =>
  !!s.createdAt && new Date(s.createdAt).getTime() - new Date(s.soldAt).getTime() > LATE_ENTRY_MS;

/**
 * Taluk and district, whichever of them the farmer actually has. Rural
 * addresses are often part-filled, so this never renders a stray comma.
 */
const place = (f?: Farmer) =>
  [f?.farmAddress?.taluk, f?.farmAddress?.district].filter(Boolean).join(', ');

/**
 * Everything this agronomist has handed over, across every farmer.
 *
 * The farmer's own page answers "what has this farmer had"; this answers the
 * other direction — "what have I given, to whom, and how long ago".
 *
 * Paged, searched and totalled on the server. A field agent two seasons in has
 * hundreds of handovers, and neither the phone nor the connection should have
 * to carry all of them to show twenty.
 */
export default function ProductsGivenScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [sales, setSales] = useState<ProductSale[]>([]);
  // Address and photo live on the farmer, not the sale, so the roster is
  // fetched once and joined by id — never one request per row.
  const [farmers, setFarmers] = useState<Record<string, Farmer>>({});
  const [totals, setTotals] = useState({ count: 0, products: 0, value: 0 });
  const [dueCount, setDueCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const page = useRef(1);

  // Farmer or FPO, by name or number. Product and crop are picked, not typed.
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);
  const [crop, setCrop] = useState<string | null>(null);
  const [picking, setPicking] = useState<'product' | 'crop' | null>(null);
  /** When these were given. Null shows every sale, however old. */
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  // The catalogues that back the two pickers.
  const [products, setProducts] = useState<Product[]>([]);
  const [crops, setCrops] = useState<CatalogCrop[]>([]);

  // A slow first page for "ram" must not land on top of results for "ramesh".
  const request = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setTerm(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const loadFirst = useCallback(async () => {
    if (!user) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const [res, count] = await Promise.all([
        api.listProductSalesPage({
          agronomistId: user._id,
          search: term,
          productId: productId ?? undefined,
          crop: crop ?? undefined,
          range: dateFilter ?? undefined,
          pendingAfter: dueOnly,
          page: 1,
          limit: PAGE_SIZE,
        }),
        // One row is enough — only the count is wanted, for the chip's badge.
        api
          .listProductSalesPage({ agronomistId: user._id, pendingAfter: true, page: 1, limit: 1 })
          .then((r) => r.total)
          .catch(() => 0),
      ]);
      if (ticket !== request.current) return;
      page.current = 1;
      setSales(res.items);
      setHasMore(res.hasMore);
      setTotals({ count: res.total, products: res.totals.products, value: res.totals.value });
      setDueCount(count);
    } catch {
      if (ticket === request.current) {
        setSales([]);
        setHasMore(false);
      }
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [user, term, dueOnly, productId, crop, dateFilter]);

  const loadMore = useCallback(async () => {
    if (!user || loadingMore || !hasMore) return;
    const ticket = request.current;
    setLoadingMore(true);
    try {
      const res = await api.listProductSalesPage({
        agronomistId: user._id,
        search: term,
        productId: productId ?? undefined,
        crop: crop ?? undefined,
        range: dateFilter ?? undefined,
        pendingAfter: dueOnly,
        page: page.current + 1,
        limit: PAGE_SIZE,
      });
      // The filter changed while this was in flight — the page belongs to a
      // list that no longer exists.
      if (ticket !== request.current) return;
      page.current += 1;
      setSales((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
    } catch {
      if (ticket === request.current) setHasMore(false);
    } finally {
      if (ticket === request.current) setLoadingMore(false);
    }
  }, [user, term, dueOnly, productId, crop, dateFilter, loadingMore, hasMore]);

  /**
   * Fetched once and never paged: the roster only supplies photos and
   * addresses, and the two catalogues only fill the pickers. Each failure
   * costs a decoration or a filter, never the list itself.
   */
  useEffect(() => {
    if (!user) return;
    api
      .listAgronomistFarmers(user._id)
      .then((roster) => setFarmers(Object.fromEntries(roster.map((f) => [f._id, f]))))
      .catch(() => {});
    api.listProducts().then(setProducts).catch(() => {});
    api.listCropCatalog().then(setCrops).catch(() => {});
  }, [user]);

  /**
   * Covers both the first load and every later one: the effect re-runs
   * whenever `loadFirst` changes identity, which is exactly when the search
   * term or the filter changed. A separate mount effect alongside this would
   * simply fire every query twice.
   *
   * On focus it also picks up an after-photo taken on the farmer's page since.
   */
  useFocusEffect(
    useCallback(() => {
      loadFirst();
    }, [loadFirst])
  );

  const renderSale = ({ item: s }: { item: ProductSale }) => {
    const due = !!s.afterDueAt && new Date(s.afterDueAt).getTime() <= Date.now();
    // A sale goes to a farmer or an FPO. Read through one helper so the two can
    // never be shown as each other.
    const buyer = saleBuyer(s);
    const toFpo = buyer.kind === 'fpo';
    // Photo and address live on the farmer record; an FPO has neither here.
    const farmer = toFpo ? undefined : farmers[s.farmer ?? ''];
    const where = place(farmer);
    return (
      <Pressable
        /**
         * A farmer's row opens their page, where the follow-up photo is taken.
         * An FPO has no such page and no after-photo to chase, so its row is
         * not a link to somewhere that cannot act on it.
         */
        onPress={
          toFpo
            ? undefined
            : () =>
                router.push({
                  pathname: '/farmer',
                  params: { farmerId: s.farmer, name: buyer.name },
                } as never)
        }
        style={({ pressed }) => !toFpo && pressed && { opacity: 0.7 }}>
        <ThemedView type="card" style={styles.card}>
          <View style={styles.cardHead}>
            {/* Onboarding photo when there is one; initial otherwise, so the
                row never collapses to a different height. */}
            {farmer?.photoUrl ? (
              <TappablePhoto uri={farmer.photoUrl} style={styles.avatar} caption={buyer.name} />
            ) : (
              <View
                style={[
                  styles.avatar,
                  styles.avatarEmpty,
                  toFpo && { backgroundColor: Brand.secondarySurface },
                ]}>
                {toFpo ? (
                  <Ionicons name="business" size={17} color={Brand.secondary} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: GREEN }}>
                    {buyer.name.trim().charAt(0).toUpperCase()}
                  </ThemedText>
                )}
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                  {buyer.name}
                </ThemedText>
                {/* Said, not implied. Without it an FPO sale reads as a farmer
                    sale whose details happen to be missing. */}
                {toFpo ? (
                  <View style={styles.fpoTag}>
                    <ThemedText type="small" style={styles.fpoTagText}>
                      FPO
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {buyer.mobile || 'no number'}
                {s.cropName ? ` · ${s.cropName}` : ''}
              </ThemedText>
              {where ? (
                <View style={styles.placeRow}>
                  <Ionicons name="location-outline" size={12} color={theme.textSecondary} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.placeText}>
                    {where}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <ThemedText type="smallBold" style={{ color: GREEN }}>
                {money(s.total)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {ago(s.soldAt)}
              </ThemedText>
              {/* A record written up well after the handover. Said plainly, so
                  the date on the row is not mistaken for the day somebody sat
                  down and typed it. A day's gap is ordinary — an agent
                  finishing their round in the evening — so only a real gap
                  counts. */}
              {enteredLate(s) ? (
                <ThemedText type="small" style={{ color: Brand.accent, fontWeight: '700' }}>
                  added later
                </ThemedText>
              ) : null}
            </View>
          </View>

          {s.items.map((it) => (
            <View key={it.product} style={styles.line}>
              {it.imageUrl ? (
                <TappablePhoto uri={it.imageUrl} style={styles.thumb} caption={it.name} />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Ionicons name="cube-outline" size={12} color={theme.textSecondary} />
                </View>
              )}
              <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                {it.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {it.qty}
                {it.unit ? ` ${it.unit}` : ''} · {money(it.lineTotal)}
              </ThemedText>
              {/* Only worth a mark once the wait is actually over. */}
              {due && !it.afterPhotoUrl ? (
                <Ionicons name="camera-outline" size={14} color={AMBER} />
              ) : it.afterPhotoUrl ? (
                <Ionicons name="checkmark-circle" size={14} color={GREEN} />
              ) : (
                <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
              )}
            </View>
          ))}

          {due && s.items.some((it) => !it.afterPhotoUrl) && (
            <ThemedText type="small" style={styles.dueNote}>
              After-photo due — tap to open {s.farmerName || 'the farmer'}
            </ThemedText>
          )}

          {/* The bill for this one sale, at the foot of what it is a bill for.
              Opened rather than fetched: the phone's browser downloads it and
              can then share it straight to the buyer on WhatsApp.

              Its own Pressable, so the card's press never fires for a tap
              meant for the bill: a nested touchable claims the responder, and
              the whole card is otherwise a link to the farmer's page. */}
          <View style={styles.cardFoot}>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                Linking.openURL(api.saleInvoicePdfUrl(s._id)).catch(() =>
                  Alert.alert('Could not open the bill', 'Please try again.')
                );
              }}
              hitSlop={8}
              accessibilityLabel={`Download the bill for ${buyer.name}`}
              style={({ pressed }) => [styles.billBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="download-outline" size={13} color={GREEN} />
              <ThemedText type="small" style={styles.billBtnText}>
                Download bill
              </ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </Pressable>
    );
  };

  const searching = !!term || dueOnly || !!productId || !!crop;
  // The button shows the chosen product, so it needs the name behind the id.
  const productName = products.find((p) => p._id === productId)?.name ?? null;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader
          onBack={() => router.back()}
          title="Products given"
          right={
            <>
              {/* Sales made on the field get recorded on the field. This is for the
                  ones that did not — a sale from last week that never got typed
                  in. It lives here rather than on a farmer's page because that is
                  how the gap is noticed: looking at this list and missing a row. */}
              <Pressable
                onPress={() => router.push('/old-sale-buyer' as never)}
                hitSlop={10}
                accessibilityLabel="Add an old sale that was not recorded"
                style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.75 }]}>
                <Ionicons name="add" size={18} color="#fff" />
              </Pressable>
            </>
          }
        />

        {/* Kept out of the list: an agent filtering a long history should not
            have to scroll back up to change what they searched for. */}
        <View style={styles.tools}>
          <View style={styles.searchRow}>
          <View style={[styles.search, { flex: 1, backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <TextInput
              value={query}
              onChangeText={(v) => setQuery(limitSearch(v))}
              placeholder="Farmer or FPO name or number"
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.text }]}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          {/* Beside the search box, where the People tab keeps its own — an
              agent who learns it once should find it in the same place. */}
          <Pressable
            onPress={() => setDateOpen(true)}
            style={[
              styles.calendarBtn,
              { backgroundColor: dateFilter ? GREEN : theme.backgroundElement },
            ]}>
            <Ionicons
              name="calendar"
              size={18}
              color={dateFilter ? '#fff' : theme.textSecondary}
            />
          </Pressable>

          </View>

          {/* An active date has to be visible, or an empty list reads as lost
              records rather than a filter doing its job. */}
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

          {/* Product and crop, each its own filter, each showing what is
              currently chosen rather than a bare label. */}
          <View style={styles.chipWrap}>
            <Pressable
              onPress={() => setPicking('product')}
              style={[
                styles.filterBtn,
                {
                  backgroundColor: productId ? GREEN : theme.backgroundElement,
                  flex: 1,
                },
              ]}>
              <Ionicons
                name="cube-outline"
                size={14}
                color={productId ? '#fff' : theme.textSecondary}
              />
              <ThemedText
                type="small"
                numberOfLines={1}
                style={{ color: productId ? '#fff' : theme.text, fontWeight: '700', flex: 1 }}>
                {productName ?? 'All products'}
              </ThemedText>
              <Ionicons
                name="chevron-down"
                size={14}
                color={productId ? '#fff' : theme.textSecondary}
              />
            </Pressable>

            <Pressable
              onPress={() => setPicking('crop')}
              style={[
                styles.filterBtn,
                { backgroundColor: crop ? GREEN : theme.backgroundElement, flex: 1 },
              ]}>
              <Ionicons name="leaf-outline" size={14} color={crop ? '#fff' : theme.textSecondary} />
              <ThemedText
                type="small"
                numberOfLines={1}
                style={{ color: crop ? '#fff' : theme.text, fontWeight: '700', flex: 1 }}>
                {crop ?? 'All crops'}
              </ThemedText>
              <Ionicons name="chevron-down" size={14} color={crop ? '#fff' : theme.textSecondary} />
            </Pressable>
          </View>

          {/* Only worth offering when something is actually outstanding. */}
          {dueCount > 0 && (
            <View style={styles.chipWrap}>
              {[
                { on: false, label: 'All' },
                { on: true, label: `Photo due (${dueCount})` },
              ].map((c) => {
                const active = dueOnly === c.on;
                return (
                  <Pressable
                    key={String(c.on)}
                    onPress={() => setDueOnly(c.on)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? GREEN : theme.backgroundElement },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{ color: active ? '#fff' : theme.text, fontWeight: '700' }}>
                      {c.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
        ) : (
          <FlatList
            data={sales}
            keyExtractor={(s) => s._id}
            renderItem={renderSale}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={false} onRefresh={loadFirst} />}
            onEndReachedThreshold={0.4}
            onEndReached={loadMore}
            ListHeaderComponent={
              sales.length > 0 ? (
                <ThemedView type="card" style={styles.summary}>
                  <View style={styles.summaryCell}>
                    <ThemedText type="smallBold" style={{ color: GREEN }}>
                      {totals.count}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.summaryLabel}>
                      handovers
                    </ThemedText>
                  </View>
                  <View style={styles.summaryCell}>
                    <ThemedText type="smallBold" style={{ color: GREEN }}>
                      {totals.products}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.summaryLabel}>
                      products
                    </ThemedText>
                  </View>
                  <View style={styles.summaryCell}>
                    <ThemedText type="smallBold" style={{ color: GREEN }}>
                      {money(totals.value)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.summaryLabel}>
                      value
                    </ThemedText>
                  </View>
                </ThemedView>
              ) : null
            }
            ListEmptyComponent={
              <ThemedView type="card" style={styles.empty}>
                <Ionicons
                  name={searching ? 'search-outline' : 'cube-outline'}
                  size={36}
                  color={theme.textSecondary}
                />
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  {term
                    ? `No farmer matches “${term}”.`
                    : productName
                      ? `You have not given ${productName}${crop ? ` for ${crop}` : ''} yet.`
                      : crop
                        ? `You have not given anything for ${crop} yet.`
                        : dueOnly
                          ? 'No handovers are waiting for a follow-up photo.'
                          : 'You have not given any products yet. Open a farmer and tap “Give product”.'}
                </ThemedText>
              </ThemedView>
            }
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator style={{ marginVertical: Spacing.four }} color={GREEN} />
              ) : !hasMore && sales.length >= PAGE_SIZE ? (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={{ textAlign: 'center', marginVertical: Spacing.four }}>
                  That is everything.
                </ThemedText>
              ) : null
            }
          />
        )}
      </SafeAreaView>

      <DateFilterSheet
        visible={dateOpen}
        value={dateFilter}
        onChange={setDateFilter}
        onClose={() => setDateOpen(false)}
        dayHint="products given"
      />

      <FilterPicker
        visible={picking === 'product'}
        title="Products"
        allLabel="All products"
        options={products.map((p) => ({ value: p._id, label: p.name, imageUrl: p.imageUrl }))}
        selected={productId}
        onSelect={setProductId}
        onClose={() => setPicking(null)}
      />
      {/* Crops key on name, not id: a Crop row belongs to a single farmer, so
          "all the Tomato sales" spans hundreds of different ids. */}
      <FilterPicker
        visible={picking === 'crop'}
        title="Crops"
        allLabel="All crops"
        options={crops.map((c) => ({ value: c.name, label: c.name, imageUrl: c.imageUrl }))}
        selected={crop}
        onSelect={setCrop}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
  },
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  tools: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.two, gap: Spacing.two },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  calendarBtn: {
    width: 42,
    height: 42,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The chosen period, said out loud so an empty list explains itself. */
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: `${GREEN}55`,
    backgroundColor: Brand.primarySurface,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.two, fontSize: 15 },
  chipWrap: { flexDirection: 'row', gap: Spacing.two },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  empty: { padding: Spacing.five, borderRadius: Spacing.four, alignItems: 'center', gap: Spacing.two },
  summary: {
    flexDirection: 'row',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  summaryCell: { flex: 1, alignItems: 'center', gap: 2 },
  summaryLabel: { fontSize: 11 },
  card: { padding: Spacing.three, borderRadius: Spacing.four, marginBottom: Spacing.three },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#d8d8d8' },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.primarySurface,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  /** Marks a sale to an FPO, which is a different kind of buyer entirely. */
  fpoTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Spacing.four,
    backgroundColor: Brand.secondarySurface,
  },
  fpoTagText: { color: Brand.secondary, fontWeight: '800', fontSize: 10 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  placeText: { fontSize: 11 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  thumb: { width: 24, height: 24, borderRadius: Spacing.half, backgroundColor: '#d8d8d8' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  dueNote: { color: AMBER, fontWeight: '700', marginTop: Spacing.two, fontSize: 11 },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: Spacing.two },
  billBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: `${GREEN}55`,
    backgroundColor: Brand.primarySurface,
  },
  billBtnText: { color: GREEN, fontWeight: '700', fontSize: 11 },
});
