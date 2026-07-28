import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop, Crop, PackageOfPractices } from '@/lib/api';

const DAY_MS = 24 * 60 * 60 * 1000;
const GREEN = Brand.primary;
const AMBER = Brand.accent;

function fmt(d: Date) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function dayNumber(dop: string | null) {
  if (!dop) return null;
  return Math.floor((Date.now() - new Date(dop).getTime()) / DAY_MS) + 1;
}

function currentStage(pop: PackageOfPractices | undefined, dayN: number | null) {
  if (!pop) return '—';
  if (dayN == null) return 'Planting date not set';
  if (dayN < 1) return 'Not planted yet';
  if (dayN > pop.durationDays) return 'Cycle complete';
  let cur = pop.steps[0];
  for (const s of pop.steps) {
    if (s.day[0] <= dayN) cur = s;
  }
  return cur.operation;
}

export default function FarmerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { farmerId, name } = useLocalSearchParams<{ farmerId: string; name: string }>();

  const [crops, setCrops] = useState<Crop[]>([]);
  const [catalog, setCatalog] = useState<CatalogCrop[]>([]);
  const [pops, setPops] = useState<Record<string, PackageOfPractices>>({});
  const [geofenceCount, setGeofenceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Farmer's own details, edited from this screen by their agronomist.
  const [farmerName, setFarmerName] = useState('');
  const [farmerMobile, setFarmerMobile] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  // Add a crop, or fill in a planting date that was left blank at onboarding.
  // `cropSheet` is null when closed, holds the crop being edited, or 'new' to add.
  const [cropSheet, setCropSheet] = useState<Crop | 'new' | null>(null);
  const [pickedCrop, setPickedCrop] = useState<CatalogCrop | null>(null);
  const [cropVariety, setCropVariety] = useState('');
  const [cropDop, setCropDop] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  useFocusEffect(
    useCallback(() => {
    (async () => {
      try {
        const [cropList, farmerUser, catalogList] = await Promise.all([
          api.listCrops(farmerId),
          api.getUser(farmerId).catch(() => null),
          api.listCropCatalog().catch(() => []),
        ]);
        setCrops(cropList);
        setCatalog(catalogList);
        setGeofenceCount(farmerUser?.geofence?.length ?? 0);
        if (farmerUser) {
          setFarmerName(farmerUser.name ?? '');
          setFarmerMobile(farmerUser.mobile ?? '');
        }
        // Fetch the schedule for each distinct crop to compute the current stage.
        const names = [...new Set(cropList.map((c) => c.name))];
        const results = await Promise.all(
          names.map((n) => api.getPractices(n).catch(() => null))
        );
        const map: Record<string, PackageOfPractices> = {};
        results.forEach((p, i) => {
          if (p) map[names[i].toLowerCase()] = p;
        });
        setPops(map);
      } catch (e: any) {
        setError(e?.message || 'Could not load this farmer.');
      } finally {
        setLoading(false);
      }
    })();
    }, [farmerId])
  );

  // Each crop's own picture from the admin catalog, matched on name.
  const catalogImage = (name: string) =>
    catalog.find((c) => c.name.toLowerCase() === name.toLowerCase())?.imageUrl;

  const openEdit = () => {
    setEditName(farmerName);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const next = editName.trim();
    if (!next) {
      Alert.alert('Name required', "Please enter the farmer's name.");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateProfile(farmerId, { name: next });
      setFarmerName(updated.name ?? next);
      setEditOpen(false);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const openAddCrop = () => {
    setPickedCrop(null);
    setCropVariety('');
    setCropDop(null);
    setCropSheet('new');
  };

  // Existing crop: prefill so the agronomist only fills in what's missing.
  const openEditCrop = (crop: Crop) => {
    setPickedCrop(catalog.find((c) => c.name.toLowerCase() === crop.name.toLowerCase()) ?? null);
    setCropVariety(crop.variety ?? '');
    setCropDop(crop.dop ? new Date(crop.dop) : null);
    setCropSheet(crop);
  };

  const saveCrop = async () => {
    const editingExisting = cropSheet !== 'new' && cropSheet !== null;
    if (!editingExisting && !pickedCrop) {
      Alert.alert('Pick a crop', 'Please choose which crop this farmer is growing.');
      return;
    }
    setSaving(true);
    try {
      if (editingExisting) {
        const updated = await api.updateCrop(cropSheet._id, {
          variety: cropVariety.trim(),
          dop: cropDop ? cropDop.toISOString() : null,
        });
        setCrops((cs) => cs.map((c) => (c._id === updated._id ? updated : c)));
      } else {
        const created = await api.addCrop(farmerId, {
          name: pickedCrop!.name,
          variety: cropVariety.trim(),
          dop: cropDop ? cropDop.toISOString() : null,
        });
        setCrops((cs) => [created, ...cs]);
        // Pull this crop's schedule in so its stage shows straight away.
        const key = created.name.toLowerCase();
        if (!pops[key]) {
          const pop = await api.getPractices(created.name).catch(() => null);
          if (pop) setPops((p) => ({ ...p, [key]: pop }));
        }
      }
      setCropSheet(null);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">{name ?? 'Farmer'}</ThemedText>
          <View style={{ width: 26 }} />
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.text} />
        ) : (
          <FlatList
            data={crops}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={{ marginBottom: Spacing.three, gap: Spacing.three }}>
                {/* Farmer details — editable by their agronomist */}
                <Pressable onPress={openEdit} style={({ pressed }) => pressed && { opacity: 0.85 }}>
                  <ThemedView type="backgroundElement" style={styles.geoBtn}>
                    <View style={[styles.geoIcon, { backgroundColor: '#2e9e5b' }]}>
                      <ThemedText style={styles.avatarText}>
                        {(farmerName || name || '?').charAt(0).toUpperCase()}
                      </ThemedText>
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">{farmerName || name || 'Farmer'}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {farmerMobile || '—'} · tap to edit
                      </ThemedText>
                    </View>
                    <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
                  </ThemedView>
                </Pressable>

                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/geofence',
                      params: { userId: farmerId, name: farmerName || name || '' },
                    })
                  }
                  style={({ pressed }) => pressed && { opacity: 0.85 }}>
                  <ThemedView type="backgroundElement" style={styles.geoBtn}>
                    <View style={styles.geoIcon}>
                      <Ionicons name="map" size={18} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">Farm boundary (Geofence)</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {geofenceCount >= 3 ? `${geofenceCount} corners set · tap to edit` : 'Not set · tap to draw'}
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </ThemedView>
                </Pressable>
                <View style={styles.cropsHead}>
                  <ThemedText type="smallBold">Crops ({crops.length})</ThemedText>
                  <Pressable
                    onPress={openAddCrop}
                    hitSlop={8}
                    style={({ pressed }) => [styles.addCropBtn, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="add" size={16} color="#fff" />
                    <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                      Add crop
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            }
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText themeColor="textSecondary" type="small">
                  {error ?? 'This farmer has not added any crops yet.'}
                </ThemedText>
              </ThemedView>
            }
            renderItem={({ item }) => {
              const pop = pops[item.name.toLowerCase()];
              const dayN = dayNumber(item.dop);
              const doneCount = (item.progress ?? []).filter((p) => p.done).length;
              const total = pop?.steps.length ?? 0;
              const img = catalogImage(item.name);
              return (
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/practices',
                      params: {
                        cropId: item._id,
                        crop: item.name,
                        dop: item.dop ?? '',
                        variety: item.variety ?? '',
                      },
                    })
                  }
                  style={({ pressed }) => pressed && { opacity: 0.7 }}>
                  <ThemedView type="backgroundElement" style={styles.card}>
                    <View style={styles.cardTop}>
                      {img ? (
                        <Image source={{ uri: img }} style={styles.cropIcon} contentFit="cover" />
                      ) : (
                        // Generic sprout, not a crop-specific emoji: a wrong picture is worse
                        // than a neutral one when the catalog has no image for this crop.
                        <ThemedText style={styles.emoji}>🌱</ThemedText>
                      )}
                      <View style={{ flex: 1 }}>
                        <ThemedText type="smallBold">
                          {item.name}
                          {item.variety ? ` · ${item.variety}` : ''}
                        </ThemedText>
                        {item.dop ? (
                          <ThemedText type="small" themeColor="textSecondary">
                            Planted {fmt(new Date(item.dop))}
                          </ThemedText>
                        ) : (
                          // No planting date means no schedule at all — make fixing it one tap.
                          <Pressable onPress={() => openEditCrop(item)} hitSlop={8}>
                            <View style={styles.fixRow}>
                              <Ionicons name="calendar-outline" size={12} color={AMBER} />
                              <ThemedText type="small" style={styles.fixText}>
                                Planting date not set · tap to add
                              </ThemedText>
                            </View>
                          </Pressable>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                    </View>

                    <View style={styles.statsRow}>
                      <Stat
                        label="Days"
                        value={
                          dayN == null
                            ? '—'
                            : dayN < 1
                              ? '0'
                              : pop
                                ? `${Math.min(dayN, pop.durationDays)}/${pop.durationDays}`
                                : String(dayN)
                        }
                        theme={theme}
                      />
                      <Stat label="Tasks done" value={total ? `${doneCount}/${total}` : String(doneCount)} theme={theme} />
                    </View>

                    <View style={[styles.stageBox, { backgroundColor: theme.background }]}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Current stage
                      </ThemedText>
                      <ThemedText type="smallBold">{currentStage(pop, dayN)}</ThemedText>
                    </View>
                  </ThemedView>
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>

      {/* Edit farmer details */}
      <Modal
        visible={editOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setEditOpen(false)}>
        <ThemedView style={styles.container}>
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
              <View style={styles.topBar}>
                <Pressable onPress={() => setEditOpen(false)} hitSlop={12}>
                  <Ionicons name="close" size={26} color={theme.text} />
                </Pressable>
                <ThemedText type="smallBold">Edit farmer</ThemedText>
                <View style={{ width: 26 }} />
              </View>

              <View style={styles.editBody}>
                <ThemedText type="small" themeColor="textSecondary">
                  Name
                </ThemedText>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Farmer's name"
                  placeholderTextColor={theme.textSecondary}
                  autoFocus
                  autoCapitalize="words"
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                  Mobile {farmerMobile || '—'} can’t be changed — it’s the farmer’s login.
                </ThemedText>

                <Pressable
                  onPress={saveEdit}
                  disabled={saving}
                  style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: '#fff' }}>
                      Save
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </ThemedView>
      </Modal>

      {/* Add a crop, or fill in details missing from an existing one. */}
      <Modal visible={cropSheet !== null} transparent animationType="fade" onRequestClose={() => setCropSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setCropSheet(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <ThemedText type="smallBold" style={{ fontSize: 16 }}>
              {cropSheet === 'new' ? 'Add crop' : `${(cropSheet as Crop)?.name ?? ''} · details`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
              {cropSheet === 'new'
                ? 'Which crop is this farmer growing?'
                : 'Fill in what is missing — the schedule counts from the planting date.'}
            </ThemedText>

            {/* Crop picker — only when adding; an existing crop can't change identity. */}
            {cropSheet === 'new' && (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  Crop
                </ThemedText>
                <View style={styles.chipWrap}>
                  {catalog.map((c) => {
                    const on = pickedCrop?._id === c._id;
                    return (
                      <Pressable
                        key={c._id}
                        onPress={() => {
                          setPickedCrop(on ? null : c);
                          setCropVariety('');
                        }}
                        style={[
                          styles.chip,
                          { backgroundColor: on ? GREEN : theme.backgroundElement, borderColor: on ? GREEN : 'transparent' },
                        ]}>
                        <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                          {c.name}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {/* Variety — from the catalog when it defines any, else free text. */}
            {(pickedCrop?.varieties?.length ?? 0) > 0 ? (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                  Variety
                </ThemedText>
                <View style={styles.chipWrap}>
                  {pickedCrop!.varieties.map((v) => {
                    const on = cropVariety === v;
                    return (
                      <Pressable
                        key={v}
                        onPress={() => setCropVariety(on ? '' : v)}
                        style={[
                          styles.chip,
                          { backgroundColor: on ? GREEN : theme.backgroundElement, borderColor: on ? GREEN : 'transparent' },
                        ]}>
                        <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                          {v}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                  Variety
                </ThemedText>
                <TextInput
                  value={cropVariety}
                  onChangeText={setCropVariety}
                  placeholder="Variety (optional)"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
              </>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
              Date of planting (D.O.P)
            </ThemedText>
            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={[styles.input, styles.dateBtn, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={{ color: cropDop ? theme.text : theme.textSecondary }}>
                {cropDop ? fmt(cropDop) : 'Select the planting date'}
              </ThemedText>
              <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} />
            </Pressable>
            {showDatePicker && (
              <DateTimePicker
                value={cropDop ?? new Date()}
                mode="date"
                maximumDate={new Date()}
                onChange={(event, selected) => {
                  if (Platform.OS !== 'ios') setShowDatePicker(false);
                  if (event.type === 'set' && selected) setCropDop(selected);
                }}
              />
            )}
            {Platform.OS === 'ios' && showDatePicker && (
              <Pressable onPress={() => setShowDatePicker(false)} style={styles.doneBtn}>
                <ThemedText type="linkPrimary">Done</ThemedText>
              </Pressable>
            )}

            <Pressable
              onPress={saveCrop}
              disabled={saving}
              style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  {cropSheet === 'new' ? 'Add crop' : 'Save details'}
                </ThemedText>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

function Stat({ label, value, theme }: { label: string; value: string; theme: any }) {
  return (
    <View style={[styles.stat, { backgroundColor: theme.background }]}>
      <ThemedText type="smallBold">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Crops header + "Add crop", and the add/edit-crop sheet.
  cropsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addCropBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: GREEN,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.four,
  },
  fixRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fixText: { color: AMBER, fontWeight: '700' },
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
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: 6 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Spacing.four,
    borderWidth: 1,
  },
  dateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  doneBtn: { alignItems: 'center', paddingVertical: Spacing.three },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  geoBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  geoIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#2e9e5b', alignItems: 'center', justifyContent: 'center' },
  empty: { padding: Spacing.four, borderRadius: Spacing.three, alignItems: 'center' },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.three },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  emoji: { fontSize: 28 },
  cropIcon: { width: 40, height: 40, borderRadius: Spacing.two },
  statsRow: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.two, gap: 2 },
  stageBox: { padding: Spacing.three, borderRadius: Spacing.two, gap: 2 },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  editBody: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2e9e5b',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.four,
  },
});
