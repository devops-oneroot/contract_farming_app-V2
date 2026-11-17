import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, StockLedger, StockLedgerEntry, StockLedgerLine } from '@/lib/api';

const GREEN = Brand.secondary;
const ORANGE = Brand.primary;

type Kind = StockLedgerEntry['kind'];

const KIND: Record<Kind, { label: string; icon: keyof typeof Ionicons.glyphMap; tint: string; bg: string }> = {
  opening: { label: 'Opening count', icon: 'clipboard-outline', tint: '#2563eb', bg: '#2563eb1A' },
  issue: { label: 'Received from office', icon: 'arrow-down', tint: GREEN, bg: Brand.secondarySurface },
  return: { label: 'Returned to office', icon: 'arrow-up', tint: Brand.accent, bg: Brand.accentSurface },
  adjust: { label: 'Corrected by office', icon: 'create-outline', tint: '#7c3aed', bg: '#7c3aed1A' },
  sale: { label: 'Sold', icon: 'cart', tint: Brand.danger, bg: Brand.dangerSurface },
};

/** The filter chips over the ledger. */
const FILTERS: { key: 'all' | 'in' | Kind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'Received' },
  { key: 'sale', label: 'Sold' },
  { key: 'return', label: 'Returned' },
  { key: 'adjust', label: 'Corrected' },
];

const RANGES = [7, 30, 90] as const;

const n2 = (n: number) => Math.round(n * 100) / 100;
const fmtQty = (n: number) => `${n > 0 ? '+' : ''}${n2(n)}`;
const rupees = (n: number | undefined) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const keyOf = (product: string, variant: string | null) => `${product}:${variant ?? ''}`;
const time = (at: string) => new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

