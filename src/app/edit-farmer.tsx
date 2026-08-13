import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraCapture } from '@/components/camera-capture';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop, Crop, FarmingType, User } from '@/lib/api';

const GREEN = Brand.primary;
const UNITS = ['kg', 'quintal', 'ton'];

/** One crop as it is being edited. `_id` is null for a crop not yet created. */
type CropDraft = {
  _id: string | null;
  name: string;
  variety: string;
  farmingType: FarmingType;
  dop: Date | null;
  area: string;
  quantity: string;
  unit: string;
  notes: string;
  /**
   * False once work has been recorded against this crop's Package of Practices.
   * Renaming it then would leave those records pointing at a different
   * schedule, so the server refuses it and we do not offer it.
   */
  renamable: boolean;
  /** The values as loaded, so save can send only what actually changed. */
  original: Crop | null;
};

const toDraft = (c: Crop): CropDraft => ({
  _id: c._id,
  name: c.name,
  variety: c.variety ?? '',
  farmingType: c.farmingType ?? 'contract',
  dop: c.dop ? new Date(c.dop) : null,
  area: c.area != null ? String(c.area) : '',
  quantity: c.quantity != null ? String(c.quantity) : '',
  unit: c.unit || 'kg',
  notes: c.notes ?? '',
  renamable:
    (c.progress?.length ?? 0) === 0 &&
    (c.productProgress?.length ?? 0) === 0 &&
    (c.verifications?.length ?? 0) === 0,
  original: c,
});

const blankDraft = (): CropDraft => ({
  _id: null,
  name: '',
  variety: '',
  farmingType: 'contract',
  dop: null,
  area: '',
  quantity: '',
  unit: 'kg',
  notes: '',
  renamable: true,
  original: null,
});

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Everything about a farmer, edited in one place: their details and every one
 * of their crops, saved together by a single Save button.
 *
 * Previously these lived in two separate sheets, which meant correcting a
 * farmer's record was two round trips through different screens.
 */
