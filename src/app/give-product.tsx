import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  // Core Image, not expo-image: expo-image does not reliably paint a local
  // file:// preview straight off the camera, which left the slots blank.
  Image as RNImage,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraCapture } from '@/components/camera-capture';
import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { api, Crop, Product, ProductSale } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

type Step = 'pick' | 'confirm';

/**
 * productId → what the agronomist is giving. Prices start at the catalog price,
 * and each product carries its own before-photo of the crop. The matching
 * after-photo is taken on a follow-up visit a week later, from the farmer's page.
 */
type Line = { qty: number; price: string; before: string | null };

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** GST on farm inputs: 5% in total, split evenly between CGST and SGST. */
const GST_RATE = 0.05;
const HALF_GST = 0.025;

/**
 * The tax already inside a price.
 *
 * The price on a product is what the farmer pays — the figure agreed out loud
 * on the farm — so the split works backwards out of it rather than adding to
 * it. Charging 2.5% of the inclusive price instead would collect slightly too
 * much and leave the total no longer matching what was quoted.
 *
 * SGST is taken as the remainder, not calculated again, so the three parts
 * always add back to the total instead of drifting a paisa on rounding.
 */
function gstSplit(total: number) {
  const round = (n: number) => Math.round(n * 100) / 100;
  const taxable = round(total / (1 + GST_RATE));
  const cgst = round(taxable * HALF_GST);
  return { taxable, cgst, sgst: round(total - taxable - cgst) };
}

