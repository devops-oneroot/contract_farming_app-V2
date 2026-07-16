import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop, Crop, PackageOfPractices } from '@/lib/api';

const DAY_MS = 24 * 60 * 60 * 1000;

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
                <ThemedText type="smallBold">Crops ({crops.length})</ThemedText>
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
                        <ThemedText type="small" themeColor="textSecondary">
                          {item.dop ? `Planted ${fmt(new Date(item.dop))}` : 'Planting date not set'}
                        </ThemedText>
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