export default function EditFarmerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { farmerId } = useLocalSearchParams<{ farmerId: string }>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [farmer, setFarmer] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<CatalogCrop[]>([]);

  // Farmer details
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  /**
   * A newly taken photo, held locally until Save. Null means "leave whatever
   * they already have alone" — never "they have none", which is
   * `farmer.photoUrl` being empty.
   */
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [address, setAddress] = useState({ village: '', taluk: '', district: '', state: '' });
  const [location, setLocation] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });

  // Crops
  const [drafts, setDrafts] = useState<CropDraft[]>([]);
  const [dateFor, setDateFor] = useState<number | null>(null); // index whose picker is open

  useEffect(() => {
    (async () => {
      try {
        const [farmerUser, cropList, catalogList] = await Promise.all([
          api.getUser(farmerId),
          api.listCrops(farmerId).catch(() => [] as Crop[]),
          api.listCropCatalog().catch(() => [] as CatalogCrop[]),
        ]);
        setFarmer(farmerUser);
        setName(farmerUser.name ?? '');
        setMobile(farmerUser.mobile ?? '');
        setAddress({
          village: farmerUser.farmAddress?.village ?? '',
          taluk: farmerUser.farmAddress?.taluk ?? '',
          district: farmerUser.farmAddress?.district ?? '',
          state: farmerUser.farmAddress?.state ?? '',
        });
        setLocation({
          latitude: farmerUser.location?.latitude ?? null,
          longitude: farmerUser.location?.longitude ?? null,
        });
        setCatalog(catalogList);
        setDrafts(cropList.map(toDraft));
      } catch (e: any) {
        setError(e?.message || 'Could not load this farmer.');
      } finally {
        setLoading(false);
      }
    })();
  }, [farmerId]);

  const patchDraft = useCallback((i: number, patch: Partial<CropDraft>) => {
    setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  }, []);

  /**
   * Shrink before keeping: a full-resolution phone photo is several megabytes,
   * which is slow to send on a field connection and pointless for a portrait.
   */
  const capturePhoto = async (uri: string) => {
    setCameraOpen(false);
    try {
      const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
        compress: 0.6,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setPhoto(out.uri);
    } catch {
      // Never lose the shot because the resize failed.
      setPhoto(uri);
    }
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Allow location access to use your current position.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      Alert.alert('Could not get location', 'Please try again in a moment.');
    } finally {
      setLocating(false);
    }
  };

  /**
   * Save the farmer and every changed crop in one go.
   *
   * Each request carries only the fields that actually changed, so saving a
   * corrected acreage cannot disturb the farmer's phone number, and vice versa.
   */
  const saveAll = async () => {
    if (!user || !farmer) return;

    // ---- validate before writing anything ----
    const nextName = name.trim();
    const nextMobile = mobile.trim();
    if (!nextName) return Alert.alert('Name required', "Please enter the farmer's name.");
    if (!/^\d{7,15}$/.test(nextMobile)) {
      return Alert.alert('Check the number', 'Please enter a valid phone number.');
    }
    for (const [i, d] of drafts.entries()) {
      const label = d.name || `Crop ${i + 1}`;
      if (!d.name.trim()) return Alert.alert('Crop missing', `Please choose a crop for ${label}.`);
      if (!(Number(d.area) > 0)) {
        return Alert.alert('Check the area', `${label}: area must be a number greater than 0.`);
      }
      if (d.quantity.trim() && !(Number(d.quantity) >= 0)) {
        return Alert.alert('Check the yield', `${label}: expected yield must be a number.`);
      }
    }

    const farmerBody: Parameters<typeof api.updateFarmerByAgronomist>[2] = {};
    if (nextName !== (farmer.name ?? '')) farmerBody.name = nextName;
    if (nextMobile !== (farmer.mobile ?? '')) farmerBody.mobile = nextMobile;

    const a = farmer.farmAddress;
    if (
      address.village !== (a?.village ?? '') ||
      address.taluk !== (a?.taluk ?? '') ||
      address.district !== (a?.district ?? '') ||
      address.state !== (a?.state ?? '')
    ) {
      farmerBody.farmAddress = address;
    }
    if (
      location.latitude !== (farmer.location?.latitude ?? null) ||
      location.longitude !== (farmer.location?.longitude ?? null)
    ) {
      farmerBody.location = location;
    }

    const commit = async () => {
      setSaving(true);
      try {
        if (Object.keys(farmerBody).length) {
          await api.updateFarmerByAgronomist(user._id, farmerId, farmerBody);
        }

        for (const d of drafts) {
          const contract = d.farmingType === 'contract';
          const plantedOn = contract && d.dop ? d.dop.toISOString() : null;
          const acres = Number(d.area);
          const qty = d.quantity.trim() ? Number(d.quantity) : null;

          if (!d._id) {
            await api.addCrop(farmerId, {
              name: d.name.trim(),
              variety: d.variety.trim(),
              farmingType: d.farmingType,
              area: acres,
              dop: plantedOn,
              quantity: qty,
              unit: d.unit,
              notes: d.notes.trim(),
            });
            continue;
          }

          const o = d.original!;
          const body: Parameters<typeof api.updateCrop>[1] = {};
          if (d.renamable && d.name.trim() !== o.name) body.name = d.name.trim();
          if (d.variety.trim() !== (o.variety ?? '')) body.variety = d.variety.trim();
          if (d.farmingType !== (o.farmingType ?? 'contract')) body.farmingType = d.farmingType;
          if (acres !== o.area) body.area = acres;
          if (qty !== o.quantity) body.quantity = qty;
          if (d.unit !== (o.unit || 'kg')) body.unit = d.unit;
          if (d.notes.trim() !== (o.notes ?? '')) body.notes = d.notes.trim();
          if (plantedOn !== (o.dop ?? null)) body.dop = plantedOn;

          if (Object.keys(body).length) await api.updateCrop(d._id, body);
        }

        /**
         * Last, and on its own terms. It is the only multi-megabyte part of
         * this save, so it is the part most likely to fail on a field
         * connection — and failing it must not throw away the text edits that
         * already went through. On failure we stay put with the photo still
         * held, so Save retries the upload rather than starting over.
         */
        if (photo) {
          try {
            const res = await api.saveFarmerPhoto(farmerId, {
              uri: photo,
              name: 'farmer.jpg',
              type: 'image/jpeg',
            });
            setFarmer((f) => (f ? { ...f, photoUrl: res.photoUrl } : f));
            setPhoto(null);
          } catch (e: any) {
            Alert.alert(
              'Details saved, photo was not',
              e?.message || 'The photo could not be uploaded. Tap Save to try again.'
            );
            return;
          }
        }

        router.back();
      } catch (e: any) {
        Alert.alert('Could not save', e?.message || 'Please try again.');
      } finally {
        setSaving(false);
      }
    };

    // Moving the login number deserves its own yes.
    if (farmerBody.mobile) {
      Alert.alert(
        'Change their login number?',
        `${nextName} will sign in with ${nextMobile} from now on, and ${farmer.mobile || 'the old number'} will stop working.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change it', style: 'destructive', onPress: commit },
        ]
      );
      return;
    }
    await commit();
  };

  const field = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  /**
   * The number fields inside a crop card. The card itself is filled with
   * `backgroundElement`, which is exactly what `field` uses — so those inputs
   * vanish into it. `background` lifts them off the card: white in light mode,
   * and still readable in dark rather than white-on-white.
   */
  const cardField = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="close" size={26} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">Edit farmer</ThemedText>
            <View style={{ width: 26 }} />
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : error ? (
            <ThemedText type="small" style={{ color: Brand.danger, padding: Spacing.four }}>
              {error}
            </ThemedText>
          ) : (
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {/* ---------------- Farmer details ---------------- */}
              <ThemedText type="smallBold" style={styles.section}>
                Farmer details
              </ThemedText>

              {/* Farmers onboarded before the photo existed, or whose shot was
                  skipped in the field, can be given one here. */}
              <View style={styles.photoRow}>
                {photo || farmer?.photoUrl ? (
                  <Image
                    source={{ uri: photo ?? farmer?.photoUrl }}
                    style={styles.photo}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.photo, styles.photoEmpty]}>
                    <Ionicons name="person-outline" size={30} color={theme.textSecondary} />
                  </View>
                )}
                <View style={{ flex: 1, gap: Spacing.two }}>
                  <Pressable
                    onPress={() => setCameraOpen(true)}
                    style={({ pressed }) => [styles.photoBtn, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="camera-outline" size={18} color={GREEN} />
                    <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                      {photo || farmer?.photoUrl ? 'Change photo' : "Take farmer's photo"}
                    </ThemedText>
                  </Pressable>
                  {/* Undoes the new shot only; it never deletes what is saved. */}
                  {photo ? (
                    <Pressable onPress={() => setPhoto(null)} hitSlop={6}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Undo — keep the old photo
                      </ThemedText>
                    </Pressable>
                  ) : (
                    <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                      Uploaded when you tap Save.
                    </ThemedText>
                  )}
                </View>
              </View>

              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                Name
              </ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Farmer's name"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                style={field}
              />

              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                Mobile number
              </ThemedText>
              <TextInput
                value={mobile}
                onChangeText={(v) => setMobile(v.replace(/[^\d]/g, ''))}
                placeholder="10-digit number"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                maxLength={15}
                style={field}
              />
              {mobile.trim() !== (farmer?.mobile ?? '') ? (
                <View style={styles.warnRow}>
                  <Ionicons name="warning-outline" size={14} color={Brand.accent} />
                  <ThemedText type="small" style={{ color: Brand.accent, flex: 1 }}>
                    This is the number they sign in with. The old one stops working.
                  </ThemedText>
                </View>
              ) : null}

              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                Farm address
              </ThemedText>
              {(
                [
                  ['village', 'Village'],
                  ['taluk', 'Taluk'],
                  ['district', 'District'],
                  ['state', 'State'],
                ] as const
              ).map(([key, label]) => (
                <TextInput
                  key={key}
                  value={address[key]}
                  onChangeText={(v) => setAddress((p) => ({ ...p, [key]: v }))}
                  placeholder={label}
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  style={field}
                />
              ))}
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                Filled in from the farm boundary. Anything typed here is kept.
              </ThemedText>

              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                Registered location
              </ThemedText>
              <Pressable
                onPress={useMyLocation}
                disabled={locating}
                style={({ pressed }) => [styles.locBtn, (pressed || locating) && { opacity: 0.7 }]}>
                {locating ? (
                  <ActivityIndicator size="small" color={GREEN} />
                ) : (
                  <Ionicons name="locate" size={16} color={GREEN} />
                )}
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" style={{ color: GREEN }}>
                    Use my current location
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                    {location.latitude != null && location.longitude != null
                      ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
                      : 'Not set — stand on the farm and tap'}
                  </ThemedText>
                </View>
              </Pressable>

              {/* ---------------- Crops ---------------- */}
              <ThemedText type="smallBold" style={styles.section}>
                Crops ({drafts.length})
              </ThemedText>

              {drafts.map((d, i) => (
                <ThemedView key={d._id ?? `new-${i}`} type="backgroundElement" style={styles.cropCard}>
                  <View style={styles.cropHead}>
                    <ThemedText type="smallBold" style={{ flex: 1 }}>
                      {d.name || 'New crop'}
                      {d._id ? '' : ' · not saved yet'}
                    </ThemedText>
                    {/* Only a crop that was never saved can be dropped here;
                        removing a real one is a separate, deliberate action. */}
                    {!d._id ? (
                      <Pressable
                        onPress={() => setDrafts((ds) => ds.filter((_, k) => k !== i))}
                        hitSlop={8}>
                        <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
                      </Pressable>
                    ) : null}
                  </View>

                  {/* Which crop — locked once work has been recorded against it. */}
                  {d.renamable ? (
                    <>
                      <ThemedText type="small" themeColor="textSecondary">
                        Crop
                      </ThemedText>
                      <View style={styles.chipWrap}>
                        {catalog.map((c) => {
                          const on = d.name.toLowerCase() === c.name.toLowerCase();
                          return (
                            <Pressable
                              key={c._id}
                              onPress={() => patchDraft(i, { name: c.name })}
                              style={[
                                styles.chip,
                                {
                                  backgroundColor: on ? GREEN : theme.background,
                                  borderColor: on ? GREEN : 'transparent',
                                },
                              ]}>
                              <ThemedText
                                type="small"
                                style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                                {c.name}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : (
                    <View style={styles.lockRow}>
                      <Ionicons name="lock-closed-outline" size={13} color={theme.textSecondary} />
                      <ThemedText type="small" themeColor="textSecondary" style={styles.lockText}>
                        Work has been recorded against this crop&apos;s schedule, so the crop itself
                        can no longer be changed.
                      </ThemedText>
                    </View>
                  )}

                  <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                    Variety
                  </ThemedText>
                  <TextInput
                    value={d.variety}
                    onChangeText={(v) => patchDraft(i, { variety: v })}
                    placeholder="Variety (optional)"
                    placeholderTextColor={theme.textSecondary}
                    style={field}
                  />

                  <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                    Area (acres) <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
                  </ThemedText>
                  <TextInput
                    value={d.area}
                    onChangeText={(v) => patchDraft(i, { area: v })}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 2.5"
                    placeholderTextColor={theme.textSecondary}
                    style={cardField}
                  />

                  <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                    Farming type
                  </ThemedText>
                  <View style={styles.chipWrap}>
                    {(['contract', 'regular'] as FarmingType[]).map((t) => {
                      const on = d.farmingType === t;
                      return (
                        <Pressable
                          key={t}
                          onPress={() => patchDraft(i, { farmingType: t })}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: on ? GREEN : theme.background,
                              borderColor: on ? GREEN : 'transparent',
                            },
                          ]}>
                          <ThemedText
                            type="small"
                            style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                            {t === 'contract' ? 'Contract farming' : 'Regular farmer'}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Only a contract crop follows a schedule, so only it needs a date. */}
                  {d.farmingType === 'contract' ? (
                    <>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                        Date of planting (D.O.P)
                      </ThemedText>
                      <Pressable
                        onPress={() => setDateFor(i)}
                        style={[styles.input, styles.dateBtn, { backgroundColor: theme.background }]}>
                        <ThemedText style={{ color: d.dop ? theme.text : theme.textSecondary }}>
                          {d.dop ? fmtDate(d.dop) : 'Select the planting date'}
                        </ThemedText>
                        <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} />
                      </Pressable>
                      {dateFor === i ? (
                        <DateTimePicker
                          value={d.dop ?? new Date()}
                          mode="date"
                          maximumDate={new Date()}
                          onChange={(event, selected) => {
                            if (Platform.OS !== 'ios') setDateFor(null);
                            if (event.type === 'set' && selected) patchDraft(i, { dop: selected });
                          }}
                        />
                      ) : null}
                      {Platform.OS === 'ios' && dateFor === i ? (
                        <Pressable onPress={() => setDateFor(null)} style={styles.doneBtn}>
                          <ThemedText type="linkPrimary">Done</ThemedText>
                        </Pressable>
                      ) : null}
                    </>
                  ) : null}

                  <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                    Expected yield (optional)
                  </ThemedText>
                  <View style={styles.qtyRow}>
                    <TextInput
                      value={d.quantity}
                      onChangeText={(v) => patchDraft(i, { quantity: v })}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 1200"
                      placeholderTextColor={theme.textSecondary}
                      style={[...cardField, { flex: 1, minWidth: 110 }]}
                    />
                    <View style={styles.chipWrap}>
                      {UNITS.map((u) => {
                        const on = d.unit === u;
                        return (
                          <Pressable
                            key={u}
                            onPress={() => patchDraft(i, { unit: u })}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: on ? GREEN : theme.background,
                                borderColor: on ? GREEN : 'transparent',
                              },
                            ]}>
                            <ThemedText
                              type="small"
                              style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                              {u}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                    Notes (optional)
                  </ThemedText>
                  <TextInput
                    value={d.notes}
                    onChangeText={(v) => patchDraft(i, { notes: v })}
                    placeholder="Anything worth remembering about this plot"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    style={[...cardField, styles.notesInput]}
                  />
                </ThemedView>
              ))}

              <Pressable
                onPress={() => setDrafts((ds) => [...ds, blankDraft()])}
                style={({ pressed }) => [styles.addCrop, pressed && { opacity: 0.85 }]}>
                <Ionicons name="add" size={18} color={GREEN} />
                <ThemedText type="smallBold" style={{ color: GREEN }}>
                  Add another crop
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={saveAll}
                disabled={saving}
                style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}>
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Save all changes
                  </ThemedText>
                )}
              </Pressable>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {cameraOpen && (
        <CameraCapture onCapture={capturePhoto} onClose={() => setCameraOpen(false)} />
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
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.one },
  section: { fontSize: 16, marginTop: Spacing.four, marginBottom: Spacing.two },
  label: { marginTop: Spacing.two },
  hint: { fontSize: 12 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  photo: { width: 84, height: 84, borderRadius: Spacing.three, backgroundColor: '#d8d8d8' },
  photoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.primarySurface,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    marginTop: Spacing.one,
  },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  doneBtn: { alignSelf: 'flex-end', padding: Spacing.two },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 1,
  },
  cropCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginBottom: Spacing.three,
    gap: Spacing.one,
  },
  cropHead: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.two },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  lockText: { flex: 1, fontSize: 12 },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: Brand.accentSurface,
  },
  locBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: `${Brand.primary}55`,
    backgroundColor: Brand.primarySurface,
    marginTop: Spacing.one,
  },
  addCrop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `${Brand.primary}66`,
  },
  saveBtn: {
    marginTop: Spacing.four,
    backgroundColor: GREEN,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
});
