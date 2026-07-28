import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop, FarmingType } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

const FARMING_TYPES: { value: FarmingType; label: string; desc: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  {
    value: 'contract',
    label: 'Contract farming',
    desc: 'Follows the Package of Practices',
    icon: 'document-text-outline',
  },
  {
    value: 'regular',
    label: 'Regular farmer',
    desc: 'Registered only — no schedule',
    icon: 'leaf-outline',
  },
];

/** One crop the farmer grows, as filled in on this screen before saving. */
type DraftCrop = {
  /** Local list key only — these do not exist server-side until save. */
  key: string;
  name: string;
  imageUrl: string;
  variety: string;
  farmingType: FarmingType;
  /** Kept as typed text; parsed once, on save. */
  area: string;
  dop: Date | null;
};

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "Turmeric · Salem · 2.5 acres · Planted 20 Jun 2026" */
function describe(c: DraftCrop) {
  return [
    c.variety || null,
    `${c.area.trim()} acres`,
    c.farmingType === 'regular' ? 'Regular' : c.dop ? `Planted ${formatDate(c.dop)}` : 'Contract',
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function OnboardFarmerScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [catalog, setCatalog] = useState<CatalogCrop[]>([]);
  const [crops, setCrops] = useState<DraftCrop[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The crop sheet — one crop at a time, so each gets its own area and dates.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedCrop, setSelectedCrop] = useState<CatalogCrop | null>(null);
  const [variety, setVariety] = useState('');
  const [varietyOpen, setVarietyOpen] = useState(false);
  const [farmingType, setFarmingType] = useState<FarmingType>('contract');
  const [area, setArea] = useState('');
  const [dop, setDop] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  useEffect(() => {
    api.listCropCatalog().then(setCatalog).catch(() => {});
  }, []);

  const openSheet = () => {
    setSelectedCrop(null);
    setVariety('');
    setVarietyOpen(false);
    setFarmingType('contract');
    setArea('');
    setDop(null);
    setShowDatePicker(false);
    setSheetError(null);
    setSheetOpen(true);
  };

  const pickCrop = (c: CatalogCrop) => {
    setSelectedCrop((prev) => (prev?._id === c._id ? null : c));
    setVariety('');
    setVarietyOpen(false);
  };

  const onDateChange = (event: { type: string }, selected?: Date) => {
    if (Platform.OS !== 'ios') setShowDatePicker(false);
    if (event.type === 'set' && selected) setDop(selected);
  };

  const addCrop = () => {
    if (!selectedCrop) {
      setSheetError('Please choose a crop.');
      return;
    }
    if (!area.trim()) {
      setSheetError('Please enter the area for this crop.');
      return;
    }
    if (!(Number(area) > 0)) {
      setSheetError('Area must be a number greater than 0.');
      return;
    }
    setCrops((cs) => [
      ...cs,
      {
        key: `${selectedCrop._id}-${cs.length}-${selectedCrop.name}`,
        name: selectedCrop.name,
        imageUrl: selectedCrop.imageUrl,
        variety: variety.trim(),
        farmingType,
        area: area.trim(),
        dop: farmingType === 'contract' ? dop : null,
      },
    ]);
    setError(null);
    setSheetOpen(false);
  };

  const removeCrop = (key: string) => setCrops((cs) => cs.filter((c) => c.key !== key));

  const save = async () => {
    if (!user) return;
    if (!name.trim() || !mobile.trim()) {
      setError('Name and mobile are required.');
      return;
    }
    if (crops.length === 0) {
      setError('Please add at least one crop this farmer is growing.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.onboardFarmer(user._id, {
        name: name.trim(),
        mobile: mobile.trim(),
        crops: crops.map((c) => ({
          name: c.name,
          variety: c.variety,
          farmingType: c.farmingType,
          area: c.area.trim() ? Number(c.area) : null,
          // A regular crop follows no schedule, so a planting date would mean nothing.
          dop: c.farmingType === 'contract' && c.dop ? c.dop.toISOString() : null,
        })),
      });
      posthog?.capture('farmer_onboarded', {
        crop_count: crops.length,
        crops: crops.map((c) => c.name),
        contract_count: crops.filter((c) => c.farmingType === 'contract').length,
        total_area: crops.reduce((s, c) => s + (Number(c.area) || 0), 0),
      });
      const farmerId = res.farmer?._id;
      const farmerName = res.farmer?.name ?? name.trim();
      // Offer to draw the farm boundary right away for the newly-onboarded farmer.
      Alert.alert('Farmer onboarded ✓', 'Mark this farmer’s farm boundary now?', [
        { text: 'Later', style: 'cancel', onPress: () => router.back() },
        {
          text: 'Draw boundary',
          onPress: () =>
            farmerId
              ? router.replace({ pathname: '/geofence', params: { userId: farmerId, name: farmerName } })
              : router.back(),
        },
      ]);
    } catch (e: any) {
      setError(e?.message || 'Could not onboard farmer.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  const totalArea = crops.reduce((s, c) => s + (Number(c.area) || 0), 0);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">Onboard Farmer</ThemedText>
            <View style={{ width: 26 }} />
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Farmer name <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
            </ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Full name"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Mobile <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
            </ThemedText>
            <TextInput
              value={mobile}
              onChangeText={setMobile}
              keyboardType="phone-pad"
              placeholder="10-digit mobile"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />

            {/* Crops — one entry per crop, each with its own area and schedule. */}
            <View style={styles.cropsHead}>
              <ThemedText type="small" themeColor="textSecondary">
                Crops <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
                {crops.length > 0 ? ` (${crops.length})` : ''}
              </ThemedText>
              {totalArea > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  {totalArea} acres total
                </ThemedText>
              )}
            </View>

            {crops.map((c) => (
              <View key={c.key} style={[styles.cropRow, { backgroundColor: theme.backgroundElement }]}>
                {c.imageUrl ? (
                  <Image source={{ uri: c.imageUrl }} style={styles.cropRowImg} contentFit="cover" />
                ) : (
                  <ThemedText style={styles.cropRowEmoji}>🌱</ThemedText>
                )}
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{c.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {describe(c)}
                  </ThemedText>
                </View>
                <Pressable onPress={() => removeCrop(c.key)} hitSlop={10}>
                  <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>
            ))}

            <Pressable
              onPress={openSheet}
              style={({ pressed }) => [styles.addCropBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="add-circle-outline" size={20} color={GREEN} />
              <ThemedText type="smallBold" style={{ color: GREEN }}>
                {crops.length === 0 ? 'Add crop' : 'Add another crop'}
              </ThemedText>
            </Pressable>

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  Onboard farmer
                </ThemedText>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* One crop at a time: crop, variety, farming type, area, planting date. */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: screenBg }]}>
            <View style={styles.sheetBar}>
              <Pressable onPress={() => setSheetOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
              <ThemedText type="smallBold">Add crop</ThemedText>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <ThemedText type="small" themeColor="textSecondary">
                Crop <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
              </ThemedText>
              {catalog.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                  No crops available.
                </ThemedText>
              ) : (
                <View style={styles.chipWrap}>
                  {catalog.map((c) => {
                    const on = selectedCrop?._id === c._id;
                    return (
                      <Pressable
                        key={c._id}
                        onPress={() => pickCrop(c)}
                        style={[styles.chip, { backgroundColor: on ? GREEN : theme.backgroundElement }]}>
                        {c.imageUrl ? (
                          <Image source={{ uri: c.imageUrl }} style={styles.chipImg} contentFit="cover" />
                        ) : null}
                        <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                          {c.name}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Variety dropdown (when the catalog defines any for this crop) */}
              {selectedCrop && selectedCrop.varieties.length > 0 && (
                <>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                    Variety
                  </ThemedText>
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
                          {variety === v && <Ionicons name="checkmark" size={16} color={GREEN} />}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </>
              )}

              {selectedCrop && (
                <>
                  {/* Area for THIS crop — a farmer's crops sit on different plots. */}
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                    Area (acres) <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
                  </ThemedText>
                  <TextInput
                    value={area}
                    onChangeText={setArea}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 2.5"
                    placeholderTextColor={theme.textSecondary}
                    style={inputStyle}
                  />

                  {/* Contract or regular — decides whether this crop gets a schedule. */}
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                    Farming type <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
                  </ThemedText>
                  <View style={styles.typeWrap}>
                    {FARMING_TYPES.map((t) => {
                      const on = farmingType === t.value;
                      return (
                        <Pressable
                          key={t.value}
                          onPress={() => setFarmingType(t.value)}
                          style={[
                            styles.typeCard,
                            {
                              backgroundColor: on ? Brand.primarySurface : theme.backgroundElement,
                              borderColor: on ? GREEN : 'transparent',
                            },
                          ]}>
                          <Ionicons name={t.icon} size={20} color={on ? GREEN : theme.textSecondary} />
                          <ThemedText type="small" style={{ fontWeight: '700', color: on ? GREEN : theme.text }}>
                            {t.label}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" style={styles.typeDesc}>
                            {t.desc}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              {/* D.O.P — contract crops only: it is what the schedule counts from. */}
              {selectedCrop && farmingType === 'contract' && (
                <>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                    D.O.P (Date of Planting)
                  </ThemedText>
                  <Pressable
                    onPress={() => setShowDatePicker(true)}
                    style={[styles.input, styles.dateBtn, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText style={{ color: dop ? theme.text : theme.textSecondary }}>
                      {dop ? formatDate(dop) : '📅 Select date'}
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
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    The Package of Practices counts from this date. It can be filled in later.
                  </ThemedText>
                </>
              )}

              {sheetError && <ThemedText type="small" style={styles.error}>{sheetError}</ThemedText>}

              <Pressable onPress={addCrop} style={styles.saveBtn}>
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  Add crop
                </ThemedText>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  fieldLabel: { marginTop: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  cropsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  cropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  cropRowImg: { width: 40, height: 40, borderRadius: Spacing.two },
  cropRowEmoji: { fontSize: 28, width: 40, textAlign: 'center' },
  addCropBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: GREEN,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  chipImg: { width: 22, height: 22, borderRadius: 11 },
  typeWrap: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  typeCard: {
    flex: 1,
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 2,
  },
  typeDesc: { fontSize: 11, lineHeight: 15 },
  hint: { marginTop: Spacing.two, fontSize: 12 },
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
  cancelBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three },
  error: { color: Brand.danger, marginTop: Spacing.two },
  saveBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    overflow: 'hidden',
  },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  sheetBody: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
});
