import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePostHog } from 'posthog-react-native';

import { AgronomistHome } from '@/components/agronomist-home';
import { CallFab } from '@/components/call-fab';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop, Crop, PackageOfPractices, PopStep } from '@/lib/api';

// App accent + surface colors (green agri theme).
const GREEN = '#2e9e5b';
const GREEN_SURFACE = '#E7F5EC';

// Home banner carousel images.
const BANNER_IMAGES = [
  require('@/assets/images/img4.png'),
  require('@/assets/images/img2.png'),
  require('@/assets/images/img3.png'),
];

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (base: Date, n: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};

const monthYear = (dop: string | null) =>
  dop ? new Date(dop).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '';

// Coarse growth stage from the crop's day count vs its POP duration.
function cropStage(dop: string | null, pop?: PackageOfPractices): { label: string; color: string } {
  const AMBER = '#f59e0b';
  const BLUE = '#1e88e5';
  if (!dop) return { label: 'Sowing', color: AMBER };
  const dayN = Math.floor((Date.now() - new Date(dop).getTime()) / DAY_MS) + 1;
  if (dayN < 1) return { label: 'Sowing', color: AMBER };
  const dur = pop?.durationDays ?? 0;
  const pct = dur ? (dayN / dur) * 100 : 0;
  if (!pop || pct < 10) return { label: 'Sowing', color: AMBER };
  if (pct < 65) return { label: 'Vegetative', color: GREEN };
  if (pct < 95) return { label: 'Active', color: GREEN };
  return { label: 'Harvest', color: BLUE };
}

// Home branches by role: agronomists see the farmer list, farmers see their crops.
export default function HomeScreen() {
  const { user } = useAuth();
  if (user?.role === 'agronomist') return <AgronomistHome />;
  return <FarmerHome />;
}

