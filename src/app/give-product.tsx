import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  // Core Image, not expo-image: expo-image does not reliably paint a local
  // file:// preview straight off the camera, which left the slots blank.
  Image as RNImage,
  KeyboardAvoidingView,
  Modal,
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
type Line = {
  qty: number;
  price: string;
  /**
   * A discount on this product, as typed. Kept as a string so the field can be
   * empty while being edited rather than snapping to 0 on every keystroke.
   */
  discount: string;
  discountType: DiscountType;
  before: string | null;
};

type DiscountType = 'rs' | 'pct';

/**
 * One thing that can go in the basket: a product sold in one size, or ONE size
 * of a product that comes in several. The 500 ml and the 5 L of the same
 * pesticide are two offers, and two lines on the bill.
 *
 * Shaped like a Product on purpose — `_id`, `name`, `unit`, `price`,
 * `imageUrl` — so the basket, the photo slots and the totals read an offer
 * exactly as they used to read a product. `unit` carries the size's label,
 * which is what the bill prints after the name.
 */
type Offer = {
  _id: string;
  productId: string;
  variantId: string | null;
  name: string;
  unit: string;
  price: number;
  imageUrl: string;
};

const offerId = (productId: string, variantId: string | null | undefined) =>
  variantId ? `${productId}:${variantId}` : productId;

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The chosen day at noon.
 *
 * A day picked from a calendar has no time of its own, and midnight is a bad
 * one to invent: five and a half hours of IST offset either side of it is
 * enough to file the sale on the day before or the day after, depending on
 * whose clock reads it. Midday is far from both edges.
 */
const atMidday = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);

const dayLabel = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** GST on farm inputs: 5% in total, split evenly between CGST and SGST. */
const GST_RATE = 0.05;
/**
 * GST on courier and packaging: 18%. A different supply from the products it
 * travels with, taxed at its own rate, so the bill carries it as its own
 * group rather than folding it into the 5% line.
 */
const CHARGES_GST_RATE = 0.18;

/**
 * The tax already inside a price, at a given rate.
 *
 * The price on a product is what the farmer pays — the figure agreed out loud
 * on the farm — so the split works backwards out of it rather than adding to
 * it. Charging 2.5% of the inclusive price instead would collect slightly too
 * much and leave the total no longer matching what was quoted.
 *
 * SGST is taken as the remainder, not calculated again, so the three parts
 * always add back to the total instead of drifting a paisa on rounding.
 */
function gstSplit(total: number, rate: number = GST_RATE) {
  const round = (n: number) => Math.round(n * 100) / 100;
  const taxable = round(total / (1 + rate));
  const cgst = round(taxable * (rate / 2));
  return { taxable, cgst, sgst: round(total - taxable - cgst) };
}

/**
 * What one line comes to, discount included.
 *
 * Capped at the line: a discount bigger than the product being sold would make
 * the line negative and quietly take money off the rest of the basket. The
 * server caps it the same way and recomputes from scratch, so this is what the
 * agronomist sees rather than what anyone is charged on.
 */
