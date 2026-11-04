import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop, Farmer, FarmingType, Fpo, VISIT_SOURCES, VisitSource } from '@/lib/api';
import { asMobile, digitsOf, MOBILE_DIGITS } from '@/lib/mobile';
import { useOnboardingRecorder } from '@/lib/onboarding-recorder';
import { CameraCapture } from '@/components/camera-capture';
import * as ImageManipulator from 'expo-image-manipulator';

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
  /**
   * The farmer already on this number, once ten digits have been typed.
   *
   * Onboarding a number that exists does not fail — the server links that
   * farmer to this agronomist and keeps their crops and history. That is
   * usually what was wanted, but only if the agent knows it is what is about to
   * happen, so it is said before they save rather than after.
   */
  const [existing, setExisting] = useState<Farmer | null>(null);
  const [checking, setChecking] = useState(false);
  /** How this farmer reached us. Null until one is picked, and it stays optional. */
  const [referredBy, setReferredBy] = useState<VisitSource | null>(null);
  const [catalog, setCatalog] = useState<CatalogCrop[]>([]);
  const [crops, setCrops] = useState<DraftCrop[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Look the number up as soon as it is complete.
   *
   * Debounced, because a ten-digit number passes through nine incomplete states
   * on the way in and none of them is worth a request. The match is confirmed
   * on the digits rather than trusted from the search: the server's search also
   * looks at names and addresses, and a village whose name contains those digits
   * would otherwise be reported as a duplicate farmer.
   */
  useEffect(() => {
    const digits = digitsOf(mobile);
    if (digits.length !== MOBILE_DIGITS) {
      setExisting(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const found = await api.listAllFarmers({ search: digits });
        setExisting(found.find((f) => digitsOf(f.mobile) === digits) ?? null);
      } catch {
        // A failed check must never block onboarding — the server checks again
        // on save, and that is the one that decides.
        setExisting(null);
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [mobile]);

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

  // The conversation is recorded from the moment this screen opens until the
  // farmer is saved, so it captures exactly what produced the registration.
  const recorder = useOnboardingRecorder();
  // Optional photo of the farmer. Held locally until the farmer is saved, then
  // uploaded — the registration must never depend on it.
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  /**
   * The farmer's FPO. Searched first so the same organisation is not typed in
   * five different ways across five farmers; only offered as new once nothing
   * matches what has been typed.
   */
  const [fbo, setFbo] = useState<Fpo | null>(null);
  const [fboQuery, setFboQuery] = useState('');
  const [fboResults, setFboResults] = useState<Fpo[]>([]);
  const [fboSearching, setFboSearching] = useState(false);

  /**
   * Bringing the FPO field above the keyboard.
   *
   * Android has run edge-to-edge since SDK 54, so the keyboard is drawn OVER
   * the window rather than shrinking it, and `KeyboardAvoidingView` has no
   * behaviour to apply there. A field partway down the form ends up underneath
   * it with no way to scroll further, because there is no content below to
   * scroll to. Two things fix that: real padding the height of the keyboard,
   * and scrolling the field to the top of what is left.
   */
  const scrollRef = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight();
  const fboY = useRef(0);
  const [fboFocused, setFboFocused] = useState(false);

  const revealFbo = useCallback(() => {
    // A frame's delay so the padding below has been applied before the offset
    // is computed against it.
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: Math.max(fboY.current - 24, 0), animated: true })
    );
  }, []);

  useEffect(() => {
    if (fboFocused && keyboardHeight > 0) revealFbo();
  }, [fboFocused, keyboardHeight, revealFbo]);

  useEffect(() => {
    api.listCropCatalog().then(setCatalog).catch(() => {});
    recorder.begin();
    // Starting once on mount is the whole point; re-running would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /**
   * Open the planting-date picker.
   *
   * Android goes through the imperative API rather than rendering the
   * declarative component. This field lives inside the crop sheet, which is a
   * React Native <Modal>, and a picker mounted in there puts its native dialog
   * behind the modal window — the tap appears to do nothing and the date never
   * changes. `DateTimePickerAndroid.open` shows the dialog above everything.
   *
   * `maximumDate` is today: a planting date is when the crop went in, so it is
   * always in the past. Crops sown weeks or months ago are the normal case.
   */
  const openDopPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dop ?? new Date(),
        mode: 'date',
        maximumDate: new Date(),
        onChange: (event, selected) => {
          if (event.type === 'set' && selected) setDop(selected);
        },
      });
      return;
    }
    setShowDatePicker(true);
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
        fpoId: fbo?._id ?? null,
        referredBy,
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

      // Same contract as the voice recording: the farmer is already saved, so a
      // failed photo upload is reported but never undoes the registration.
      if (farmerId && photo) {
        api
          .saveFarmerPhoto(farmerId, { uri: photo, name: 'farmer.jpg', type: 'image/jpeg' })
          .catch(() =>
            Alert.alert(
              'Photo not saved',
              'The farmer was registered, but their photo could not be uploaded.'
            )
          );
      }

      // Stop the moment the farmer is saved, then attach the file. The upload is
      // not allowed to fail the registration, but a silent failure is worse than
      // none — the agent is told so the recording can be chased up.
      if (farmerId) {
        recorder
          .finishAndUpload(farmerId)
          .then((ok) => {
            if (!ok) Alert.alert('Recording not saved', 'The farmer was registered, but the voice recording could not be uploaded.');
          })
          .catch(() => {});
      }

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

  /**
   * Look up FPOs as the agronomist types, debounced so a name is one request
   * rather than one per keystroke. Skipped entirely once one is chosen — the
   * question has been answered.
   */
  useEffect(() => {
    const q = fboQuery.trim();
    if (fbo || q.length < 2) {
      setFboResults([]);
      return;
    }
    let live = true;
    setFboSearching(true);
    const t = setTimeout(() => {
      api
        // The FPOs agronomists have actually onboarded, not the old lookup
        // tags — those were never filled in, so the box always came back empty.
        .listFpos({ search: q })
        .then((rs) => live && setFboResults(rs))
        .catch(() => live && setFboResults([]))
        .finally(() => live && setFboSearching(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fboQuery, fbo]);


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

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  const totalArea = crops.reduce((s, c) => s + (Number(c.area) || 0), 0);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScreenHeader
            onBack={() => router.back()}
            title="Onboard Farmer"
          />

          <ScrollView
            ref={scrollRef}
            // The keyboard's height becomes real space at the foot of the form,
            // so there is somewhere to scroll to once it opens.
            contentContainerStyle={[styles.body, { paddingBottom: Spacing.six + keyboardHeight }]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => fboFocused && revealFbo()}>
            {/* Never record silently — the agent and the farmer can both see it. */}
            {recorder.recording ? (
              <View style={[styles.recBar, { backgroundColor: Brand.dangerSurface }]}>
                <View style={styles.recDot} />
                <ThemedText type="small" style={{ flex: 1, color: theme.text }}>
                  Recording this conversation · {Math.floor(recorder.durationMillis / 60000)}:
                  {String(Math.floor((recorder.durationMillis % 60000) / 1000)).padStart(2, '0')}
                </ThemedText>
              </View>
            ) : recorder.error || recorder.permitted === false ? (
              <View style={[styles.recBar, { backgroundColor: Brand.accentSurface }]}>
                <Ionicons name="mic-off-outline" size={16} color={Brand.accent} />
                <ThemedText type="small" style={{ flex: 1, color: theme.text }}>
                  Not recording — {recorder.error ?? 'microphone permission was declined'}.
                </ThemedText>
              </View>
            ) : null}

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

            {/* Optional portrait. No asterisk: a farmer who would rather not be
                photographed still has to be registerable. */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Farmer photo
            </ThemedText>
            {photo ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
                <View style={{ flex: 1, gap: Spacing.two }}>
                  <Pressable
                    onPress={() => setCameraOpen(true)}
                    style={({ pressed }) => [styles.photoAction, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="camera-outline" size={16} color={GREEN} />
                    <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                      Retake
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setPhoto(null)}
                    style={({ pressed }) => [styles.photoAction, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="trash-outline" size={16} color={Brand.danger} />
                    <ThemedText type="small" style={{ color: Brand.danger, fontWeight: '700' }}>
                      Remove
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => setCameraOpen(true)}
                style={({ pressed }) => [styles.photoAdd, pressed && { opacity: 0.85 }]}>
                <View style={styles.photoAddIcon}>
                  <Ionicons name="camera" size={20} color={GREEN} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">Take farmer&apos;s photo</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                    Optional — helps recognise them on the next visit
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </Pressable>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Mobile <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
            </ThemedText>
            <TextInput
              value={mobile}
              onChangeText={(v) => setMobile(asMobile(v))}
              keyboardType="phone-pad"
              maxLength={MOBILE_DIGITS}
              placeholder="10-digit mobile"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />

            {/* Who is already on this number. Not an error: saving will link
                that farmer to this agronomist, with their crops and history
                intact. It only has to be said before it happens. */}
            {checking ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.checkLine}>
                Checking this number…
              </ThemedText>
            ) : existing ? (
              <View style={styles.dupBox}>
                <Ionicons name="person-circle" size={20} color={Brand.accent} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" style={{ color: Brand.accent }}>
                    {existing.name || 'This farmer'} is already registered
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                    {[
                      existing.farmAddress?.village,
                      existing.farmAddress?.taluk,
                      existing.cropCount ? `${existing.cropCount} crop${existing.cropCount > 1 ? 's' : ''}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No farm details recorded yet'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                    Saving will move them to you and keep everything they have.
                  </ThemedText>
                </View>
                {/* Straight to them, for the common case: the agent only wanted
                    to find someone they had already registered. */}
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/farmer',
                      params: { farmerId: existing._id, name: existing.name },
                    })
                  }
                  hitSlop={8}
                  style={({ pressed }) => [styles.dupOpen, pressed && { opacity: 0.8 }]}>
                  <ThemedText type="small" style={{ color: Brand.accent, fontWeight: '700' }}>
                    Open
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            {/*
              How this farmer reached us. Optional — a farmer who turns up
              through no particular channel is still a farmer, and forcing a
              guess here would only fill the field with noise.
            */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Referred by
            </ThemedText>
            <View style={styles.refWrap}>
              {VISIT_SOURCES.map(({ key, label }) => {
                const on = referredBy === key;
                return (
                  <Pressable
                    key={key}
                    // Tapping the chosen one again clears it, which is the only
                    // way back to "not answered" once something is picked.
                    onPress={() => setReferredBy(on ? null : key)}
                    style={[
                      styles.refChip,
                      {
                        backgroundColor: on ? Brand.primarySurface : theme.backgroundElement,
                        borderColor: on ? GREEN : 'transparent',
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{ color: on ? GREEN : theme.text, fontWeight: on ? '700' : '500' }}>
                      {label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {/* FPO — search first, add only if nothing matches. */}
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.fieldLabel}
              // Where the section starts, measured once laid out, so focusing
              // the input can scroll exactly here.
              onLayout={(e) => {
                fboY.current = e.nativeEvent.layout.y;
              }}>
              FPO
            </ThemedText>
            {fbo ? (
              <View style={styles.fboPicked}>
                <View style={styles.fboIcon}>
                  <Ionicons name="business" size={18} color={GREEN} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {fbo.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {[fbo.mobile, fbo.address?.taluk, fbo.address?.district]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                </View>
                <Pressable onPress={() => setFbo(null)} hitSlop={10}>
                  <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.fboSearch}>
                  <Ionicons name="search" size={16} color={theme.textSecondary} />
                  <TextInput
                    value={fboQuery}
                    onChangeText={setFboQuery}
                    placeholder="Search FPO name"
                    placeholderTextColor={theme.textSecondary}
                    autoCorrect={false}
                    onFocus={() => setFboFocused(true)}
                    onBlur={() => setFboFocused(false)}
                    style={[styles.fboSearchInput, { color: theme.text }]}
                  />
                  {fboSearching ? <ActivityIndicator size="small" color={GREEN} /> : null}
                </View>

                {fboResults.map((r) => (
                  <Pressable
                    key={r._id}
                    onPress={() => {
                      setFbo(r);
                      setFboQuery('');
                    }}
                    style={({ pressed }) => [styles.fboResult, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="business-outline" size={16} color={theme.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <ThemedText type="small" style={{ fontWeight: '600' }} numberOfLines={1}>
                        {r.name}
                      </ThemedText>
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        style={{ fontSize: 11 }}
                        numberOfLines={1}>
                        {[r.mobile, r.address?.taluk, r.address?.district]
                          .filter(Boolean)
                          .join(' · ')}
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}

                {/* No quick-add any more: an FPO is a real record now, with
                    a number, a role and a location. Creating one from a bare
                    name here would produce a half-record nobody could ring. */}
                {fboQuery.trim().length >= 2 && !fboSearching && fboResults.length === 0 ? (
                  <View style={styles.fboAdd}>
                    <Ionicons name="information-circle-outline" size={18} color={theme.textSecondary} />
                    <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                      No FPO found. Onboard them from Home → My FPOs first, then come back.
                    </ThemedText>
                  </View>
                ) : null}
              </>
            )}

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
                    onPress={openDopPicker}
                    style={[styles.input, styles.dateBtn, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText style={{ color: dop ? theme.text : theme.textSecondary }}>
                      {dop ? formatDate(dop) : '📅 Select date'}
                    </ThemedText>
                  </Pressable>
                  {/* iOS only — Android uses the imperative dialog above. */}
                  {Platform.OS === 'ios' && showDatePicker && (
                    <DateTimePicker
                      value={dop ?? new Date()}
                      mode="date"
                      display="spinner"
                      maximumDate={new Date()}
                      onChange={onDateChange}
                    />
                  )}
                  {Platform.OS === 'ios' && showDatePicker && (
                    <Pressable onPress={() => setShowDatePicker(false)} style={styles.cancelBtn}>
                      <ThemedText type="linkPrimary">Done</ThemedText>
                    </Pressable>
                  )}
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    When the crop was actually sown — weeks or months back is normal. The Package
                    of Practices counts from this date, and it can be filled in later.
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

      {cameraOpen && (
        <CameraCapture onCapture={capturePhoto} onClose={() => setCameraOpen(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  recBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Brand.danger },
  checkLine: { marginTop: Spacing.two, fontSize: 12 },
  /** Who already holds this number — a warning to read, not an error to fix. */
  dupBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: `${Brand.accent}55`,
    backgroundColor: Brand.accentSurface,
  },
  dupOpen: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.four,
    backgroundColor: '#fff',
  },
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
  // Wraps, unlike the two-up farming-type row: five labels of very different
  // lengths do not divide into equal columns without ugly truncation.
  refWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  refChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 2,
  },
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
  fboSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  fboSearchInput: { flex: 1, paddingVertical: Spacing.three, fontSize: 15 },
  fboResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.one,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  fboAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `${Brand.primary}66`,
  },
  fboPicked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: Brand.primarySurface,
    borderWidth: 1,
    borderColor: `${Brand.primary}44`,
  },
  fboIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  photo: { width: 84, height: 84, borderRadius: Spacing.three },
  photoAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.two,
  },
  photoAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `${Brand.primary}66`,
  },
  photoAddIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
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