// Emoji fallback for a farmer's crop cards when no catalog image is handy.
const CROP_EMOJI: Record<string, string> = { Turmeric: '🫚' };

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function FarmerHome() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();

  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;
  const today = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const helpPrompt = () =>
    Alert.alert('Need help?', 'Call our farming support team.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call 9606031878', onPress: () => Linking.openURL('tel:9606031878').catch(() => {}) },
    ]);

  const { width } = useWindowDimensions();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [catalog, setCatalog] = useState<CatalogCrop[]>([]);
  const [pops, setPops] = useState<Record<string, PackageOfPractices>>({});
  const [agronomistName, setAgronomistName] = useState<string | null>(null);
  const [agronomistMobile, setAgronomistMobile] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const carouselRef = useRef<ScrollView>(null);
  const slideRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-crop modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<'select' | 'details'>('select');
  const [selectedCrop, setSelectedCrop] = useState<CatalogCrop | null>(null);
  const [variety, setVariety] = useState('');
  const [varietyOpen, setVarietyOpen] = useState(false);
  const [area, setArea] = useState('');
  const [dop, setDop] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [data, cat, me] = await Promise.all([
        api.listCrops(user._id),
        api.listCropCatalog().catch(() => []),
        api.getUser(user._id).catch(() => null),
      ]);
      setCrops(data);
      setCatalog(cat);
      setAgronomistName(me?.agronomist?.name ?? null);
      setAgronomistMobile(me?.agronomist?.mobile ?? null);
      // Fetch each distinct crop's Package of Practices (for upcoming milestones).
      const names = [...new Set(data.map((c) => c.name))];
      const results = await Promise.all(names.map((n) => api.getPractices(n).catch(() => null)));
      const map: Record<string, PackageOfPractices> = {};
      results.forEach((p, i) => {
        if (p) map[names[i].toLowerCase()] = p;
      });
      setPops(map);
    } catch (e: any) {
      setError(e?.message || 'Could not load crops.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-advance the banner carousel every ~3.5s (loops).
  useEffect(() => {
    if (!width) return;
    const id = setInterval(() => {
      const next = (slideRef.current + 1) % BANNER_IMAGES.length;
      slideRef.current = next;
      carouselRef.current?.scrollTo({ x: next * width, animated: true });
      setSlide(next);
    }, 3500);
    return () => clearInterval(id);
  }, [width]);

  // Next scheduled POP steps across all crops, as dated milestones.
  const milestones = useMemo(() => {
    const now = Date.now();
    const out: { date: Date; op: string; crop: string; cropId: string; dop: string; step: PopStep }[] = [];
    for (const c of crops) {
      if (!c.dop) continue;
      const pop = pops[c.name.toLowerCase()];
      if (!pop) continue;
      const base = new Date(c.dop);
      for (const s of pop.steps) {
        const date = addDays(base, s.day[0] - 1);
        if (date.getTime() >= now)
          out.push({ date, op: s.operation, crop: c.name, cropId: c._id, dop: c.dop, step: s });
      }
    }
    out.sort((a, b) => a.date.getTime() - b.date.getTime());
    return out.slice(0, 5);
  }, [crops, pops]);

  // Open a milestone's day-detail page (what to do + products for that day).
  const openDay = (m: { cropId: string; crop: string; dop: string; step: PopStep }) =>
    router.push({
      pathname: '/products',
      params: {
        cropId: m.cropId,
        crop: m.crop,
        dop: m.dop,
        stepStart: String(m.step.day[0]),
        stepEnd: String(m.step.day[1]),
        stepLabel: m.step.operation,
        stepDetails: m.step.details,
        stepCategory: m.step.category,
        stepProducts: JSON.stringify(m.step.products ?? []),
      },
    });

  const openPractices = (item: Crop) =>
    router.push({
      pathname: '/practices',
      params: { cropId: item._id, crop: item.name, dop: item.dop ?? '', variety: item.variety ?? '' },
    });

  const catalogImage = (name: string) =>
    catalog.find((c) => c.name.toLowerCase() === name.toLowerCase())?.imageUrl;

  const openModal = () => {
    setStep('select');
    setSelectedCrop(null);
    setVariety('');
    setVarietyOpen(false);
    setArea('');
    setDop(null);
    setError(null);
    setModalOpen(true);
  };

  const pickCrop = (c: CatalogCrop) => {
    setSelectedCrop(c);
    setVariety('');
    setStep('details');
  };

  const saveCrop = async () => {
    if (!user || !selectedCrop) return;
    if (!dop) {
      setError('Date of Planting is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.addCrop(user._id, {
        name: selectedCrop.name,
        variety: variety.trim(),
        area: area ? Number(area) : null,
        dop: dop.toISOString(),
      });
      setCrops((prev) => [created, ...prev]);
      posthog?.capture('crop_added', {
        crop: selectedCrop.name,
        variety: variety.trim(),
        has_planting_date: !!dop,
      });
      setModalOpen(false);
    } catch (e: any) {
      setError(e?.message || 'Could not add crop.');
    } finally {
      setSaving(false);
    }
  };

  const onDateChange = (event: { type: string }, selected?: Date) => {
    // On Android the picker is a dialog and must be dismissed after interaction.
    if (Platform.OS !== 'ios') setShowDatePicker(false);
    if (event.type === 'set' && selected) setDop(selected);
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <ThemedText style={styles.avatarText}>
              {user?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </ThemedText>
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" style={styles.welcome}>
              Welcome, {user?.name ?? 'Farmer'}!
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {today}
            </ThemedText>
          </View>
          <Pressable onPress={helpPrompt} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="help-circle-outline" size={24} color={theme.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => Alert.alert('Notifications', 'You have no new notifications.')}
            hitSlop={8}
            style={styles.iconBtn}>
            <Ionicons name="notifications-outline" size={22} color={theme.textSecondary} />
            <View style={styles.bellDot} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          {/* Banner image carousel */}
          <View style={styles.carousel}>
            <ScrollView
              ref={carouselRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const i = Math.round(e.nativeEvent.contentOffset.x / width);
                slideRef.current = i;
                setSlide(i);
              }}>
              {BANNER_IMAGES.map((src, i) => (
                <View key={i} style={{ width, paddingHorizontal: Spacing.four }}>
                  <Image source={src} style={styles.bannerImg} contentFit="cover" />
                </View>
              ))}
            </ScrollView>
            <View style={styles.dots}>
              {BANNER_IMAGES.map((_, i) => (
                <View key={i} style={[styles.dot, i === slide && styles.dotActive]} />
              ))}
            </View>
          </View>

          {/* Single Add Crop button */}
          <Pressable onPress={openModal} style={styles.addCropBtn}>
            <Ionicons name="add-circle" size={20} color="#fff" />
            <ThemedText type="smallBold" style={{ color: '#fff' }}>
              Add Crop
            </ThemedText>
          </Pressable>

          {/* My crops */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            My Crops ({crops.length})
          </ThemedText>
          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.four }} color={GREEN} />
          ) : crops.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.empty}>
              <ThemedText themeColor="textSecondary" type="small">
                No crops yet. Tap “Add Crop” to add one.
              </ThemedText>
              {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
            </ThemedView>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cropRow}>
              {crops.map((item) => {
                const img = catalogImage(item.name);
                const stage = cropStage(item.dop, pops[item.name.toLowerCase()]);
                const details =
                  [
                    item.variety || null,
                    item.area != null ? `${item.area} Acres` : null,
                    monthYear(item.dop) || null,
                  ]
                    .filter(Boolean)
                    .join(' / ') || 'Details not set';
                return (
                  <Pressable
                    key={item._id}
                    onPress={() => openPractices(item)}
                    style={({ pressed }) => pressed && { opacity: 0.85 }}>
                    <ThemedView style={styles.cropCard2}>
                      {img ? (
                        <Image source={{ uri: img }} style={styles.cropCardIcon} contentFit="cover" />
                      ) : (
                        <ThemedText style={styles.cropCardEmoji}>{CROP_EMOJI[item.name] ?? '🌱'}</ThemedText>
                      )}
                      <ThemedText type="smallBold" style={styles.cropCardName} numberOfLines={1}>
                        {item.name}
                      </ThemedText>
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        numberOfLines={2}
                        style={styles.cropCardDetails}>
                        {details}
                      </ThemedText>
                      <View style={[styles.stageBadge, { backgroundColor: `${stage.color}22` }]}>
                        <ThemedText type="small" style={{ color: stage.color, fontWeight: '600' }}>
                          {stage.label}
                        </ThemedText>
                        <View style={[styles.stageDot, { backgroundColor: stage.color }]} />
                      </View>

                      <View style={[styles.cropCardFooter, { borderTopColor: theme.backgroundElement }]}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Agronomist
                        </ThemedText>
                        <View style={styles.agroRow}>
                          <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                            {agronomistName ?? 'Not assigned'}
                          </ThemedText>
                          {agronomistMobile ? (
                            <Pressable
                              onPress={() => Linking.openURL(`tel:${agronomistMobile}`).catch(() => {})}
                              hitSlop={8}
                              style={styles.agroCall}>
                              <Ionicons name="call" size={14} color="#fff" />
                            </Pressable>
                          ) : null}
                        </View>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {item.name}
                        </ThemedText>
                      </View>
                    </ThemedView>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* Upcoming milestones (from each crop's Package of Practices) */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Upcoming Milestones
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.milestoneCard}>
            {milestones.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No upcoming milestones yet. Add a planting date to your crops to see their schedule.
              </ThemedText>
            ) : (
              milestones.map((m, i) => (
                <Pressable
                  key={i}
                  onPress={() => openDay(m)}
                  style={({ pressed }) => [
                    styles.milestoneRow,
                    pressed && { opacity: 0.6 },
                    i < milestones.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.background,
                    },
                  ]}>
                  <ThemedText type="small" style={styles.milestoneDate}>
                    {m.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </ThemedText>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {m.op} <ThemedText type="small" themeColor="textSecondary">({m.crop})</ThemedText>
                  </ThemedText>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                </Pressable>
              ))
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>

      {/* Floating support-call button */}
      <CallFab />

      {/* Add crop — full screen */}
      <Modal
        visible={modalOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setModalOpen(false)}>
        <View style={[styles.container, { backgroundColor: screenBg }]}>
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.sheetTopBar}>
              {step === 'details' ? (
                <Pressable onPress={() => setStep('select')} hitSlop={10}>
                  <Ionicons name="chevron-back" size={26} color={theme.text} />
                </Pressable>
              ) : (
                <View style={{ width: 26 }} />
              )}
              <ThemedText type="smallBold">
                {step === 'select' ? 'Add Crop' : selectedCrop?.name}
              </ThemedText>
              <Pressable onPress={() => setModalOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={26} color={theme.text} />
              </Pressable>
            </View>

            {step === 'select' ? (
              catalog.length === 0 ? (
                <ThemedView type="backgroundElement" style={[styles.empty, { margin: Spacing.four }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    No crops available yet. Please check back soon.
                  </ThemedText>
                </ThemedView>
              ) : (
                <ScrollView contentContainerStyle={styles.sheetBody}>
                  <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.two }}>
                    Select a crop to add
                  </ThemedText>
                  <View style={styles.cropGrid}>
                    {catalog.map((c) => (
                      <Pressable
                        key={c._id}
                        onPress={() => pickCrop(c)}
                        style={[styles.cropTile, { backgroundColor: theme.backgroundElement }]}>
                        {c.imageUrl ? (
                          <Image source={{ uri: c.imageUrl }} style={styles.cropTileImg} contentFit="cover" />
                        ) : (
                          <ThemedText style={styles.cropTileEmoji}>🌱</ThemedText>
                        )}
                        <ThemedText type="small" style={{ fontWeight: '600', textAlign: 'center' }}>
                          {c.name}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )
            ) : (
              <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
                {/* Variety — dropdown of the crop's varieties */}
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  Variety
                </ThemedText>
                {selectedCrop && selectedCrop.varieties.length > 0 ? (
                  <>
                    <Pressable
                      onPress={() => setVarietyOpen((o) => !o)}
                      style={[styles.input, styles.dateBtn, { backgroundColor: theme.backgroundElement }]}>
                      <View style={styles.dropdownRow}>
                        <ThemedText style={{ color: variety ? theme.text : theme.textSecondary }}>
                          {variety || 'Select variety'}
                        </ThemedText>
                        <Ionicons
                          name={varietyOpen ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={theme.textSecondary}
                        />
                      </View>
                    </Pressable>
                    {varietyOpen && (
                      <View style={[styles.dropdown, { backgroundColor: theme.backgroundElement }]}>
                        {selectedCrop.varieties.map((v) => (
                          <Pressable
                            key={v}
                            onPress={() => {
                              setVariety(v);
                              setVarietyOpen(false);
                            }}
                            style={styles.dropdownItem}>
                            <ThemedText type="small">{v}</ThemedText>
                            {variety === v && <Ionicons name="checkmark" size={16} color="#2e9e5b" />}
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <TextInput
                    value={variety}
                    onChangeText={setVariety}
                    placeholder="e.g. Salem (optional)"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                )}

                {/* Area — optional */}
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  Area in acres (optional)
                </ThemedText>
                <TextInput
                  value={area}
                  onChangeText={setArea}
                  keyboardType="numeric"
                  placeholder="e.g. 5"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />

                {/* D.O.P — mandatory */}
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  D.O.P (Date of Planting) <ThemedText style={{ color: '#e5484d' }}>*</ThemedText>
                </ThemedText>
                <Pressable
                  onPress={() => setShowDatePicker(true)}
                  style={[styles.input, styles.dateBtn, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={{ color: dop ? theme.text : theme.textSecondary }}>
                    {dop ? formatDate(dop) : '📅 Select date (required)'}
                  </ThemedText>
                </Pressable>

                {showDatePicker && (
                  <DateTimePicker
                    value={dop ?? new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={onDateChange}
                  />
                )}
                {Platform.OS === 'ios' && showDatePicker && (
                  <Pressable onPress={() => setShowDatePicker(false)} style={styles.cancelBtn}>
                    <ThemedText type="linkPrimary">Done</ThemedText>
                  </Pressable>
                )}

                {error && (
                  <ThemedText type="small" style={[styles.error, { marginTop: Spacing.two }]}>
                    {error}
                  </ThemedText>
                )}

                <Pressable
                  onPress={saveCrop}
                  disabled={saving}
                  style={[styles.saveBtnFull, { opacity: saving ? 0.6 : 1 }]}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: '#fff' }}>
                      Save crop
                    </ThemedText>
                  )}
                </Pressable>
              </ScrollView>
            )}
            </KeyboardAvoidingView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  carousel: { marginHorizontal: -Spacing.four },
  bannerImg: { width: '100%', height: 170, borderRadius: Spacing.four },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: Spacing.two },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(46,158,91,0.3)' },
  dotActive: { width: 18, backgroundColor: GREEN },
  addCropBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: GREEN,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  sectionTitle: { fontSize: 16, marginTop: Spacing.one },
  cropRow: { gap: Spacing.three, paddingVertical: Spacing.one, paddingRight: Spacing.four },
  cropCard2: {
    width: 185,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cropCardIcon: { width: 40, height: 40, borderRadius: Spacing.two },
  cropCardEmoji: { fontSize: 34 },
  cropCardName: { fontSize: 20 },
  cropCardDetails: { minHeight: 34 },
  stageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Spacing.four,
  },
  stageDot: { width: 8, height: 8, borderRadius: 4 },
  cropCardFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    marginTop: Spacing.one,
  },
  agroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  agroCall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneCard: { borderRadius: Spacing.three, padding: Spacing.one },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  milestoneDate: { minWidth: 52, color: GREEN, fontWeight: '700' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  welcome: { fontSize: 16 },
  iconBtn: { padding: 4 },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e5484d',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#2e9e5b',
    borderRadius: Spacing.four,
    padding: Spacing.four,
    marginBottom: Spacing.four,
  },
  bannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: { color: '#fff', fontSize: 16 },
  bannerSub: { color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  cropsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  addBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  list: { gap: Spacing.two, paddingBottom: BottomTabInset + Spacing.four },
  empty: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
  },
  cropCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderLeftWidth: 3,
    borderLeftColor: '#2e9e5b',
  },
  cropEmojiWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(46,158,91,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropEmoji: { fontSize: 26 },
  cropThumb: { width: 46, height: 46, borderRadius: 23 },
  chevWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(46,158,91,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: '#e5484d' },
  sheetTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  sheetBody: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  saveBtnFull: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    padding: Spacing.four,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    gap: Spacing.one,
    paddingBottom: Spacing.six,
    maxHeight: '90%',
  },
  cropGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    marginVertical: Spacing.three,
  },
  cropTile: {
    width: 96,
    height: 100,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: 4,
  },
  cropTileEmoji: { fontSize: 40 },
  cropTileImg: { width: 52, height: 52, borderRadius: Spacing.two },
  detailsImg: { width: 40, height: 40, borderRadius: Spacing.two },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  fieldLabel: { marginTop: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  dateBtn: { justifyContent: 'center' },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdown: { borderRadius: Spacing.two, marginTop: Spacing.one, overflow: 'hidden' },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  modalActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.four },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
