import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImageManipulator from 'expo-image-manipulator';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraCapture } from '@/components/camera-capture';
import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, Crop, CropProductProgress, Product } from '@/lib/api';

const DAY_MS = 24 * 60 * 60 * 1000;

const CATEGORY_EMOJI: Record<string, string> = {
  sowing: '🌱',
  weed: '🌿',
  irrigation: '💧',
  monitoring: '🔍',
  fertilizer: '🧪',
  pest: '🐛',
  disease: '🦠',
  growth: '📈',
  harvest: '🌾',
};

function addDays(base: Date, n: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}
function fmt(d: Date) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export default function ProductsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { cropId, crop, dop, stepStart, stepEnd, stepLabel, stepDetails, stepCategory, stepProducts } =
    useLocalSearchParams<{
      cropId?: string;
      crop?: string;
      dop?: string;
      stepStart?: string;
      stepEnd?: string;
      stepLabel?: string;
      stepDetails?: string;
      stepCategory?: string;
      stepProducts?: string;
    }>();

  // Product IDs mapped to this day's POP step (from the dashboard). null = not opened from a day.
  const stepProductIds = useMemo<string[] | null>(() => {
    if (stepProducts == null) return null;
    try {
      return JSON.parse(stepProducts) as string[];
    } catch {
      return [];
    }
  }, [stepProducts]);

  const base = dop ? new Date(dop) : null;
  const winStart = stepStart ? Number(stepStart) : null;
  const winEnd = stepEnd ? Number(stepEnd) : winStart;
  const catEmoji = (stepCategory && CATEGORY_EMOJI[stepCategory]) || '📋';
  const dayDateLabel =
    winStart != null && base
      ? fmt(addDays(base, winStart - 1)) +
        (winEnd != null && winEnd !== winStart ? ` – ${fmt(addDays(base, winEnd - 1))}` : '')
      : null;

  const [products, setProducts] = useState<Product[]>([]);
  const [cropDoc, setCropDoc] = useState<Crop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Photo-proof upload state
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [prods, cropData] = await Promise.all([
          api.listProducts(),
          cropId ? api.getCrop(cropId) : Promise.resolve(null),
        ]);
        setProducts(prods);
        setCropDoc(cropData);
      } catch (e: any) {
        setError(e?.message || 'Could not load products.');
      } finally {
        setLoading(false);
      }
    })();
  }, [crop, cropId]);

  // Which products already have a "used" photo for this crop.
  const progressMap = useMemo(() => {
    const m: Record<string, CropProductProgress> = {};
    (cropDoc?.productProgress ?? []).forEach((p) => (m[p.productId] = p));
    return m;
  }, [cropDoc]);

  // Products the dashboard mapped to this day's POP step.
  const visibleProducts = useMemo(() => {
    if (stepProductIds == null) return products;
    const set = new Set(stepProductIds);
    return products.filter((p) => set.has(p._id));
  }, [products, stepProductIds]);

  const openCamera = (productId: string) => {
    setActiveProductId(productId);
    setCameraOpen(true);
  };

  const handleCapture = async (uri: string) => {
    setCameraOpen(false);
    if (!activeProductId || !cropId) {
      setActiveProductId(null);
      return;
    }
    setUploadingId(activeProductId);
    try {
      const resized = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
        compress: 0.6,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const updated = await api.completeProductTask(cropId, activeProductId, {
        uri: resized.uri,
        name: `product-${activeProductId}.jpg`,
        type: 'image/jpeg',
      });
      setCropDoc(updated);
      posthog?.capture('product_photo_uploaded', {
        productId: activeProductId,
        cropId: cropId ?? '',
        crop: crop ?? '',
      });
    } catch (e: any) {
      setError(e?.message || 'Upload failed.');
    } finally {
      setUploadingId(null);
      setActiveProductId(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">
            {winStart != null
              ? `Day ${winStart}${winEnd != null && winEnd !== winStart ? `–${winEnd}` : ''} · Products`
              : crop
                ? `${crop} · Products`
                : 'Products'}
          </ThemedText>
          <View style={{ width: 26 }} />
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.text} />
        ) : (
          <FlatList
            data={visibleProducts}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View>
                {/* What to do on this day */}
                {stepLabel ? (
                  <ThemedView type="backgroundElement" style={styles.todoCard}>
                    <View style={styles.todoTop}>
                      <ThemedText style={{ fontSize: 24 }}>{catEmoji}</ThemedText>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {winStart != null
                            ? `Day ${winStart}${winEnd != null && winEnd !== winStart ? `–${winEnd}` : ''}`
                            : 'What to do'}
                          {dayDateLabel ? ` · ${dayDateLabel}` : ''}
                        </ThemedText>
                        <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                          {stepLabel}
                        </ThemedText>
                      </View>
                    </View>
                    {!!stepDetails && (
                      <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                        {stepDetails}
                      </ThemedText>
                    )}
                  </ThemedView>
                ) : null}

                <ThemedText type="smallBold" style={styles.productsHeading}>
                  Products {visibleProducts.length > 0 ? `(${visibleProducts.length})` : ''}
                </ThemedText>
                {visibleProducts.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    Take a photo after using a product to confirm it was applied.
                  </ThemedText>
                )}
              </View>
            }
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText themeColor="textSecondary" type="small">
                  {error ??
                    (winStart != null
                      ? 'No products to use for this day.'
                      : crop
                        ? `No products for ${crop} yet.`
                        : 'No products available yet.')}
                </ThemedText>
              </ThemedView>
            }
            renderItem={({ item }) => {
              const prog = progressMap[item._id];
              return (
                <ThemedView type="backgroundElement" style={styles.card}>
                  <View style={styles.cardTop}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" />
                    ) : (
                      <View style={[styles.image, styles.imagePlaceholder, { backgroundColor: theme.background }]}>
                        <Ionicons name="leaf-outline" size={26} color={theme.textSecondary} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">{item.name}</ThemedText>
                      {!!item.description && (
                        <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 2 }}>
                          {item.description}
                        </ThemedText>
                      )}
                    </View>
                  </View>

                  {/* Photo proof that the product was applied */}
                  <View style={styles.photoRow}>
                    {prog?.imageUrl ? (
                      <>
                        <TappablePhoto uri={prog.imageUrl} style={styles.proofThumb} caption="proof photo" />
                        <View style={styles.doneTag}>
                          <Ionicons name="checkmark-circle" size={16} color="#2e9e5b" />
                          <ThemedText type="small" style={{ color: '#2e9e5b' }}>
                            Photo added
                          </ThemedText>
                        </View>
                        <Pressable
                          onPress={() => openCamera(item._id)}
                          disabled={uploadingId === item._id}
                          style={styles.retakeBtn}>
                          <ThemedText type="small" style={{ color: theme.textSecondary }}>
                            Retake
                          </ThemedText>
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        onPress={() => openCamera(item._id)}
                        disabled={uploadingId === item._id || !cropId}
                        style={[styles.uploadBtn, { borderColor: theme.textSecondary }]}>
                        {uploadingId === item._id ? (
                          <ActivityIndicator size="small" color={theme.text} />
                        ) : (
                          <>
                            <Ionicons name="camera" size={16} color={theme.text} />
                            <ThemedText type="small">Upload photo</ThemedText>
                          </>
                        )}
                      </Pressable>
                    )}
                  </View>
                </ThemedView>
              );
            }}
          />
        )}
      </SafeAreaView>

      {cameraOpen && (
        <CameraCapture onCapture={handleCapture} onClose={() => setCameraOpen(false)} />
      )}
    </ThemedView>
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
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  hint: { marginBottom: Spacing.two, paddingHorizontal: Spacing.one },
  todoCard: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    borderLeftWidth: 4,
    borderLeftColor: '#2e9e5b',
    marginBottom: Spacing.three,
  },
  todoTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  productsHeading: { fontSize: 16, marginBottom: Spacing.one, paddingHorizontal: Spacing.one },
  empty: { padding: Spacing.four, borderRadius: Spacing.three, alignItems: 'center', marginTop: Spacing.three },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.three },
  cardTop: { flexDirection: 'row', gap: Spacing.three },
  image: { width: 64, height: 64, borderRadius: Spacing.two },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  nowBadge: { backgroundColor: '#2e9e5b', paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: 10 },
  nowText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  proofThumb: { width: 40, height: 40, borderRadius: 8 },
  doneTag: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  retakeBtn: { marginLeft: 'auto', paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
