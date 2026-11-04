import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, Product, VerifyStatus } from '@/lib/api';

const GREEN = Brand.primary;
const RED = Brand.danger;
const GREEN_SURFACE = Brand.surface;

export default function AgronomistVerifyScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const params = useLocalSearchParams<{
    mode?: string;
    cropId?: string;
    crop?: string;
    farmer?: string;
    dop?: string;
    day?: string;
    dayEnd?: string;
    operation?: string;
    details?: string;
    stepCategory?: string;
    stepProducts?: string;
  }>();
  const mode = params.mode === 'product' ? 'product' : 'operation';
  const cropId = params.cropId ?? '';
  const day = Number(params.day ?? 0);
  const dayEnd = params.dayEnd ? Number(params.dayEnd) : null;

  const productIds = useMemo<string[]>(() => {
    try {
      return JSON.parse(params.stepProducts ?? '[]');
    } catch {
      return [];
    }
  }, [params.stepProducts]);
  const [dayProducts, setDayProducts] = useState<Product[]>([]);

  const [existingImage, setExistingImage] = useState<string>('');
  const [existingStatus, setExistingStatus] = useState<VerifyStatus | null>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<VerifyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the existing verification for THIS mode (operation vs product) so each
  // has its own proof photo / status.
  useEffect(() => {
    if (!cropId) return;
    api
      .getCrop(cropId)
      .then((c) => {
        const v = (c.verifications ?? []).find((x) => x.day === day && (x.kind || 'operation') === mode);
        if (v) {
          setExistingImage(v.imageUrl || '');
          setExistingStatus(v.status);
          if (v.note) setNote(v.note);
        } else {
          setExistingImage('');
          setExistingStatus(null);
          setNote('');
        }
      })
      .catch(() => {});
  }, [cropId, day, mode]);

  // Products the dashboard mapped to this day's POP step.
  useEffect(() => {
    if (!productIds.length) return;
    api
      .listProducts()
      .then((all) => {
        const set = new Set(productIds);
        setDayProducts(all.filter((p) => set.has(p._id)));
      })
      .catch(() => {});
  }, [productIds]);

  const pickFromGallery = async () => {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (!res.canceled && res.assets[0]?.uri) setPickedUri(res.assets[0].uri);
  };

  const submit = async (status: VerifyStatus) => {
    if (!cropId) return;
    setSubmitting(status);
    setError(null);
    try {
      let image;
      if (pickedUri) {
        const resized = await ImageManipulator.manipulateAsync(pickedUri, [{ resize: { width: 1080 } }], {
          compress: 0.6,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        image = { uri: resized.uri, name: `verify-${cropId}-${day}.jpg`, type: 'image/jpeg' };
      }
      await api.verifyTask(
        cropId,
        {
          day,
          dayEnd,
          kind: mode,
          operation: params.operation ?? '',
          status,
          note: note.trim(),
          agronomistId: user?._id,
        },
        image
      );
      posthog?.capture('task_verified', { status, kind: mode, crop: params.crop ?? '', day, hasPhoto: !!pickedUri });
      Alert.alert(
        status === 'done' ? 'Marked done ✓' : 'Marked not done',
        'Saved. The admin can see this on the dashboard.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (e: any) {
      setError(e?.message || 'Could not save verification.');
    } finally {
      setSubmitting(null);
    }
  };

  const dayLabel = dayEnd && dayEnd !== day ? `Day ${day}–${dayEnd}` : `Day ${day}`;
  const previewUri = pickedUri || existingImage;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScreenHeader
            onBack={() => router.back()}
            title={mode === 'product' ? 'Products' : 'Operation'}
          />

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* Task summary */}
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.dayBadge}>
                  <ThemedText style={styles.dayBadgeText}>{dayLabel}</ThemedText>
                </View>
                {existingStatus && (
                  <View
                    style={[
                      styles.statusPill,
                      { backgroundColor: existingStatus === 'done' ? `${GREEN}22` : `${RED}22` },
                    ]}>
                    <Ionicons
                      name={existingStatus === 'done' ? 'checkmark-circle' : 'close-circle'}
                      size={14}
                      color={existingStatus === 'done' ? GREEN : RED}
                    />
                    <ThemedText
                      type="small"
                      style={{ color: existingStatus === 'done' ? GREEN : RED, fontWeight: '700' }}>
                      {existingStatus === 'done' ? 'Verified done' : 'Marked not done'}
                    </ThemedText>
                  </View>
                )}
              </View>
              <View style={{ marginTop: Spacing.two }}>
                <ThemedText type="subtitle">{params.operation || 'Task'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {params.farmer ? `${params.farmer} · ` : ''}
                  {params.crop ?? ''}
                </ThemedText>
              </View>
            </View>

            {/* Operation mode: the day's Package of Practices */}
            {mode === 'operation' && (
              <>
                <ThemedText type="smallBold" style={styles.sectionLabel}>
                  What to do today
                </ThemedText>
                <View style={styles.card}>
                  {params.stepCategory ? (
                    <View style={styles.catPill}>
                      <ThemedText type="small" style={{ color: GREEN, fontWeight: '700', textTransform: 'capitalize' }}>
                        {params.stepCategory}
                      </ThemedText>
                    </View>
                  ) : null}
                  <ThemedText style={{ lineHeight: 22 }}>
                    {params.details || 'No instructions provided for this day.'}
                  </ThemedText>
                </View>
              </>
            )}

            {/* Product mode: the products to use this day */}
            {mode === 'product' && (
              <>
                <ThemedText type="smallBold" style={styles.sectionLabel}>
                  Products to use today
                </ThemedText>
                {dayProducts.length === 0 ? (
                  <View style={styles.card}>
                    <ThemedText type="small" themeColor="textSecondary">
                      No products are mapped to this day.
                    </ThemedText>
                  </View>
                ) : (
                  <View style={{ gap: Spacing.two }}>
                    {dayProducts.map((p) => (
                      <View key={p._id} style={styles.prodRow}>
                        {p.imageUrl ? (
                          <Image source={{ uri: p.imageUrl }} style={styles.prodRowImg} contentFit="cover" />
                        ) : (
                          <View style={[styles.prodRowImg, styles.prodPlaceholder]}>
                            <Ionicons name="cube-outline" size={22} color={GREEN} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <ThemedText type="smallBold">{p.name}</ThemedText>
                          {p.description ? (
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                              {p.description}
                            </ThemedText>
                          ) : null}
                          {(p.price > 0 || p.unit) && (
                            <ThemedText type="small" style={{ color: GREEN, fontWeight: '700', marginTop: 2 }}>
                              {p.price > 0 ? `₹${p.price}` : ''}
                              {p.unit ? ` / ${p.unit}` : ''}
                            </ThemedText>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* Photo proof (from gallery) — separate for operation vs product */}
            <ThemedText type="smallBold" style={styles.sectionLabel}>
              {mode === 'product' ? 'Product proof photo' : 'Operation proof photo'} (optional)
            </ThemedText>
            {previewUri ? (
              <View style={styles.photoWrap}>
                <Image source={{ uri: previewUri }} style={styles.photo} contentFit="cover" />
                <Pressable onPress={pickFromGallery} style={styles.changePhoto}>
                  <Ionicons name="images-outline" size={16} color="#fff" />
                  <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                    Change
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={pickFromGallery} style={[styles.uploadBtn, { borderColor: GREEN }]}>
                <Ionicons name="images-outline" size={22} color={GREEN} />
                <ThemedText type="smallBold" style={{ color: GREEN }}>
                  Upload from gallery
                </ThemedText>
              </Pressable>
            )}

            {/* Note */}
            <ThemedText type="smallBold" style={styles.sectionLabel}>
              Note (optional)
            </ThemedText>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Anything the admin should know"
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.backgroundElement, minHeight: 76, textAlignVertical: 'top' },
              ]}
            />

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            {/* Actions */}
            <View style={styles.actions}>
              <Pressable
                onPress={() => submit('done')}
                disabled={!!submitting}
                style={[styles.actBtn, { backgroundColor: GREEN, opacity: submitting ? 0.6 : 1 }]}>
                {submitting === 'done' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <ThemedText style={styles.actText}>Mark Done</ThemedText>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={() => submit('not_done')}
                disabled={!!submitting}
                style={[styles.actBtn, { backgroundColor: RED, opacity: submitting ? 0.6 : 1 }]}>
                {submitting === 'not_done' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="close-circle" size={18} color="#fff" />
                    <ThemedText style={styles.actText}>Not Done</ThemedText>
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  card: { backgroundColor: '#fff', borderRadius: Spacing.four, padding: Spacing.four },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayBadge: {
    backgroundColor: 'rgba(255,127,0,0.12)',
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.four,
  },
  dayBadgeText: { color: GREEN, fontWeight: '800', fontSize: 13 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.four,
  },
  catPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,127,0,0.12)',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.four,
    marginBottom: Spacing.two,
  },
  prodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  prodRowImg: { width: 56, height: 56, borderRadius: Spacing.two },
  prodPlaceholder: {
    backgroundColor: 'rgba(255,127,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: { marginTop: Spacing.four, marginBottom: Spacing.two },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
    borderRadius: Spacing.four,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    backgroundColor: '#fff',
  },
  photoWrap: { borderRadius: Spacing.four, overflow: 'hidden' },
  photo: { width: '100%', height: 220, borderRadius: Spacing.four },
  changePhoto: {
    position: 'absolute',
    bottom: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.four,
  },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  error: { color: RED, marginTop: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.five },
  actBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.three,
  },
  actText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