function lineMath(line: Line) {
  const round = (n: number) => Math.round(n * 100) / 100;
  const gross = round(line.qty * (Number(line.price) || 0));
  const entered = Math.max(0, Number(line.discount) || 0);
  const off = Math.min(
    gross,
    round(line.discountType === 'pct' ? (gross * Math.min(entered, 100)) / 100 : entered)
  );
  return { gross, off, net: round(gross - off) };
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
  const { width, height } = useWindowDimensions();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const params = useLocalSearchParams<{
    farmerId?: string;
    farmerName?: string;
    fpoId?: string;
    fpoName?: string;
    /** The FPO's crop names, comma-separated. It has no Crop records. */
    fpoCrops?: string;
    /**
     * '1' when an old sale is being written up after the fact, reached from
     * Products given rather than from the buyer's own page.
     */
    backdate?: string;
  }>();
  const farmerId = params.farmerId ?? '';
  /**
   * Selling to an FPO instead of a farmer.
   *
   * The whole screen works the same either way, with two differences an FPO
   * forces: it has no Crop records — only the names of crops it deals in — and
   * no single field to photograph, so the proof shots are optional. Everything
   * else, including the bill and the discounts, is identical.
   */
  const fpoId = params.fpoId ?? '';
  const toFpo = !!fpoId;
  const buyerId = fpoId || farmerId;
  const buyerName = (toFpo ? params.fpoName : params.farmerName) || (toFpo ? 'this FPO' : 'this farmer');
  /** An FPO's crops are names, chosen from what it deals in. */
  const fpoCropNames = (params.fpoCrops ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const [cropName, setCropName] = useState<string | null>(null);

  /**
   * Writing up a sale that already happened.
   *
   * Two things change, and nothing else: the day has to be asked for rather
   * than taken from the clock, and the before-photos stop being required. The
   * crop was handed over weeks ago; there is nothing left to photograph, and
   * demanding a shot would either block the record or invite a fake one.
   */
  const backdating = params.backdate === '1';
  const [soldAt, setSoldAt] = useState<Date | null>(null);
  const [datePicker, setDatePicker] = useState(false);

  // Two per row, inside the screen's horizontal padding.
  const cardW = (width - Spacing.four * 2 - Spacing.three) / 2;

  const [crops, setCrops] = useState<Crop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  /**
   * The product whose detail sheet is open — what it is, what it is for, and
   * every size with its price on one screen. The card is deliberately small;
   * this is where someone goes to actually read about it.
   */
  const [detailFor, setDetailFor] = useState<Product | null>(null);
  const [past, setPast] = useState<ProductSale[]>([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>('pick');
  const [cropId, setCropId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [notes, setNotes] = useState('');
  // Which product we are photographing.
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  /**
   * A discount on the basket as a whole. Kept apart from the per-product ones
   * because it is agreed as one thing — "call it two thousand" — and splitting
   * it across the products would invent per-product prices nobody said.
   */
  const [saleDiscount, setSaleDiscount] = useState('');
  const [saleDiscountType, setSaleDiscountType] = useState<DiscountType>('rs');
  /** Courier / packaging / other charges, as typed. Rupees, GST-inclusive. */
  const [otherCharges, setOtherCharges] = useState('');
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

  /** Every product flattened to its sellable sizes. */
  const offers = useMemo<Offer[]>(
    () =>
      products.flatMap((p): Offer[] =>
        p.variants && p.variants.length > 0
          ? p.variants.map((v) => ({
              _id: offerId(p._id, v._id),
              productId: p._id,
              variantId: v._id,
              name: p.name,
              unit: v.label,
              price: v.price,
              imageUrl: p.imageUrl,
            }))
          : [
              {
                _id: p._id,
                productId: p._id,
                variantId: null,
                name: p.name,
                unit: p.unit,
                price: p.price ?? 0,
                imageUrl: p.imageUrl,
              },
            ]
      ),
    [products]
  );

  useEffect(() => {
    if (!buyerId) return;
    (async () => {
      try {
        const [cropList, productList, saleList] = await Promise.all([
          // An FPO has no Crop records — its crops are names on the FPO itself.
          toFpo ? Promise.resolve([] as Crop[]) : api.listCrops(farmerId),
          api.listProducts(),
          // History is context, not a prerequisite: never block the sale on it.
          api
            .listProductSales(toFpo ? { fpoId } : { farmerId })
            .catch(() => [] as ProductSale[]),
        ]);
        setCrops(cropList);
        setProducts(productList);
        setPast(saleList);
        // One crop means there is nothing to choose — pick it for them.
        if (cropList.length === 1) setCropId(cropList[0]._id);
        if (toFpo && fpoCropNames.length === 1) setCropName(fpoCropNames[0]);
      } catch (e: any) {
        setError(e?.message || 'Could not load the crops and products.');
      } finally {
        setLoading(false);
      }
    })();
  }, [buyerId]);

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
        // The 1 L and the 5 L of one product are two different things to have
        // been given, so the size is part of the key.
        const key = offerId(it.product, it.variant);
        const seen = byProduct.get(key);
        // First time through is the most recent, so later ones only count.
        if (seen) seen.times += 1;
        else
          byProduct.set(key, {
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

  const inCart = offers.filter((o) => cart[o._id]);
  const itemCount = inCart.reduce((s, p) => s + cart[p._id].qty, 0);
  /**
   * What the basket comes to once every per-product discount is off, and then
   * what is left after the discount on the basket as a whole.
   *
   * The overall one is taken LAST, so a percentage means a percentage of what
   * is actually still owed. Applying it first would make the same "10% off"
   * quietly worth more here than it is on a product, and the two discounts
   * would compound differently depending on which was typed first. The server
   * recomputes in exactly this order.
   */
  const subtotal = inCart.reduce((s, p) => s + lineMath(cart[p._id]).net, 0);
  const saleOff = useMemo(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const entered = Math.max(0, Number(saleDiscount) || 0);
    return Math.min(
      subtotal,
      round(saleDiscountType === 'pct' ? (subtotal * Math.min(entered, 100)) / 100 : entered)
    );
  }, [subtotal, saleDiscount, saleDiscountType]);
  /**
   * Courier, packaging, whatever else was charged on top of the products. Goes
   * on AFTER the discount, so "10% off" is 10% off the products and never
   * quietly shaves the delivery fee. The server adds it in the same place.
   */
  const charges = Math.max(0, Math.round((Number(otherCharges) || 0) * 100) / 100);
  /** The products alone, after the discount — the 5% side of the bill. */
  const goods = Math.round((subtotal - saleOff) * 100) / 100;
  const total = Math.round((goods + charges) * 100) / 100;
  /**
   * The bill stated the way a GST invoice states it: every line ex-tax, the tax
   * added once at the bottom, and the last figure still the price agreed out
   * loud.
   *
   * `saleOffEx` is derived as the GAP between the two taxable figures rather
   * than by dividing the discount by 1.05 on its own. Both routes give the same
   * answer to the paisa in almost every case, but only this one guarantees that
   * Subtotal − Discount lands exactly on Taxable Value, with no rounding crumb
   * left visible on the screen.
   */
  const subtotalEx = useMemo(() => gstSplit(subtotal).taxable, [subtotal]);

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
  const tax = useMemo(() => gstSplit(goods), [goods]);
  const saleOffEx = Math.round((subtotalEx - tax.taxable) * 100) / 100;
  /**
   * The courier's own split, at 18%. The figure typed is what is charged, tax
   * included, exactly as a product price is — and its ex-tax value is worked
   * back out the same way, only at the courier's rate.
   */
  const chargesTax = useMemo(() => gstSplit(charges, CHARGES_GST_RATE), [charges]);
  const chargesEx = chargesTax.taxable;
  /** Everything the tax was charged on, both rates together. */
  const taxableAll = Math.round((tax.taxable + chargesEx) * 100) / 100;
  const gstAll =
    Math.round((tax.cgst + tax.sgst + chargesTax.cgst + chargesTax.sgst) * 100) / 100;

  const add = (o: Offer) =>
    setCart((c) => ({
      ...c,
      [o._id]: { qty: 1, price: String(o.price ?? 0), discount: '', discountType: 'rs', before: null },
    }));

  const setQty = (p: Offer, qty: number) =>
    setCart((c) => {
      if (qty <= 0) {
        const { [p._id]: _drop, ...rest } = c;
        return rest;
      }
      return { ...c, [p._id]: { ...c[p._id], qty } };
    });

  const setDiscount = (id: string, discount: string) =>
    setCart((c) => ({ ...c, [id]: { ...c[id], discount } }));

  /**
   * Switching between rupees and percent keeps the number typed. Clearing it
   * would be safer arithmetically but reads as the app throwing the entry away,
   * and the figure is re-checked against the line either way.
   */
  const setDiscountType = (id: string, discountType: DiscountType) =>
    setCart((c) => ({ ...c, [id]: { ...c[id], discountType } }));

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

  /**
   * Products still without their before-shot.
   *
   * Required for a farmer, where the photo is the proof the product reached a
   * particular field. Optional for an FPO: it buys in bulk for its members and
   * there is no one crop to point a camera at, so demanding a photo would only
   * teach agents to photograph the floor.
   */
  const missingPhotos = toFpo || backdating ? [] : inCart.filter((p) => !cart[p._id].before);

  const save = async () => {
    if (!user || !buyerId) return;
    if (inCart.length === 0) {
      setError('Add at least one product.');
      return;
    }
    if (inCart.some((p) => Number(cart[p._id].price) < 0 || Number.isNaN(Number(cart[p._id].price)))) {
      setError('Check the prices — they must be numbers and cannot be negative.');
      return;
    }
    if (missingPhotos.length) {
      setError(
        `Take a before photo for ${missingPhotos
          .map((p) => (p.variantId ? `${p.name} ${p.unit}` : p.name))
          .join(', ')}.`
      );
      return;
    }
    // Asked for, never assumed. Defaulting to today would quietly file the
    // backlog on the day it was typed, which is the very thing this is for.
    if (backdating && !soldAt) {
      setError('Pick the day this sale happened.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Shrink here rather than at capture time: a dozen full-resolution frames
      // would make this upload enormous, but the preview must never wait on it.
      const items = await Promise.all(
        inCart.map(async (p, i) => {
          const line = cart[p._id];
          /**
           * The photo is attached only when there is one.
           *
           * A line with no shot used to still build `{ uri: null }`, and React
           * Native's FormData fails at the network layer on a file with no URI
           * — which surfaces as "Network request failed" with no clue that a
           * photo was the cause. Farmer sales always had one, so this only
           * appeared once FPO sales made the photo optional.
           */
          const before = line.before
            ? { uri: await shrink(line.before), name: `before_${i}.jpg`, type: 'image/jpeg' }
            : undefined;
          return {
            productId: p.productId,
            variantId: p.variantId,
            qty: line.qty,
            unitPrice: Number(line.price) || 0,
            discount: Math.max(0, Number(line.discount) || 0),
            discountType: line.discountType,
            ...(before ? { beforePhoto: before } : {}),
          };
        })
      );
      const saved = await api.createProductSale({
        agronomistId: user._id,
        // One buyer, never both — the server rejects a request carrying two.
        ...(toFpo ? { fpoId } : { farmerId }),
        // An FPO has no Crop records to link to, only the crop it was for by
        // name.
        cropId: toFpo ? null : cropId,
        cropName: toFpo ? (cropName ?? undefined) : undefined,
        items,
        discount: Math.max(0, Number(saleDiscount) || 0),
        discountType: saleDiscountType,
        otherCharges: charges,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        notes: notes.trim(),
        // A full instant at local midday, not a bare date: read as UTC it
        // would still land on the right day in IST, where a bare midnight
        // would not.
        soldAt: soldAt ? atMidday(soldAt).toISOString() : undefined,
      });
      posthog?.capture('product_sold_on_field', {
        crop: crop?.name ?? '',
        product_count: inCart.length,
        item_count: itemCount,
        total,
        has_location: !!coords,
      });
      // Offered here because this is the moment the farmer is still standing
      // there — the bill is also on their page afterwards, but handing it over
      // now is what it is for.
      Alert.alert('Sale recorded ✓', `${inCart.length} product(s) · ${money(total)}`, [
        {
          text: 'Download bill',
          onPress: () => {
            Linking.openURL(api.saleInvoicePdfUrl(saved._id)).catch(() => {});
            router.back();
          },
        },
        { text: 'Done', onPress: () => router.back() },
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
        Before photo{toFpo ? ' (optional)' : ''}
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

  /**
   * The day an old sale happened, asked for on both steps.
   *
   * Rendered twice on purpose: it is the one thing about this record that is
   * not obvious from the screen, and an agent who scrolls past it while
   * picking products should meet it again before saving.
   */
  const dateRow = backdating ? (
    <View style={{ gap: Spacing.two }}>
      <Pressable
        onPress={() => setDatePicker(true)}
        style={[
          styles.dateRow,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: soldAt ? GREEN : Brand.accent,
          },
        ]}>
        <Ionicons name="calendar-outline" size={18} color={soldAt ? GREEN : Brand.accent} />
        <View style={{ flex: 1 }}>
          <ThemedText type="small" themeColor="textSecondary">
            Date of this sale
          </ThemedText>
          <ThemedText type="smallBold" style={{ color: soldAt ? theme.text : Brand.accent }}>
            {soldAt ? dayLabel(soldAt) : 'Tap to pick the day'}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Pressable>

      {datePicker && (
        <DateTimePicker
          value={soldAt ?? new Date()}
          mode="date"
          // Nothing ahead of today, and nothing beyond a real backlog. The
          // server enforces both again; this only saves the trip.
          maximumDate={new Date()}
          minimumDate={new Date(Date.now() - 730 * 24 * 60 * 60 * 1000)}
          onChange={(event, selected) => {
            if (Platform.OS !== 'ios') setDatePicker(false);
            if (event.type === 'set' && selected) setSoldAt(selected);
          }}
        />
      )}
      {Platform.OS === 'ios' && datePicker && (
        <Pressable onPress={() => setDatePicker(false)} style={{ alignSelf: 'flex-end' }}>
          <ThemedText type="linkPrimary">Done</ThemedText>
        </Pressable>
      )}
    </View>
  ) : null;

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
              {backdating
                ? step === 'pick'
                  ? 'Add old sale'
                  : 'Confirm old sale'
                : step === 'pick'
                  ? 'Give product'
                  : 'Confirm sale'}
            </ThemedText>
            <View style={{ width: 26 }} />
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.text} />
          ) : step === 'pick' ? (
            <>
              <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <ThemedText type="small" themeColor="textSecondary">
                  {backdating ? 'Recording an old sale to ' : 'Selling to '}
                  {buyerName}
                  {toFpo ? ' (FPO)' : ''}
                </ThemedText>

                {dateRow}

                {/* An FPO's crops are names it deals in, not Crop records, so
                    they are chosen the same way but stored as text. */}
                {toFpo && fpoCropNames.length > 0 ? (
                  <View style={styles.chipWrap}>
                    {fpoCropNames.map((c) => {
                      const on = cropName === c;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => setCropName(on ? null : c)}
                          style={[
                            styles.chip,
                            { backgroundColor: on ? GREEN : theme.backgroundElement },
                          ]}>
                          <ThemedText
                            type="small"
                            style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                            {c}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

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
                              <View style={[styles.pastImg, { backgroundColor: theme.background }]}>
                                {g.imageUrl ? (
                                  <TappablePhoto
                                    uri={g.imageUrl}
                                    caption={g.name}
                                    style={styles.pastImgInner}
                                    contentFit="contain"
                                  />
                                ) : (
                                  <Ionicons name="cube-outline" size={16} color={theme.textSecondary} />
                                )}
                              </View>
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
                      /**
                       * One card per product, laid out the way the grocery
                       * apps the agents already use lay theirs out: ADD sits
                       * on the picture, the price comes first under it as a
                       * badge, then the name, then the sizes.
                       *
                       * A product in one size adds straight from the card and
                       * the button becomes its stepper. A product in several
                       * says "3 options" on the button and opens the sheet,
                       * where every size has its own ADD — the card never
                       * guesses which size was meant.
                       */
                      const rows = offers.filter((o) => o.productId === p._id);
                      const single = rows[0];
                      if (!single) return null;
                      const multi = rows.length > 1;
                      const held = rows.filter((o) => cart[o._id]);
                      const heldQty = held.reduce((s, o) => s + cart[o._id].qty, 0);
                      const cheapest = Math.min(...rows.map((o) => o.price ?? 0));
                      // The one size in the basket, when exactly one is: it
                      // can be stepped from the card. Two or more cannot, so
                      // the button goes back to the sheet.
                      const sole = held.length === 1 ? held[0] : null;
                      return (
                        <View
                          key={p._id}
                          style={[styles.card, { width: cardW, backgroundColor: theme.backgroundElement }]}>
                          <Pressable onPress={() => setDetailFor(p)} style={({ pressed }) => pressed && { opacity: 0.85 }}>
                            {/* `contain` on a plain well, not `cover`: a bag
                                or a bottle shot square on loses its label to a
                                crop, and the label is what is being chosen. */}
                            <View style={[styles.cardImgWrap, { backgroundColor: theme.background }]}>
                              {p.imageUrl ? (
                                <Image source={{ uri: p.imageUrl }} style={styles.cardImg} contentFit="contain" />
                              ) : (
                                <Ionicons name="cube-outline" size={30} color={GREEN} />
                              )}
                              <View style={styles.overlay}>
                                {heldQty === 0 ? (
                                  <Pressable
                                    onPress={() => (multi ? setDetailFor(p) : add(single))}
                                    style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
                                    <ThemedText type="small" style={styles.addText}>
                                      ADD
                                    </ThemedText>
                                    {multi ? (
                                      <ThemedText style={styles.addSub}>{rows.length} options</ThemedText>
                                    ) : null}
                                  </Pressable>
                                ) : sole ? (
                                  <View style={styles.stepWrap}>
                                    <View style={styles.stepper}>
                                      <Pressable onPress={() => setQty(sole, cart[sole._id].qty - 1)} hitSlop={6} style={styles.stepBtn}>
                                        <Ionicons name="remove" size={16} color="#fff" />
                                      </Pressable>
                                      <ThemedText type="smallBold" style={styles.stepCount}>
                                        {cart[sole._id].qty}
                                      </ThemedText>
                                      <Pressable onPress={() => setQty(sole, cart[sole._id].qty + 1)} hitSlop={6} style={styles.stepBtn}>
                                        <Ionicons name="add" size={16} color="#fff" />
                                      </Pressable>
                                    </View>
                                    {/* Which size the stepper is counting —
                                        without it, on a product in three
                                        sizes, "2" says nothing. */}
                                    {multi ? (
                                      <View style={styles.stepSize}>
                                        <ThemedText style={styles.stepSizeText}>{sole.unit}</ThemedText>
                                      </View>
                                    ) : null}
                                  </View>
                                ) : (
                                  <Pressable
                                    onPress={() => setDetailFor(p)}
                                    style={({ pressed }) => [styles.heldBtn, pressed && { opacity: 0.85 }]}>
                                    <ThemedText type="small" style={styles.heldText}>
                                      {heldQty} added
                                    </ThemedText>
                                    <ThemedText style={[styles.addSub, { color: '#fff' }]}>
                                      {held.length} sizes · edit
                                    </ThemedText>
                                  </Pressable>
                                )}
                              </View>
                            </View>
                          </Pressable>

                          <View style={styles.priceRow}>
                            <View style={styles.pricePill}>
                              <ThemedText style={styles.pricePillText}>{money(cheapest)}</ThemedText>
                            </View>
                            {multi ? (
                              <ThemedText type="small" themeColor="textSecondary" style={styles.onwards}>
                                onwards
                              </ThemedText>
                            ) : null}
                          </View>
                          <Pressable onPress={() => setDetailFor(p)}>
                            <ThemedText type="smallBold" numberOfLines={2} style={styles.cardName}>
                              {p.name}
                            </ThemedText>
                            {/* The sizes on offer, or the unit of the one size. */}
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.cardMeta}>
                              {multi ? rows.map((o) => o.unit).join(' · ') : single.unit || ' '}
                            </ThemedText>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </ScrollView>

              {/* The options sheet: the product, then every size as its own
                  row with its price and its own ADD. Opened by the card's ADD
                  on a product with sizes, and by the picture or name on any
                  product — it is also where the full description lives. */}
              <Modal
                visible={!!detailFor}
                transparent
                animationType="slide"
                onRequestClose={() => setDetailFor(null)}>
                <Pressable style={styles.backdrop} onPress={() => setDetailFor(null)}>
                  {/* Swallows taps meant for the sheet so they do not reach the
                      backdrop and close it. */}
                  <Pressable onPress={() => {}}>
                    <View style={[styles.sheet, { backgroundColor: theme.background }]}>
                      <View style={styles.sheetHandle} />
                      {detailFor
                        ? (() => {
                            const p = detailFor;
                            const rows = offers.filter((o) => o.productId === p._id);
                            const heldQty = rows.reduce((s, o) => s + (cart[o._id]?.qty ?? 0), 0);
                            return (
                              <>
                                <View style={styles.sheetHead}>
                                  <View style={[styles.sheetThumb, { backgroundColor: theme.backgroundElement }]}>
                                    {p.imageUrl ? (
                                      <TappablePhoto uri={p.imageUrl} caption={p.name} style={styles.fillImg} contentFit="contain" />
                                    ) : (
                                      <Ionicons name="cube-outline" size={28} color={GREEN} />
                                    )}
                                  </View>
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <ThemedText type="subtitle">{p.name}</ThemedText>
                                    {p.description ? (
                                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                                        {p.description}
                                      </ThemedText>
                                    ) : null}
                                    {p.crops && p.crops.length > 0 ? (
                                      <View style={styles.forRow}>
                                        {p.crops.map((c) => (
                                          <View key={c} style={styles.forChip}>
                                            <ThemedText type="small" style={styles.forChipText}>
                                              {c}
                                            </ThemedText>
                                          </View>
                                        ))}
                                      </View>
                                    ) : null}
                                  </View>
                                  <Pressable onPress={() => setDetailFor(null)} hitSlop={10} style={styles.sheetClose}>
                                    <Ionicons name="close" size={18} color={theme.text} />
                                  </Pressable>
                                </View>

                                <ThemedText type="smallBold" style={{ marginTop: Spacing.four, marginBottom: Spacing.two }}>
                                  {rows.length > 1 ? `Choose size · ${rows.length} options` : 'Price'}
                                </ThemedText>
                                <ScrollView style={{ maxHeight: height * 0.5 }} showsVerticalScrollIndicator={false}>
                                  {rows.map((o) => {
                                    const line = cart[o._id];
                                    return (
                                      <View
                                        key={o._id}
                                        style={[
                                          styles.optionRow,
                                          {
                                            borderColor: line ? GREEN : theme.backgroundElement,
                                            backgroundColor: line ? Brand.primarySurface : theme.background,
                                          },
                                        ]}>
                                        <View style={[styles.optionImg, { backgroundColor: theme.backgroundElement }]}>
                                          {p.imageUrl ? (
                                            <Image source={{ uri: p.imageUrl }} style={styles.fillImg} contentFit="contain" />
                                          ) : (
                                            <Ionicons name="cube-outline" size={20} color={GREEN} />
                                          )}
                                        </View>
                                        <View style={{ flex: 1, minWidth: 0 }}>
                                          <ThemedText type="smallBold">
                                            {o.unit || (rows.length > 1 ? 'Standard' : '1 pack')}
                                          </ThemedText>
                                          <ThemedText style={styles.optionPrice}>{money(o.price)}</ThemedText>
                                          {line ? (
                                            <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                                              {line.qty} added · {money(line.qty * o.price)}
                                            </ThemedText>
                                          ) : null}
                                        </View>
                                        {line ? (
                                          <View style={styles.stepper}>
                                            <Pressable onPress={() => setQty(o, line.qty - 1)} hitSlop={6} style={styles.stepBtn}>
                                              <Ionicons name="remove" size={16} color="#fff" />
                                            </Pressable>
                                            <ThemedText type="smallBold" style={styles.stepCount}>
                                              {line.qty}
                                            </ThemedText>
                                            <Pressable onPress={() => setQty(o, line.qty + 1)} hitSlop={6} style={styles.stepBtn}>
                                              <Ionicons name="add" size={16} color="#fff" />
                                            </Pressable>
                                          </View>
                                        ) : (
                                          <Pressable
                                            onPress={() => add(o)}
                                            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
                                            <ThemedText type="small" style={styles.addText}>
                                              ADD
                                            </ThemedText>
                                          </Pressable>
                                        )}
                                      </View>
                                    );
                                  })}
                                </ScrollView>
                                <Pressable
                                  onPress={() => setDetailFor(null)}
                                  style={({ pressed }) => [styles.sheetDone, pressed && { opacity: 0.85 }]}>
                                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                                    {heldQty > 0 ? `Done · ${heldQty} added` : 'Close'}
                                  </ThemedText>
                                </Pressable>
                              </>
                            );
                          })()
                        : null}
                    </View>
                  </Pressable>
                </Pressable>
              </Modal>

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
              {dateRow}

              <View style={styles.confirmHead}>
                <ThemedText type="smallBold">Basket ({inCart.length})</ThemedText>
                {backdating ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Photos not needed
                  </ThemedText>
                ) : (
                  <ThemedText
                    type="small"
                    style={{ color: missingPhotos.length ? Brand.accent : GREEN, fontWeight: '700' }}>
                    Photos {inCart.length - missingPhotos.length}/{inCart.length}
                  </ThemedText>
                )}
              </View>

              {inCart.map((p, i) => {
                const line = cart[p._id];
                const done = !!line.before;
                const math = lineMath(line);
                return (
                  <View key={p._id} style={[styles.itemCard, { borderColor: theme.backgroundElement }]}>
                    {/* Head: the numbered badge, the pack shot, and what this
                        line is. Numbering matters on an invoice — it is how a
                        farmer and an agent refer to a line out loud. */}
                    <View style={styles.itemHead}>
                      <View style={styles.itemIndex}>
                        <ThemedText style={styles.itemIndexText}>{i + 1}</ThemedText>
                      </View>
                      <View style={[styles.itemImg, { backgroundColor: theme.background }]}>
                        {p.imageUrl ? (
                          <Image
                            source={{ uri: p.imageUrl }}
                            style={styles.fillImg}
                            contentFit="contain"
                          />
                        ) : (
                          <Ionicons name="cube-outline" size={20} color={GREEN} />
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ThemedText type="smallBold" numberOfLines={2}>
                          {p.name}
                        </ThemedText>
                        {/* A size is a pill, a plain unit is a caption: two
                            lines of "Nutri Boost" need the 1 L and the 5 L to
                            jump out, where "per 5 kg" only needs to be read. */}
                        {p.variantId ? (
                          <View style={styles.itemSize}>
                            <ThemedText type="small" style={styles.itemSizeText}>
                              {p.unit}
                            </ThemedText>
                          </View>
                        ) : p.unit ? (
                          <ThemedText type="small" themeColor="textSecondary" style={styles.itemUnit}>
                            {p.unit}
                          </ThemedText>
                        ) : null}
                      </View>
                      <Ionicons
                        name={done ? 'checkmark-circle' : 'alert-circle-outline'}
                        size={20}
                        color={done ? GREEN : Brand.accent}
                      />
                    </View>

                    {/* Qty, Rate, Amount — the three columns of an invoice line,
                        read left to right. Quantity keeps its stepper because
                        it is the one figure still being decided here. */}
                    <View style={styles.qrarow}>
                      <View style={styles.qraCell}>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.qraLabel}>
                          Qty
                        </ThemedText>
                        <View style={[styles.stepper, { borderColor: GREEN }]}>
                          <Pressable onPress={() => setQty(p, line.qty - 1)} hitSlop={6} style={styles.stepBtn}>
                            <Ionicons name="remove" size={15} color={GREEN} />
                          </Pressable>
                          <ThemedText type="smallBold" style={styles.stepValue}>
                            {line.qty}
                          </ThemedText>
                          <Pressable onPress={() => setQty(p, line.qty + 1)} hitSlop={6} style={styles.stepBtn}>
                            <Ionicons name="add" size={15} color={GREEN} />
                          </Pressable>
                        </View>
                      </View>
                      <View style={styles.qraCell}>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.qraLabel}>
                          Rate
                        </ThemedText>
                        {/* The catalog price, shown not typed. It used to be an
                            input, which meant the price a farmer was charged
                            could differ from the price the company set without
                            anyone noticing — charging less is now a discount,
                            and it is recorded as one. */}
                        <ThemedText type="smallBold" style={styles.qraValue}>
                          {money(Number(line.price) || 0)}
                        </ThemedText>
                      </View>
                      <View style={[styles.qraCell, { alignItems: 'flex-end' }]}>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.qraLabel}>
                          Amount
                        </ThemedText>
                        {/* The rate is what the farmer pays, tax inside it, so
                            this column is qty x rate with the 2.5% CGST and
                            2.5% SGST taken back out — the way a GST invoice
                            states a line, with the tax added once at the
                            bottom. It therefore will NOT equal qty x rate. */}
                        <ThemedText type="smallBold" style={styles.qraValue}>
                          {money(gstSplit(math.gross).taxable)}
                        </ThemedText>
                      </View>
                    </View>

                    {/* Line discount, in its own tinted panel the way the
                        invoice lays it out: the toggle picks how it is entered,
                        the left box takes the figure, and the right box shows
                        what it works out to. */}
                    <View style={styles.discPanel}>
                      <View style={styles.discHead}>
                        <Ionicons name="pricetag" size={14} color={Brand.danger} />
                        <ThemedText type="smallBold" style={styles.discTitle}>
                          Line Discount
                        </ThemedText>
                        <View style={styles.discToggle}>
                          {(['pct', 'rs'] as DiscountType[]).map((t) => {
                            const on = line.discountType === t;
                            return (
                              <Pressable
                                key={t}
                                onPress={() => setDiscountType(p._id, t)}
                                hitSlop={6}
                                style={({ pressed }) => [
                                  styles.discToggleBtn,
                                  on && { backgroundColor: GREEN },
                                  pressed && { opacity: 0.8 },
                                ]}>
                                <ThemedText
                                  style={[
                                    styles.discToggleText,
                                    { color: on ? '#fff' : theme.textSecondary },
                                  ]}>
                                  {t === 'pct' ? '%' : '₹'}
                                </ThemedText>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>

                      <View style={styles.discFields}>
                        <View style={[styles.discField, { backgroundColor: theme.background }]}>
                          <ThemedText type="small" themeColor="textSecondary" style={styles.discFieldLabel}>
                            {line.discountType === 'pct' ? 'Discount (%)' : 'Discount (₹)'}
                          </ThemedText>
                          <TextInput
                            value={line.discount}
                            onChangeText={(v) => setDiscount(p._id, v)}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={theme.textSecondary}
                            style={[styles.discFieldInput, { color: theme.text }]}
                          />
                        </View>
                        {/* Shown, not typed. One figure is the agreement and
                            the other is its consequence — letting both be
                            edited would need a rule for which wins, and this
                            screen has no reason to invent one. */}
                        <View style={[styles.discField, { backgroundColor: theme.background }]}>
                          <ThemedText type="small" themeColor="textSecondary" style={styles.discFieldLabel}>
                            Discount Amount
                          </ThemedText>
                          <ThemedText style={styles.discFieldValue}>{money(math.off)}</ThemedText>
                        </View>
                      </View>

                      {math.off > 0 ? (
                        <ThemedText style={styles.discOff}>− {money(math.off)}</ThemedText>
                      ) : null}
                    </View>

                    {/* What this line comes to once its discount is off. */}
                    <View style={styles.netBand}>
                      <ThemedText type="smallBold" style={styles.netLabel}>
                        Net Amount
                      </ThemedText>
                      <ThemedText type="smallBold" style={styles.netValue}>
                        {money(gstSplit(math.net).taxable)}
                      </ThemedText>
                    </View>

                    {/* The proof photo stays on the line it belongs to. The
                        invoice this is modelled on has no such thing, but a
                        sale here is not recorded until the crop is
                        photographed — dropping it would remove the one part of
                        this screen that is evidence rather than arithmetic. */}
                    <View style={styles.photoRow}>{photoSlot(p._id, line.before)}</View>
                  </View>
                );
              })}

              {/* Straight after the last product, before the bill starts.
                  Adding to the basket is part of building the list of items;
                  by the time the eye reaches the totals, the basket is settled
                  and this was only something to scroll past. */}
              <Pressable
                onPress={() => setStep('pick')}
                style={({ pressed }) => [styles.addMoreBtn, pressed && { opacity: 0.85 }]}>
                <Ionicons name="add-circle-outline" size={18} color={GREEN} />
                <ThemedText type="smallBold" style={{ color: GREEN }}>
                  Add more products
                </ThemedText>
              </Pressable>

              {/* The bill, laid out the way an invoice reads: what the items
                  come to, what came off, what is taxable, the tax itself, and
                  the one figure the farmer actually pays. */}
              <View style={[styles.billCard, { borderColor: theme.backgroundElement }]}>
                {/* Courier, packaging, anything else on top of the products.
                    Same two-field shape as the discount panel below: what was
                    typed on the left, what it is worth ex-GST on the right, so
                    the column of ex-tax figures still adds up to Taxable Value. */}
                <View style={styles.discPanel}>
                  <View style={styles.discHead}>
                    <Ionicons name="cube-outline" size={14} color={GREEN} />
                    <ThemedText type="smallBold" style={[styles.discTitle, { color: GREEN }]}>
                      Courier / Other Charges
                    </ThemedText>
                  </View>
                  <View style={styles.discFields}>
                    <View style={[styles.discField, { backgroundColor: theme.background }]}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.discFieldLabel}>
                        Charges (₹)
                      </ThemedText>
                      <TextInput
                        value={otherCharges}
                        onChangeText={setOtherCharges}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.discFieldInput, { color: theme.text }]}
                      />
                    </View>
                    <View style={[styles.discField, { backgroundColor: theme.background }]}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.discFieldLabel}>
                        Excl. 18% GST
                      </ThemedText>
                      <ThemedText style={[styles.discFieldValue, { color: GREEN }]}>
                        {chargesEx > 0 ? `+ ${money(chargesEx)}` : money(0)}
                      </ThemedText>
                    </View>
                  </View>
                </View>

                <View style={styles.billRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Subtotal
                  </ThemedText>
                  <ThemedText type="smallBold">{money(subtotalEx)}</ThemedText>
                </View>

                {/* The discount on the basket as a whole. Last of the two, so a
                    percentage here means a percentage of what is still owed
                    rather than of the list price. */}
                <View style={styles.discPanel}>
                  <View style={styles.discHead}>
                    <Ionicons name="pricetag" size={14} color={Brand.danger} />
                    <ThemedText type="smallBold" style={styles.discTitle}>
                      Overall Discount
                    </ThemedText>
                    <View style={styles.discToggle}>
                      {(['pct', 'rs'] as DiscountType[]).map((t) => {
                        const on = saleDiscountType === t;
                        return (
                          <Pressable
                            key={t}
                            onPress={() => setSaleDiscountType(t)}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.discToggleBtn,
                              on && { backgroundColor: GREEN },
                              pressed && { opacity: 0.8 },
                            ]}>
                            <ThemedText
                              style={[
                                styles.discToggleText,
                                { color: on ? '#fff' : theme.textSecondary },
                              ]}>
                              {t === 'pct' ? '%' : '₹'}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.discFields}>
                    <View style={[styles.discField, { backgroundColor: theme.background }]}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.discFieldLabel}>
                        {saleDiscountType === 'pct' ? 'Discount (%)' : 'Discount (₹)'}
                      </ThemedText>
                      <TextInput
                        value={saleDiscount}
                        onChangeText={setSaleDiscount}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.discFieldInput, { color: theme.text }]}
                      />
                    </View>
                    <View style={[styles.discField, { backgroundColor: theme.background }]}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.discFieldLabel}>
                        Discount Amount
                      </ThemedText>
                      <ThemedText style={[styles.discFieldValue, styles.discOff]}>
                        {saleOffEx > 0 ? `− ${money(saleOffEx)}` : money(0)}
                      </ThemedText>
                    </View>
                  </View>
                </View>

                <View style={styles.billRow}>
                  <ThemedText type="smallBold">Taxable Value</ThemedText>
                  <ThemedText type="smallBold">{money(taxableAll)}</ThemedText>
                </View>

                {/* GST spelled out as a table, because that is how it appears
                    on the bill the farmer is used to being handed. */}
                <View style={[styles.gstBox, { backgroundColor: theme.background }]}>
                  <View style={styles.gstHead}>
                    <Ionicons name="document-text-outline" size={13} color={GREEN} />
                    <ThemedText type="smallBold" style={{ color: GREEN, fontSize: 12 }}>
                      GST Details
                    </ThemedText>
                  </View>
                  <View style={styles.gstRow}>
                    {['Tax Type', 'Rate', 'Taxable Value', 'Tax Amount'].map((h, i) => (
                      <ThemedText
                        key={h}
                        type="small"
                        themeColor="textSecondary"
                        style={[styles.gstCell, i > 1 && styles.gstCellRight, styles.gstHeadCell]}>
                        {h}
                      </ThemedText>
                    ))}
                  </View>
                  {/* Two groups when there is a courier fee: the products at
                      2.5% + 2.5%, the courier at 9% + 9%. Each pair shows its
                      own taxable value, since the rate applies to that alone. */}
                  {[
                    { key: 'cgst5', type: 'CGST', rate: '2.5%', on: tax.taxable, amount: tax.cgst },
                    { key: 'sgst5', type: 'SGST', rate: '2.5%', on: tax.taxable, amount: tax.sgst },
                    ...(charges > 0
                      ? [
                          { key: 'cgst18', type: 'CGST', rate: '9%', on: chargesEx, amount: chargesTax.cgst },
                          { key: 'sgst18', type: 'SGST', rate: '9%', on: chargesEx, amount: chargesTax.sgst },
                        ]
                      : []),
                  ].map((r) => (
                    <View key={r.key} style={styles.gstRow}>
                      <ThemedText type="small" style={styles.gstCell}>
                        {r.type}
                      </ThemedText>
                      <ThemedText type="small" style={styles.gstCell}>
                        {r.rate}
                      </ThemedText>
                      <ThemedText type="small" style={[styles.gstCell, styles.gstCellRight]}>
                        {money(r.on)}
                      </ThemedText>
                      <ThemedText type="small" style={[styles.gstCell, styles.gstCellRight]}>
                        {money(r.amount)}
                      </ThemedText>
                    </View>
                  ))}
                  <View style={[styles.gstRow, styles.gstTotalRow]}>
                    <ThemedText type="smallBold" style={[styles.gstCell, { flex: 3 }]}>
                      Total GST
                    </ThemedText>
                    <ThemedText type="smallBold" style={[styles.gstCell, styles.gstCellRight, { color: GREEN }]}>
                      {money(gstAll)}
                    </ThemedText>
                  </View>
                </View>

                {/* The number that was agreed out loud, last and largest. */}
                <View style={styles.payableBand}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small" style={styles.payableLabel}>
                      Total Payable
                    </ThemedText>
                    <ThemedText style={styles.payableValue}>{money(total)}</ThemedText>
                  </View>
                  <View style={styles.payablePill}>
                    <Ionicons name="pricetags-outline" size={13} color={GREEN} />
                    <ThemedText type="small" style={styles.payablePillText}>
                      Inclusive of GST
                    </ThemedText>
                  </View>
                </View>
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

            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {cameraFor && <CameraCapture onCapture={handleCapture} onClose={() => setCameraFor(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  // ----- Confirm step, laid out as an invoice -----
  /** One item, as a bordered card rather than a tinted block. */
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    marginBottom: Spacing.three,
    gap: Spacing.three,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  /** The line number, so a line can be referred to out loud. */
  itemIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIndexText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  itemImg: {
    width: 46,
    height: 46,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fillImg: { width: '100%', height: '100%' },
  itemUnit: { fontSize: 11 },
  itemSize: {
    alignSelf: 'flex-start',
    marginTop: 2,
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    backgroundColor: Brand.primarySurface,
  },
  itemSizeText: { fontSize: 11, fontWeight: '800', color: GREEN },
  /** Qty / Rate / Amount — the three columns an invoice line is read in. */
  qrarow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  qraCell: { flex: 1, gap: 3 },
  qraLabel: { fontSize: 11 },
  qraValue: { fontSize: 15 },
  stepValue: { color: GREEN, minWidth: 20, textAlign: 'center' },
  /** The discount panel, tinted so it reads as an adjustment to the line. */
  discPanel: {
    backgroundColor: Brand.dangerSurface,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  discHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  discTitle: { color: Brand.danger, flex: 1, fontSize: 13 },
  discToggle: {
    flexDirection: 'row',
    borderRadius: Spacing.four,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
    padding: 2,
  },
  /**
   * 40x30 each. Small enough to sit on the panel header, large enough to hit
   * outdoors one-handed — the two options being close together is what turns a
   * fifty-rupee discount into fifty percent.
   */
  discToggleBtn: {
    width: 40,
    height: 30,
    borderRadius: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discToggleText: { fontSize: 15, fontWeight: '800' },
  discFields: { flexDirection: 'row', gap: Spacing.two },
  discField: {
    flex: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  discFieldLabel: { fontSize: 10 },
  discFieldInput: { fontSize: 16, padding: 0, height: 24 },
  discFieldValue: { fontSize: 16, height: 24, fontWeight: '700' },
  /** The deduction, said once more in the discount panel's own colour. */
  discOff: { color: Brand.danger, fontWeight: '800', textAlign: 'right' },
  /** What this line comes to, on its own green band. */
  netBand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Brand.primarySurface,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  netLabel: { color: GREEN },
  netValue: { color: GREEN, fontSize: 16 },
  // ----- The bill -----
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  billCard: {
    backgroundColor: '#fff',
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    marginTop: Spacing.two,
    gap: Spacing.three,
  },
  billRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gstBox: { borderRadius: Spacing.two, padding: Spacing.two, gap: 4 },
  gstHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  gstRow: { flexDirection: 'row', alignItems: 'center' },
  gstCell: { flex: 1, fontSize: 11 },
  gstCellRight: { textAlign: 'right' },
  gstHeadCell: { fontSize: 10, textTransform: 'uppercase' },
  gstTotalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.4)',
    paddingTop: 5,
    marginTop: 2,
  },
  payableBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Brand.primarySurface,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  payableLabel: { color: GREEN, fontWeight: '700' },
  payableValue: { color: GREEN, fontSize: 24, fontWeight: '800' },
  payablePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  payablePillText: { color: GREEN, fontWeight: '700', fontSize: 11 },
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
  pastImg: {
    width: '100%',
    height: 56,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pastImgInner: { width: '100%', height: '100%' },
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
  /** The photo's own well: taller than before, and a neutral ground so a
   *  product shot on white does not float on the card's tint. */
  cardImgWrap: {
    width: '100%',
    height: 118,
    borderRadius: Spacing.two,
    marginBottom: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardImg: { width: '100%', height: '100%' },
  cardName: { fontSize: 13, lineHeight: 17 },
  cardMeta: { fontSize: 11, lineHeight: 14, marginTop: 1 },
  /** Bottom-right of the picture, where the thumb lands. */
  overlay: { position: 'absolute', right: 6, bottom: 6, alignItems: 'flex-end' },
  addText: { color: GREEN, fontWeight: '800', letterSpacing: 0.3 },
  addSub: { fontSize: 10, lineHeight: 12, color: GREEN, fontWeight: '600' },
  /** Two or more sizes of one product are in: the card sends you back to the sheet. */
  heldBtn: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
    backgroundColor: GREEN,
  },
  heldText: { color: '#fff', fontWeight: '800' },
  stepWrap: { alignItems: 'center', gap: 3 },
  stepCount: { color: '#fff', minWidth: 20, textAlign: 'center' },
  stepSize: {
    borderRadius: Spacing.one,
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: '#fff',
  },
  stepSizeText: { fontSize: 10, lineHeight: 12, fontWeight: '800', color: GREEN },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.two },
  /** The price as a badge, first thing under the picture. */
  pricePill: {
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    backgroundColor: GREEN,
  },
  pricePillText: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 18 },
  onwards: { fontSize: 11 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  sheetThumb: {
    width: 64,
    height: 64,
    borderRadius: Spacing.two,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  /** One size, one row: thumbnail, size and price, its own ADD. */
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1.5,
    borderRadius: Spacing.three,
    padding: Spacing.two,
    marginBottom: Spacing.two,
  },
  optionImg: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionPrice: { fontSize: 16, fontWeight: '800', lineHeight: 20 },
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
  forRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  forChip: {
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    backgroundColor: Brand.primarySurface,
  },
  forChipText: { fontSize: 11, fontWeight: '700', color: GREEN },
  sheetDone: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: GREEN,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  addBtn: {
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: GREEN,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
    backgroundColor: '#fff',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.two,
    backgroundColor: GREEN,
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
  /** Sits between the last item and the bill, dashed so it reads as a slot
   *  waiting to be filled rather than another product already in the basket. */
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: `${GREEN}66`,
    backgroundColor: Brand.primarySurface,
  },
});