function dayTitle(day: string) {
  const today = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

/**
 * A field executive's own stock: what they hold and what it is worth, each
 * product's full account (given, returned, corrected, sold, left), and the
 * ledger behind it - every entry, day by day, with the buyer and bill for a
 * sale, who in the office made each office entry, and the balance after it.
 */
export default function StockLedgerScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const dark = scheme === 'dark';
  const screenBg = dark ? theme.background : Brand.surface;

  const [ledger, setLedger] = useState<StockLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  /** A product picked from "My products": the ledger shows only its entries. */
  const [product, setProduct] = useState<StockLedgerLine | null>(null);
  /** Products open to show their full account. */
  const [openLine, setOpenLine] = useState<string | null>(null);

  const load = useCallback(
    async (days: number) => {
      if (!user) return;
      try {
        setLedger(await api.myStockLedger(user._id, days));
        setError(null);
      } catch (e: any) {
        setError(e?.message || 'Could not load your stock.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user]
  );

  // Fresh on every visit: the office may have handed over stock since.
  useFocusEffect(
    useCallback(() => {
      load(range);
    }, [load, range])
  );

  const lines = useMemo(
    () => (ledger?.lines ?? []).filter((l) => l.inHand !== 0 || (l.allocated ?? 0) !== 0 || (l.sold ?? 0) !== 0),
    [ledger]
  );
  const totals = ledger?.totals ?? {
    allocated: 0,
    sold: 0,
    soldAmount: 0,
    inHand: lines.reduce((n, l) => n + l.inHand, 0),
    value: 0,
    returned: 0,
  };

  /** The ledger with the chips and the picked product applied; empty days dropped. */
  const days = useMemo(() => {
    const pk = product ? keyOf(product.product, product.variant) : null;
    return (ledger?.days ?? [])
      .map((d) => ({
        ...d,
        entries: d.entries.filter(
          (e) =>
            (!pk || keyOf(e.product, e.variant) === pk) &&
            (filter === 'all' || (filter === 'in' ? e.kind === 'issue' || e.kind === 'opening' : e.kind === filter))
        ),
      }))
      .filter((d) => d.entries.length);
  }, [ledger, filter, product]);

  const card = { backgroundColor: dark ? theme.backgroundElement : Brand.card };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader onBack={() => router.back()} title="My Stock" />

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={ORANGE} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load(range);
                }}
              />
            }>
            {error ? (
              <ThemedText type="small" style={{ color: Brand.danger, marginBottom: Spacing.two }}>
                {error}
              </ThemedText>
            ) : null}

            {ledger && !ledger.since ? (
              <ThemedView type="card" style={[styles.card, { alignItems: 'center', gap: Spacing.two }]}>
                <Ionicons name="cube-outline" size={36} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  No stock has been recorded for you yet. Once the office hands you products, they appear here.
                </ThemedText>
              </ThemedView>
            ) : null}

            {ledger?.since ? (
              <>
                {/* ---------- Summary ---------- */}
                <View style={styles.hero}>
                  <View style={styles.heroTop}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="small" style={styles.heroLabel}>
                        IN HAND NOW
                      </ThemedText>
                      <ThemedText style={styles.heroValue}>
                        {n2(totals.inHand)} <ThemedText style={styles.heroUnit}>units</ThemedText>
                      </ThemedText>
                      <ThemedText type="small" style={styles.heroSub}>
                        {lines.filter((l) => l.inHand > 0).length} products · worth {rupees(totals.value)}
                      </ThemedText>
                    </View>
                    <View style={styles.heroIcon}>
                      <Ionicons name="cube" size={26} color="#fff" />
                    </View>
                  </View>
                  <View style={styles.heroStats}>
                    {[
                      { label: 'Given to me', value: n2(totals.allocated), icon: 'arrow-down-circle-outline' as const },
                      { label: 'Sold', value: n2(totals.sold), icon: 'cart-outline' as const },
                      { label: 'Sales value', value: rupees(totals.soldAmount), icon: 'cash-outline' as const },
                    ].map((s) => (
                      <View key={s.label} style={styles.heroStat}>
                        <Ionicons name={s.icon} size={15} color="#ffffffcc" />
                        <ThemedText type="smallBold" style={{ color: '#fff', fontSize: 15 }}>
                          {s.value}
                        </ThemedText>
                        <ThemedText type="small" style={{ color: '#ffffffcc', fontSize: 10 }}>
                          {s.label}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                  {totals.allocated > 0 ? (
                    <View style={{ marginTop: Spacing.three }}>
                      <View style={styles.heroBar}>
                        <View style={[styles.heroBarFill, { width: `${Math.min(100, (totals.sold / totals.allocated) * 100)}%` }]} />
                      </View>
                      <ThemedText type="small" style={{ color: '#ffffffcc', fontSize: 10, marginTop: 4 }}>
                        {Math.round((totals.sold / totals.allocated) * 100)}% of the stock given to you is sold
                      </ThemedText>
                    </View>
                  ) : null}
                  <ThemedText type="small" style={{ color: '#ffffffaa', fontSize: 10, marginTop: Spacing.two }}>
                    Counted since {new Date(ledger.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </ThemedText>
                </View>

                {/* ---------- Products ---------- */}
                <View style={styles.sectionRow}>
                  <ThemedText type="smallBold" style={{ flex: 1 }}>
                    My products ({lines.length})
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                    Tap for details
                  </ThemedText>
                </View>
                {lines.length === 0 ? (
                  <ThemedView type="card" style={styles.card}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Nothing in hand.
                    </ThemedText>
                  </ThemedView>
                ) : (
                  lines.map((l) => {
                    const k = keyOf(l.product, l.variant);
                    const open = openLine === k;
                    const allocated = l.allocated ?? 0;
                    const pct = allocated > 0 ? Math.min(100, ((l.sold ?? 0) / allocated) * 100) : 0;
                    const low = l.inHand > 0 && l.inHand <= Math.max(1, allocated * 0.2);
                    return (
                      <Pressable
                        key={k}
                        onPress={() => setOpenLine(open ? null : k)}
                        style={({ pressed }) => [styles.productCard, card, pressed && { opacity: 0.9 }]}>
                        <View style={styles.productHead}>
                          <View style={[styles.productIcon, { backgroundColor: Brand.primarySurface }]}>
                            <Ionicons name="leaf" size={18} color={ORANGE} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText type="smallBold" numberOfLines={1}>
                              {l.name}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                              {[l.unit, l.price ? `${rupees(l.price)} each` : ''].filter(Boolean).join(' · ') || 'Product'}
                            </ThemedText>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <ThemedText
                              type="smallBold"
                              style={{ fontSize: 20, color: l.inHand < 0 ? Brand.danger : low ? Brand.accent : theme.text }}>
                              {n2(l.inHand)}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 10 }}>
                              {l.inHand < 0 ? 'oversold' : low ? 'running low' : 'in hand'}
                            </ThemedText>
                          </View>
                        </View>

                        {allocated > 0 ? (
                          <View style={{ marginTop: Spacing.two }}>
                            <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
                              <View style={[styles.barFill, { width: `${pct}%` }]} />
                            </View>
                            <View style={styles.barLegend}>
                              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                                Sold {n2(l.sold ?? 0)} of {n2(allocated)}
                              </ThemedText>
                              <ThemedText type="small" style={{ fontSize: 11, color: GREEN, fontWeight: '700' }}>
                                {rupees(l.soldAmount)}
                              </ThemedText>
                            </View>
                          </View>
                        ) : null}

                        {open ? (
                          <View style={[styles.account, { borderTopColor: theme.backgroundSelected }]}>
                            {[
                              { label: 'Opening count', value: l.opening ?? 0, sign: '' },
                              { label: 'Received from office', value: l.issued ?? 0, sign: '+' },
                              { label: 'Returned to office', value: l.returned ?? 0, sign: '−' },
                              { label: 'Corrected by office', value: l.adjusted ?? 0, sign: (l.adjusted ?? 0) < 0 ? '' : '+' },
                              { label: 'Total given to me', value: allocated, sign: '', bold: true },
                              { label: 'Sold', value: l.sold ?? 0, sign: '−' },
                              { label: 'In hand', value: l.inHand, sign: '', bold: true },
                            ]
                              .filter((r) => r.bold || r.value !== 0)
                              .map((r) => (
                                <View key={r.label} style={styles.accountRow}>
                                  <ThemedText type="small" themeColor={r.bold ? undefined : 'textSecondary'} style={r.bold && { fontWeight: '700' }}>
                                    {r.label}
                                  </ThemedText>
                                  <ThemedText type="small" style={{ fontWeight: r.bold ? '800' : '600' }}>
                                    {r.sign}
                                    {n2(Math.abs(r.value))}
                                  </ThemedText>
                                </View>
                              ))}
                            {l.value ? (
                              <View style={styles.accountRow}>
                                <ThemedText type="small" themeColor="textSecondary">
                                  Value in hand
                                </ThemedText>
                                <ThemedText type="small" style={{ fontWeight: '700', color: ORANGE }}>
                                  {rupees(l.value)}
                                </ThemedText>
                              </View>
                            ) : null}
                            <Pressable
                              onPress={() => {
                                setProduct(product && keyOf(product.product, product.variant) === k ? null : l);
                              }}
                              style={styles.productLedgerBtn}>
                              <Ionicons name="list" size={14} color={ORANGE} />
                              <ThemedText type="small" style={{ color: ORANGE, fontWeight: '700' }}>
                                {product && keyOf(product.product, product.variant) === k
                                  ? 'Show all products in the ledger'
                                  : 'Show only this product in the ledger'}
                              </ThemedText>
                            </Pressable>
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })
                )}

                {/* ---------- Ledger ---------- */}
                <View style={[styles.sectionRow, { marginTop: Spacing.four }]}>
                  <ThemedText type="smallBold" style={{ flex: 1 }}>
                    Ledger
                  </ThemedText>
                  <View style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
                    {RANGES.map((r) => (
                      <Pressable
                        key={r}
                        onPress={() => {
                          setRange(r);
                          setLoading(true);
                        }}
                        style={[styles.segmentBtn, range === r && { backgroundColor: ORANGE }]}>
                        <ThemedText type="small" style={{ fontSize: 11, fontWeight: '700', color: range === r ? '#fff' : theme.textSecondary }}>
                          {r}d
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {product ? (
                    <Pressable onPress={() => setProduct(null)} style={[styles.chip, { backgroundColor: ORANGE, borderColor: ORANGE }]}>
                      <ThemedText type="small" style={{ color: '#fff', fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                        {product.name}
                        {product.unit ? ` · ${product.unit}` : ''}
                      </ThemedText>
                      <Ionicons name="close" size={14} color="#fff" />
                    </Pressable>
                  ) : null}
                  {FILTERS.map((f) => {
                    const on = filter === f.key;
                    return (
                      <Pressable
                        key={f.key}
                        onPress={() => setFilter(f.key)}
                        style={[
                          styles.chip,
                          { borderColor: on ? ORANGE : theme.backgroundSelected, backgroundColor: on ? Brand.primarySurface : 'transparent' },
                        ]}>
                        <ThemedText type="small" style={{ fontSize: 12, fontWeight: '700', color: on ? Brand.primaryDark : theme.textSecondary }}>
                          {f.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {days.length === 0 ? (
                  <ThemedView type="card" style={[styles.card, { alignItems: 'center', gap: Spacing.two }]}>
                    <Ionicons name="file-tray-outline" size={30} color={theme.textSecondary} />
                    <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                      No {filter === 'all' ? 'stock movement' : FILTERS.find((f) => f.key === filter)?.label.toLowerCase() + ' entries'}
                      {product ? ` for ${product.name}` : ''} in the last {range} days.
                    </ThemedText>
                  </ThemedView>
                ) : null}

                {days.map((d) => {
                  const received = d.entries.filter((e) => e.kind === 'issue' || e.kind === 'opening').reduce((n, e) => n + e.qty, 0);
                  const sold = d.entries.filter((e) => e.kind === 'sale').reduce((n, e) => n - e.qty, 0);
                  const amount = d.entries.filter((e) => e.kind === 'sale').reduce((n, e) => n + (e.amount || 0), 0);
                  return (
                    <View key={d.day} style={{ marginBottom: Spacing.three }}>
                      <View style={styles.dayHead}>
                        <View style={styles.dayDot} />
                        <ThemedText type="smallBold" style={{ flex: 1 }}>
                          {dayTitle(d.day)}
                        </ThemedText>
                        {received ? (
                          <View style={[styles.dayChip, { backgroundColor: Brand.secondarySurface }]}>
                            <ThemedText type="small" style={[styles.dayChipText, { color: GREEN }]}>
                              +{n2(received)} in
                            </ThemedText>
                          </View>
                        ) : null}
                        {sold ? (
                          <View style={[styles.dayChip, { backgroundColor: Brand.dangerSurface }]}>
                            <ThemedText type="small" style={[styles.dayChipText, { color: Brand.danger }]}>
                              {n2(sold)} sold{amount ? ` · ${rupees(amount)}` : ''}
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>

                      <View style={[styles.card, card, { paddingVertical: Spacing.one }]}>
                        {d.entries.map((e, i) => {
                          const k = KIND[e.kind];
                          return (
                            <View
                              key={i}
                              style={[
                                styles.entry,
                                i > 0 && { borderTopColor: theme.backgroundSelected, borderTopWidth: StyleSheet.hairlineWidth },
                              ]}>
                              <View style={[styles.entryIcon, { backgroundColor: k.bg }]}>
                                <Ionicons name={k.icon} size={16} color={k.tint} />
                              </View>
                              <View style={{ flex: 1, gap: 2 }}>
                                <ThemedText type="smallBold" numberOfLines={1}>
                                  {e.name}
                                  {e.unit ? <ThemedText type="small" themeColor="textSecondary">{` · ${e.unit}`}</ThemedText> : null}
                                </ThemedText>
                                <ThemedText type="small" style={{ fontSize: 11, color: k.tint, fontWeight: '700' }}>
                                  {k.label} · {time(e.at)}
                                </ThemedText>

                                {e.kind === 'sale' ? (
                                  <>
                                    {e.buyer ? (
                                      <View style={styles.meta}>
                                        <Ionicons name={e.buyerKind === 'fpo' ? 'people-outline' : 'person-outline'} size={12} color={theme.textSecondary} />
                                        <ThemedText type="small" themeColor="textSecondary" style={styles.metaText} numberOfLines={1}>
                                          {e.buyer}
                                          {e.buyerKind === 'fpo' ? ' (FPO)' : ''}
                                        </ThemedText>
                                      </View>
                                    ) : null}
                                    {e.invoiceNo ? (
                                      <View style={styles.meta}>
                                        <Ionicons name="receipt-outline" size={12} color={theme.textSecondary} />
                                        <ThemedText type="small" themeColor="textSecondary" style={styles.metaText}>
                                          Bill {e.invoiceNo}
                                        </ThemedText>
                                      </View>
                                    ) : null}
                                    {e.amount ? (
                                      <View style={styles.meta}>
                                        <Ionicons name="cash-outline" size={12} color={GREEN} />
                                        <ThemedText type="small" style={[styles.metaText, { color: GREEN, fontWeight: '700' }]}>
                                          {rupees(e.amount)}
                                          {e.unitPrice ? (
                                            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11, fontWeight: '400' }}>
                                              {`  (${n2(-e.qty)} × ${rupees(e.unitPrice)})`}
                                            </ThemedText>
                                          ) : null}
                                        </ThemedText>
                                      </View>
                                    ) : null}
                                    {/* Older servers sent the buyer and bill in one note. */}
                                    {!e.buyer && !e.invoiceNo && e.note ? (
                                      <ThemedText type="small" themeColor="textSecondary" style={styles.metaText} numberOfLines={2}>
                                        {e.note}
                                      </ThemedText>
                                    ) : null}
                                  </>
                                ) : (
                                  <>
                                    {e.note ? (
                                      <View style={styles.meta}>
                                        <Ionicons name="chatbubble-ellipses-outline" size={12} color={theme.textSecondary} />
                                        <ThemedText type="small" themeColor="textSecondary" style={styles.metaText} numberOfLines={3}>
                                          {e.note}
                                        </ThemedText>
                                      </View>
                                    ) : null}
                                    {e.byName || e.by ? (
                                      <View style={styles.meta}>
                                        <Ionicons name="business-outline" size={12} color={theme.textSecondary} />
                                        <ThemedText type="small" themeColor="textSecondary" style={styles.metaText}>
                                          By {e.byName || e.by}
                                        </ThemedText>
                                      </View>
                                    ) : null}
                                  </>
                                )}
                              </View>
                              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                                <ThemedText type="smallBold" style={{ fontSize: 17, color: e.qty < 0 ? Brand.danger : GREEN }}>
                                  {fmtQty(e.qty)}
                                </ThemedText>
                                <View style={[styles.balance, { backgroundColor: theme.backgroundElement }]}>
                                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 10 }}>
                                    left <ThemedText type="small" style={{ fontSize: 10, fontWeight: '800' }}>{n2(e.balance)}</ThemedText>
                                  </ThemedText>
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  card: { borderRadius: Radius.lg, padding: Spacing.three },

  hero: { backgroundColor: ORANGE, borderRadius: Radius.xl, padding: Spacing.four, marginBottom: Spacing.two },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start' },
  heroLabel: { color: '#ffffffcc', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  heroValue: { color: '#fff', fontSize: 34, fontWeight: '800', lineHeight: 40 },
  heroUnit: { color: '#ffffffcc', fontSize: 15, fontWeight: '600' },
  heroSub: { color: '#ffffffdd', fontSize: 12 },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#ffffff2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStats: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  heroStat: { flex: 1, backgroundColor: '#ffffff26', borderRadius: Radius.md, padding: Spacing.two, gap: 2 },
  heroBar: { height: 6, borderRadius: 3, backgroundColor: '#ffffff40', overflow: 'hidden' },
  heroBarFill: { height: 6, borderRadius: 3, backgroundColor: '#fff' },

  sectionRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.three, marginBottom: Spacing.two },
  productCard: { borderRadius: Radius.lg, padding: Spacing.three, marginBottom: Spacing.two },
  productHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  productIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: GREEN },
  barLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  account: { marginTop: Spacing.three, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  accountRow: { flexDirection: 'row', justifyContent: 'space-between' },
  productLedgerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.two },

  segment: { flexDirection: 'row', borderRadius: Radius.pill, padding: 3, gap: 2 },
  segmentBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.pill },
  chips: { gap: Spacing.two, paddingBottom: Spacing.three },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 220,
  },

  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.two },
  dayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  dayChip: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  dayChipText: { fontSize: 11, fontWeight: '700' },
  entry: { flexDirection: 'row', gap: Spacing.three, paddingVertical: Spacing.three },
  entryIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, flexShrink: 1 },
  balance: { borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
});