/** Rough, and deliberately so: "3 months ago" is what an agent needs, not a date. */
function since(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

/** Must match AFTER_PHOTO_DAYS in the backend's productSale controller. */
const AFTER_PHOTO_DAYS = 7;

/** Camera frames are 12 MP+; send something a field connection can carry. */
async function shrink(uri: string) {
  try {
    const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
      compress: 0.6,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return out.uri;
  } catch {
    return uri; // never lose the shot because the resize failed
  }
}

/**
 * Agronomist sells products to a farmer out on the farm.
 *
 * Two steps, quick-commerce style: build a basket from the product grid, then
 * confirm quantities and prices and photograph the crop before and after.
 */
export default function GiveProductScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const params = useLocalSearchParams<{ farmerId?: string; farmerName?: string }>();
  const farmerId = params.farmerId ?? '';

  // Two per row, inside the screen's horizontal padding.
  const cardW = (width - Spacing.four * 2 - Spacing.three) / 2;

  const [crops, setCrops] = useState<Crop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [past, setPast] = useState<ProductSale[]>([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>('pick');
  const [cropId, setCropId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [notes, setNotes] = useState('');
  // Which product we are photographing.
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const confirmScrollRef = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight();
  const [notesFocused, setNotesFocused] = useState(false);

  // Scroll once the keyboard's height has actually been added to the content —
  // scrolling on focus alone races the padding and lands short.
  useEffect(() => {
    if (notesFocused && keyboardHeight > 0) confirmScrollRef.current?.scrollToEnd({ animated: true });
  }, [notesFocused, keyboardHeight]);
  const [error, setError] = useState<string | null>(null);

  const crop = crops.find((c) => c._id === cropId) ?? null;

  useEffect(() => {
    if (!farmerId) return;
    (async () => {
      try {
        const [cropList, productList, saleList] = await Promise.all([
          api.listCrops(farmerId),
          api.listProducts(),
          // History is context, not a prerequisite: never block the sale on it.
          api.listProductSales({ farmerId }).catch(() => [] as ProductSale[]),
        ]);
        setCrops(cropList);
        setProducts(productList);
        setPast(saleList);
        // One crop means there is nothing to choose — pick it for them.
        if (cropList.length === 1) setCropId(cropList[0]._id);
      } catch (e: any) {
        setError(e?.message || 'Could not load this farmer’s crops and products.');
      } finally {
        setLoading(false);
      }
    })();
  }, [farmerId]);

  // Stamp where the sale happened. Best-effort: a missing fix must not block it.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({});
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // no location — the sale is still valid
      }
    })();
  }, []);

  // Products for the chosen crop plus the general ones, narrowed by the search
  // box. Mirrors the backend's `?crop=` filter, done here so switching crop or
  // typing costs no request.
  const shown = useMemo(() => {
    const name = crop?.name.toLowerCase();
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (name && p.crops?.length && !p.crops.some((c) => c.toLowerCase() === name)) return false;
      if (q && !`${p.name} ${p.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, crop, query]);

  /**
   * What this farmer has already been given, newest first, one entry per
   * product rather than one per sale — an agent about to hand something over
   * needs "has he had this before, and how long ago", not a ledger. Repeats are
   * counted instead of repeated, since a product given four times is the single
   * most useful thing on the strip.
   */
  const givenBefore = useMemo(() => {
    const byProduct = new Map<
      string,
      { name: string; unit: string; imageUrl: string; qty: number; at: string; times: number }
    >();
    const newestFirst = [...past].sort(
      (a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime()
    );
    for (const sale of newestFirst) {
      for (const it of sale.items) {
        const seen = byProduct.get(it.product);
        // First time through is the most recent, so later ones only count.
        if (seen) seen.times += 1;
        else
          byProduct.set(it.product, {
            name: it.name,
            unit: it.unit,
            imageUrl: it.imageUrl,
            qty: it.qty,
            at: sale.soldAt,
            times: 1,
          });
      }
    }
    return [...byProduct.entries()].map(([id, v]) => ({ id, ...v }));
  }, [past]);

  const inCart = products.filter((p) => cart[p._id]);
  const itemCount = inCart.reduce((s, p) => s + cart[p._id].qty, 0);
  const total = inCart.reduce((s, p) => s + cart[p._id].qty * (Number(cart[p._id].price) || 0), 0);

  /**
   * The price on a product is what the farmer pays, tax included — it is the
   * figure agreed out loud on the farm, and it must not move because a tax
   * line was added underneath it.
   *
   * So the split works backwards out of that: the taxable value is the price
   * with GST taken off, and CGST and SGST are 2.5% of THAT each. Charging 2.5%
   * of the inclusive price instead would collect slightly too much and leave
   * the total no longer matching what was quoted.
   *
   *   taxable = total / 1.05      CGST = SGST = taxable x 2.5%
   *   taxable + CGST + SGST = total, to the paisa
   */
  const tax = useMemo(() => gstSplit(total), [total]);

  const add = (p: Product) =>
    setCart((c) => ({ ...c, [p._id]: { qty: 1, price: String(p.price ?? 0), before: null } }));

  const setQty = (p: Product, qty: number) =>
    setCart((c) => {
      if (qty <= 0) {
        const { [p._id]: _drop, ...rest } = c;
        return rest;
      }
      return { ...c, [p._id]: { ...c[p._id], qty } };
    });

  const setPrice = (id: string, price: string) =>
    setCart((c) => ({ ...c, [id]: { ...c[id], price } }));

  /**
   * Store the camera's own URI and show it immediately. Resizing happens at
   * upload time instead: putting the manipulator in the display path meant the
   * preview depended on it succeeding, and a slow or failed convert showed the
   * agronomist an empty slot with no way to tell whether the shot was taken.
   */
  const handleCapture = (uri: string) => {
    if (!cameraFor) return;
    const productId = cameraFor;
    setCart((c) => (c[productId] ? { ...c, [productId]: { ...c[productId], before: uri } } : c));
    setCameraFor(null);
  };

  // Every product needs its before-shot before the sale can be recorded.
  const missingPhotos = inCart.filter((p) => !cart[p._id].before);

  const save = async () => {
    if (!user || !farmerId) return;
    if (inCart.length === 0) {
      setError('Add at least one product.');
      return;
    }
    if (inCart.some((p) => Number(cart[p._id].price) < 0 || Number.isNaN(Number(cart[p._id].price)))) {
      setError('Check the prices — they must be numbers and cannot be negative.');
      return;
    }
    if (missingPhotos.length) {
      setError(`Take a before photo for ${missingPhotos.map((p) => p.name).join(', ')}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Shrink here rather than at capture time: a dozen full-resolution frames
      // would make this upload enormous, but the preview must never wait on it.
      const items = await Promise.all(
        inCart.map(async (p, i) => ({
          productId: p._id,
          qty: cart[p._id].qty,
          unitPrice: Number(cart[p._id].price) || 0,
          beforePhoto: { uri: await shrink(cart[p._id].before!), name: `before_${i}.jpg`, type: 'image/jpeg' },
        }))
      );
      await api.createProductSale({
        agronomistId: user._id,
        farmerId,
        cropId,
        items,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        notes: notes.trim(),
      });
      posthog?.capture('product_sold_on_field', {
        crop: crop?.name ?? '',
        product_count: inCart.length,
        item_count: itemCount,
        total,
        has_location: !!coords,
      });
      Alert.alert('Sale recorded ✓', `${inCart.length} product(s) · ${money(total)}`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      setError(e?.message || 'Could not record the sale.');
    } finally {
      setSaving(false);
    }
  };

  // A render helper (not a component) so state updates don't remount it.
  const photoSlot = (productId: string, uri: string | null) => (
    <View style={{ flex: 1 }}>
      <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.one }}>
        Before photo
      </ThemedText>
      {uri ? (
        <Pressable onPress={() => setCameraFor(productId)}>
          {/* The image sizes itself — no fixed-height parent with overflow:hidden,
              which was clipping away everything inside it. */}
          <RNImage source={{ uri }} style={styles.photo} resizeMode="cover" />
          <View style={styles.retake}>
            <Ionicons name="camera-reverse" size={14} color="#fff" />
            <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
              Retake
            </ThemedText>
          </View>
        </Pressable>
      ) : (
        <Pressable onPress={() => setCameraFor(productId)} style={[styles.photoBtn, { borderColor: GREEN }]}>
          <Ionicons name="camera-outline" size={22} color={GREEN} />
          <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
            Take before photo
          </ThemedText>
        </Pressable>
      )}
    </View>
  );

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.topBar}>
            <Pressable
              onPress={() => (step === 'confirm' ? setStep('pick') : router.back())}
              hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">
              {step === 'pick' ? 'Give product' : 'Confirm sale'}
            </ThemedText>
            <View style={{ width: 26 }} />
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.text} />
          ) : step === 'pick' ? (
            <>
              <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <ThemedText type="small" themeColor="textSecondary">
                  Selling to {params.farmerName || 'this farmer'}
                </ThemedText>

                {/* Which crop it is for — decides which products are offered. */}
                {crops.length > 0 && (
                  <View style={styles.chipWrap}>
                    {crops.map((c) => {
                      const on = cropId === c._id;
                      return (
                        <Pressable
                          key={c._id}
                          onPress={() => setCropId(on ? null : c._id)}
                          style={[styles.chip, { backgroundColor: on ? GREEN : theme.backgroundElement }]}>
                          <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                            {c.name}
                            {c.area != null ? ` · ${c.area} ac` : ''}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {/* What he already has. Shown before the catalogue on purpose:
                    the question "has he had this already" comes before the
                    question "what shall I give him". */}
                {givenBefore.length > 0 && (
                  <View style={{ marginTop: Spacing.four }}>
                    <ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '700' }}>
                      Given before
                    </ThemedText>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginTop: Spacing.two }}>
                      <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                        {givenBefore.map((g) => (
                          <View
                            key={g.id}
                            style={[styles.pastCard, { backgroundColor: theme.backgroundElement }]}>
                            <View style={styles.pastTop}>
                              {g.imageUrl ? (
                                <TappablePhoto uri={g.imageUrl} style={styles.pastImg} caption={g.name} />
                              ) : (
                                <View style={[styles.pastImg, styles.pastImgEmpty]}>
                                  <Ionicons name="cube-outline" size={16} color={theme.textSecondary} />
                                </View>
                              )}
                              {/* Four times means something the one-off count cannot say. */}
                              {g.times > 1 && (
                                <View style={styles.pastTimes}>
                                  <ThemedText type="small" style={styles.pastTimesText}>
                                    ×{g.times}
                                  </ThemedText>
                                </View>
                              )}
                            </View>
                            <ThemedText type="small" numberOfLines={2} style={styles.pastName}>
                              {g.name}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" style={styles.pastMeta}>
                              {g.qty}
                              {g.unit ? ` ${g.unit}` : ''} · {since(g.at)}
                            </ThemedText>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="search" size={18} color={theme.textSecondary} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search products"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.searchInput, { color: theme.text }]}
                  />
                  {query ? (
                    <Pressable onPress={() => setQuery('')} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                    </Pressable>
                  ) : null}
                </View>

                {shown.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.four }}>
                    {query ? `No products match “${query}”.` : 'No products available for this crop.'}
                  </ThemedText>
                ) : (
                  <View style={styles.grid}>
                    {shown.map((p) => {
                      const line = cart[p._id];
                      return (
                        <View
                          key={p._id}
                          style={[styles.card, { width: cardW, backgroundColor: theme.backgroundElement }]}>
                          {p.imageUrl ? (
                            <Image source={{ uri: p.imageUrl }} style={styles.cardImg} contentFit="cover" />
                          ) : (
                            <View style={[styles.cardImg, styles.cardImgFallback]}>
                              <Ionicons name="cube-outline" size={28} color={GREEN} />
                            </View>
                          )}
                          <ThemedText type="smallBold" numberOfLines={2} style={styles.cardName}>
                            {p.name}
                          </ThemedText>
                          {p.unit ? (
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                              {p.unit}
                            </ThemedText>
                          ) : null}
                          <View style={styles.cardBottom}>
                            <ThemedText type="smallBold">{money(p.price ?? 0)}</ThemedText>
                            {line ? (
                              <View style={[styles.stepper, { borderColor: GREEN }]}>
                                <Pressable onPress={() => setQty(p, line.qty - 1)} hitSlop={6} style={styles.stepBtn}>
                                  <Ionicons name="remove" size={16} color={GREEN} />
                                </Pressable>
                                <ThemedText type="smallBold" style={{ color: GREEN, minWidth: 18, textAlign: 'center' }}>
                                  {line.qty}
                                </ThemedText>
                                <Pressable onPress={() => setQty(p, line.qty + 1)} hitSlop={6} style={styles.stepBtn}>
                                  <Ionicons name="add" size={16} color={GREEN} />
                                </Pressable>
                              </View>
                            ) : (
                              <Pressable onPress={() => add(p)} style={[styles.addBtn, { borderColor: GREEN }]}>
                                <ThemedText type="small" style={{ color: GREEN, fontWeight: '800' }}>
                                  ADD
                                </ThemedText>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </ScrollView>

              {/* Sticky basket bar — the way out of this step. */}
              {inCart.length > 0 && (
                <SafeAreaView edges={['bottom']} style={{ backgroundColor: GREEN }}>
                  <Pressable onPress={() => setStep('confirm')} style={styles.cartBar}>
                    <View>
                      <ThemedText type="smallBold" style={{ color: '#fff' }}>
                        {inCart.length} product{inCart.length > 1 ? 's' : ''} · {itemCount} item
                        {itemCount > 1 ? 's' : ''}
                      </ThemedText>
                      <ThemedText type="small" style={{ color: '#fff', opacity: 0.9 }}>
                        {money(total)}
                      </ThemedText>
                    </View>
                    <View style={styles.cartCta}>
                      <ThemedText type="smallBold" style={{ color: '#fff' }}>
                        Continue
                      </ThemedText>
                      <Ionicons name="arrow-forward" size={18} color="#fff" />
                    </View>
                  </Pressable>
                </SafeAreaView>
              )}
            </>
          ) : (
            <ScrollView
              ref={confirmScrollRef}
              // The keyboard draws over the screen rather than resizing it, so the
              // space it takes has to be added to the content for the last fields
              // to be reachable at all.
              contentContainerStyle={[styles.body, { paddingBottom: Spacing.six + keyboardHeight }]}
              keyboardShouldPersistTaps="handled">
              {/* One card per product: quantity, the price agreed on the field, and
                  its own before/after proof of the crop. */}
              <View style={styles.confirmHead}>
                <ThemedText type="smallBold">Basket ({inCart.length})</ThemedText>
                <ThemedText
                  type="small"
                  style={{ color: missingPhotos.length ? Brand.accent : GREEN, fontWeight: '700' }}>
                  Photos {inCart.length - missingPhotos.length}/{inCart.length}
                </ThemedText>
              </View>

              {inCart.map((p) => {
                const line = cart[p._id];
                const done = !!line.before;
                return (
                  <View key={p._id} style={[styles.lineCard, { backgroundColor: theme.backgroundElement }]}>
                    <View style={styles.lineRow}>
                      {p.imageUrl ? (
                        <Image source={{ uri: p.imageUrl }} style={styles.lineImg} contentFit="cover" />
                      ) : (
                        <View style={[styles.lineImg, styles.cardImgFallback]}>
                          <Ionicons name="cube-outline" size={18} color={GREEN} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={styles.lineTitle}>
                          <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                            {p.name}
                          </ThemedText>
                          <Ionicons
                            name={done ? 'checkmark-circle' : 'alert-circle-outline'}
                            size={18}
                            color={done ? GREEN : Brand.accent}
                          />
                        </View>
                        <View style={styles.lineControls}>
                          <View style={[styles.stepper, { borderColor: GREEN }]}>
                            <Pressable onPress={() => setQty(p, line.qty - 1)} hitSlop={6} style={styles.stepBtn}>
                              <Ionicons name="remove" size={16} color={GREEN} />
                            </Pressable>
                            <ThemedText type="smallBold" style={{ color: GREEN, minWidth: 18, textAlign: 'center' }}>
                              {line.qty}
                            </ThemedText>
                            <Pressable onPress={() => setQty(p, line.qty + 1)} hitSlop={6} style={styles.stepBtn}>
                              <Ionicons name="add" size={16} color={GREEN} />
                            </Pressable>
                          </View>
                          <ThemedText type="small" themeColor="textSecondary">
                            ×
                          </ThemedText>
                          <TextInput
                            value={line.price}
                            onChangeText={(v) => setPrice(p._id, v)}
                            keyboardType="decimal-pad"
                            style={[styles.priceInput, { color: theme.text, backgroundColor: theme.background }]}
                          />
                          {/* The taxable value, not the price typed beside it.
                              Lines are ex-tax and the tax is added once at the
                              bottom, the way a GST invoice reads — so this
                              figure will not equal qty x price, and the
                              summary below is where they meet again. */}
                          <ThemedText type="smallBold" style={{ marginLeft: 'auto' }}>
                            {money(gstSplit(line.qty * (Number(line.price) || 0)).taxable)}
                          </ThemedText>
                        </View>
                      </View>
                    </View>

                    <View style={styles.photoRow}>{photoSlot(p._id, line.before)}</View>
                  </View>
                );
              })}

              {/* The tax taken out of the agreed price, then added back — so
                  the farmer can see what they are paying tax on, and the last
                  line is still the number they were quoted. */}
              <View style={[styles.taxBox, { backgroundColor: theme.backgroundElement }]}>
                {[
                  { label: 'Taxable value', value: tax.taxable },
                  { label: 'CGST 2.5%', value: tax.cgst },
                  { label: 'SGST 2.5%', value: tax.sgst },
                ].map((r) => (
                  <View key={r.label} style={styles.taxRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {r.label}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {money(r.value)}
                    </ThemedText>
                  </View>
                ))}

                <View style={[styles.taxRule, { borderTopColor: theme.textSecondary }]} />

                <View style={styles.taxRow}>
                  <ThemedText type="smallBold">Total</ThemedText>
                  <ThemedText type="smallBold" style={{ fontSize: 18, color: GREEN }}>
                    {money(total)}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary" style={styles.taxNote}>
                  Prices include 5% GST.
                </ThemedText>
              </View>

              {/* The other half of the proof comes later, so say so plainly. */}
              <View style={[styles.followUp, { backgroundColor: Brand.accentSurface }]}>
                <Ionicons name="time-outline" size={18} color={Brand.accent} />
                <ThemedText type="small" style={{ flex: 1, color: theme.text }}>
                  After photos are due in {AFTER_PHOTO_DAYS} days. Come back to this farmer’s page to
                  add them once the product has had time to work.
                </ThemedText>
              </View>

              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                Notes
              </ThemedText>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything worth recording about this sale"
                placeholderTextColor={theme.textSecondary}
                multiline
                onFocus={() => setNotesFocused(true)}
                onBlur={() => setNotesFocused(false)}
                style={[...inputStyle, styles.notes]}
              />

              {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

              <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}>
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Record sale · {money(total)}
                  </ThemedText>
                )}
              </Pressable>

              <Pressable onPress={() => setStep('pick')} style={styles.addMoreBtn}>
                <Ionicons name="add" size={18} color={GREEN} />
                <ThemedText type="smallBold" style={{ color: GREEN }}>
                  Add more products
                </ThemedText>
              </Pressable>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {cameraFor && <CameraCapture onCapture={handleCapture} onClose={() => setCameraFor(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  taxBox: { borderRadius: Spacing.three, padding: Spacing.three, marginTop: Spacing.three },
  taxRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  taxRule: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: Spacing.two, opacity: 0.4 },
  taxNote: { fontSize: 11, marginTop: Spacing.one },
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  fieldLabel: { marginTop: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  notes: { minHeight: 72, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.three },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.three,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.three, fontSize: 15 },
  pastCard: { width: 108, borderRadius: Spacing.three, padding: Spacing.two },
  pastTop: { alignItems: 'center' },
  pastImg: { width: '100%', height: 56, borderRadius: Spacing.two, backgroundColor: '#d8d8d8' },
  pastImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  pastTimes: {
    position: 'absolute',
    top: 3,
    right: 3,
    paddingHorizontal: 5,
    borderRadius: Spacing.five,
    backgroundColor: GREEN,
  },
  pastTimesText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  pastName: { fontWeight: '600', marginTop: Spacing.one, lineHeight: 15 },
  pastMeta: { fontSize: 11 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  card: { borderRadius: Spacing.three, padding: Spacing.two, gap: 2 },
  cardImg: { width: '100%', height: 96, borderRadius: Spacing.two, marginBottom: Spacing.one },
  cardImgFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.primarySurface },
  cardName: { fontSize: 13, lineHeight: 17 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  addBtn: {
    borderWidth: 1.5,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    backgroundColor: Brand.primarySurface,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: Spacing.two,
    backgroundColor: Brand.primarySurface,
  },
  stepBtn: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  cartCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  confirmHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  lineCard: { padding: Spacing.three, borderRadius: Spacing.three, marginTop: Spacing.two },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  lineTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  lineImg: { width: 44, height: 44, borderRadius: Spacing.two },
  lineControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  priceInput: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    minWidth: 64,
    textAlign: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.three,
  },
  followUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.three,
  },
  photoRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  photoBtn: {
    height: 104,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  photo: {
    width: '100%',
    height: 104,
    borderRadius: Spacing.three,
    backgroundColor: '#d8d8d8', // shows through only while the file is decoding
  },
  retake: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderBottomLeftRadius: Spacing.three,
    borderBottomRightRadius: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  error: { color: Brand.danger, marginTop: Spacing.two },
  saveBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    marginTop: Spacing.two,
  },
});
