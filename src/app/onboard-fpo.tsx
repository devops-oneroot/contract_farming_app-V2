import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { CameraCapture } from '@/components/camera-capture';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop, FarmAddress, FpoMember, PlaceHit } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

/** The positions actually met in the field. "Other" keeps the list honest. */
const ROLES = ['President', 'Secretary', 'CEO', 'Director', 'Board member', 'Other'];

/**
 * Shrink before keeping: a full-resolution phone photo is several megabytes,
 * which is slow to send on a field connection and pointless for a portrait.
 */
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
 * Register a Farmer Producer Organisation an agronomist has met — or correct
 * one already on record, when `fpoId` is passed.
 *
 * Records the person, not the paperwork: who they are, what they do there,
 * which crops the organisation deals in and how many farmers it covers. The
 * farmer count is what they say on the day — a claim worth capturing, not a
 * number this app can check.
 *
 * One screen for both jobs on purpose: an edit form that drifts from the
 * onboarding form is how a field only the newer one collects goes missing.
 */
export default function OnboardFpoScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const keyboardHeight = useKeyboardHeight();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const { fpoId } = useLocalSearchParams<{ fpoId?: string }>();
  const editing = !!fpoId;
  const [loadingFpo, setLoadingFpo] = useState(editing);
  /** The saved photo, when editing. `photo` below is only a NEW capture. */
  const [savedPhotoUrl, setSavedPhotoUrl] = useState('');

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState('');
  const [otherRole, setOtherRole] = useState('');
  const [crops, setCrops] = useState<string[]>([]);
  /**
   * Anyone else met at the same FPO. Entirely optional, and each row is
   * optional within itself bar the name — a board meeting yields four names
   * long before it yields four phone numbers.
   */
  const [members, setMembers] = useState<FpoMember[]>([]);
  const [farmerCount, setFarmerCount] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [catalog, setCatalog] = useState<CatalogCrop[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * An FPO already holding the number being typed.
   *
   * The server still refuses a duplicate on save — that remains the real
   * guard, and the only one safe against two agents typing at once. This just
   * moves the bad news to before the rest of the form is filled in.
   */
  const [duplicate, setDuplicate] = useState<{
    _id: string;
    name: string;
    role: string;
    address: FarmAddress;
  } | null>(null);

  /**
   * Where they are, and what that place is called.
   *
   * The name is never typed. Ask a field agent to spell "Chamarajanagara" and
   * it will be spelled four ways across four visits, and nothing can be
   * grouped by area afterwards. The coordinates are the record; the name is a
   * reading of them, shown here only so the agent can see it looks right.
   */
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [area, setArea] = useState<FarmAddress | null>(null);
  const [locating, setLocating] = useState(true);
  const [areaNote, setAreaNote] = useState<string | null>(null);
  /** 'gps' when the pin is where they stand, 'search' when they looked it up. */
  const [source, setSource] = useState<'gps' | 'search'>('gps');

  // Place search, for when the FPO is not where the agronomist is.
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [places, setPlaces] = useState<PlaceHit[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [placeSearched, setPlaceSearched] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const [countFocused, setCountFocused] = useState(false);

  /**
   * Bring "How many farmers" back above the keyboard.
   *
   * Deferred by a frame on purpose. Whichever way the room gets made — Android
   * grows the content by the keyboard's height, iOS shrinks the scroll view
   * under it — `scrollToEnd` computes its target from the layout it can see,
   * and asking on the same tick as the keyboard event measures the layout from
   * before that change, landing short by exactly the keyboard's height.
   */
  const revealCount = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (countFocused && keyboardHeight > 0) revealCount();
  }, [countFocused, keyboardHeight, revealCount]);

  useEffect(() => {
    api.listCropCatalog().then(setCatalog).catch(() => {});
  }, []);

  /**
   * Ask only once the number is long enough to be one, and only after a pause
   * — otherwise every digit of a ten-digit number is a request, and the first
   * nine of them are answered "no" about a number nobody has finished typing.
   *
   * A failed check clears the warning rather than showing one: being unable to
   * ask is not evidence of a duplicate.
   */
  useEffect(() => {
    const number = mobile.trim();
    if (!/^\d{7,15}$/.test(number)) {
      setDuplicate(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .checkFpoMobile(number, fpoId)
        .then((r) => setDuplicate(r.fpo ? { ...r.fpo, address: r.fpo.address } : null))
        .catch(() => setDuplicate(null));
    }, 450);
    return () => clearTimeout(t);
  }, [mobile, fpoId]);

  /**
   * Read the position, then ask the server what it is called. Every failure
   * along the way is survivable: without permission there are no coordinates,
   * without the geocoder there is no name, and in both cases the onboarding
   * still goes ahead — just with less to file it under.
   */
  const findArea = useCallback(async () => {
    setLocating(true);
    setAreaNote(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setAreaNote('Location is off, so the area cannot be recorded.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      setSource('gps');

      const res = await api.resolveArea(next.lat, next.lng);
      setArea(res.address);
      if (!res.address) {
        setAreaNote('The area name could not be read, but the location is saved.');
      }
    } catch {
      setAreaNote('Could not get your location. Tap to try again.');
    } finally {
      setLocating(false);
    }
  }, []);

  /**
   * Editing starts from what is on record, and does NOT re-read the location:
   * the agronomist correcting a phone number from the office would otherwise
   * quietly move the FPO to where they are sitting. Changing the area stays a
   * deliberate act — the search and the refresh button are both still there.
   */
  useEffect(() => {
    if (!fpoId) return;
    (async () => {
      try {
        const f = await api.getFpo(fpoId);
        setName(f.name);
        setMobile(f.mobile);
        setRole(ROLES.includes(f.role) ? f.role : f.role ? 'Other' : '');
        setOtherRole(ROLES.includes(f.role) ? '' : f.role);
        setCrops(f.crops ?? []);
        setMembers(f.members ?? []);
        setFarmerCount(f.farmerCount ? String(f.farmerCount) : '');
        setSavedPhotoUrl(f.photoUrl || '');
        if (f.location?.latitude != null && f.location?.longitude != null) {
          setCoords({ lat: f.location.latitude, lng: f.location.longitude });
        }
        if (f.address) setArea(f.address);
        setSource(f.locationSource === 'search' ? 'search' : 'gps');
      } catch (e: any) {
        setError(e?.message || 'Could not load this FPO.');
      } finally {
        setLoadingFpo(false);
        setLocating(false);
      }
    })();
  }, [fpoId]);

  useEffect(() => {
    // A new record locates itself; an existing one keeps the pin it has.
    if (!editing) findArea();
  }, [findArea, editing]);

  /**
   * Nominatim allows one request a second, so a debounce here is a courtesy to
   * a free service as much as it is to the agent's data bundle.
   */
  useEffect(() => {
    if (!placeOpen) return;
    const q = placeQuery.trim();
    if (q.length < 3) {
      setPlaces([]);
      setPlaceSearched(false);
      return;
    }
    setSearchingPlace(true);
    const t = setTimeout(() => {
      api
        .searchPlaces(q)
        .then((r) => setPlaces(r.places))
        .catch(() => setPlaces([]))
        .finally(() => {
          setSearchingPlace(false);
          setPlaceSearched(true);
        });
    }, 450);
    return () => clearTimeout(t);
  }, [placeQuery, placeOpen]);

  /** Taking a searched place replaces both the pin and the area name. */
  const pickPlace = (p: PlaceHit) => {
    setCoords({ lat: p.latitude, lng: p.longitude });
    setArea({
      village: p.village,
      taluk: p.taluk,
      district: p.district,
      state: p.state,
      geocodedAt: null,
    });
    setSource('search');
    setAreaNote(null);
    setPlaceOpen(false);
    setPlaceQuery('');
    setPlaces([]);
    setPlaceSearched(false);
  };

  const toggleCrop = (cropName: string) =>
    setCrops((cs) =>
      cs.includes(cropName) ? cs.filter((c) => c !== cropName) : [...cs, cropName]
    );

  const capture = async (uri: string) => {
    setCameraOpen(false);
    setPhoto(await shrink(uri));
  };

  const addMember = () =>
    setMembers((ms) => [...ms, { name: '', mobile: '', designation: '' }]);

  const patchMember = (i: number, patch: Partial<FpoMember>) =>
    setMembers((ms) => ms.map((m, k) => (k === i ? { ...m, ...patch } : m)));

  const dropMember = (i: number) => setMembers((ms) => ms.filter((_, k) => k !== i));

  const save = async () => {
    if (!user) return;
    const finalRole = (role === 'Other' ? otherRole : role).trim();

    if (!name.trim()) {
      setError("Enter the representative's name.");
      return;
    }
    if (!/^\d{7,15}$/.test(mobile.trim())) {
      setError('Enter a valid mobile number.');
      return;
    }
    const count = farmerCount.trim() ? Number(farmerCount) : 0;
    if (!Number.isFinite(count) || count < 0) {
      setError('How many farmers must be a number.');
      return;
    }
    /**
     * Empty rows are dropped rather than complained about — tapping "Add
     * person" and changing your mind is not a mistake worth a message. A row
     * with only a number, though, is an unfinished thought worth catching.
     */
    const extras = members.filter((m) => m.name.trim() || m.mobile.trim());
    const nameless = extras.findIndex((m) => !m.name.trim());
    if (nameless >= 0) {
      setError(`Person ${nameless + 2} needs a name, or clear their number.`);
      return;
    }

    setSaving(true);
    setError(null);

    const common = {
      name: name.trim(),
      mobile: mobile.trim(),
      role: finalRole,
      crops,
      members: extras.map((m) => ({
        name: m.name.trim(),
        mobile: m.mobile.trim(),
        designation: m.designation.trim(),
      })),
      farmerCount: Math.floor(count),
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      locationSource: coords ? source : null,
      // Only a fresh capture is sent. Omitting it leaves the saved one alone,
      // which is what an edit that did not touch the photo should do.
      photo: photo ? { uri: photo, name: 'fpo.jpg', type: 'image/jpeg' } : null,
    };

    try {
      if (fpoId) {
        const fpo = await api.updateFpo(fpoId, common);
        Alert.alert('Saved ✓', `${fpo.name} has been updated.`, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        const fpo = await api.createFpo({ agronomistId: user._id, ...common });
        Alert.alert('Onboarded ✓', `${fpo.name} has been added.`, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not save this FPO.');
    } finally {
      setSaving(false);
    }
  };

  const field = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScreenHeader
            onBack={() => router.back()}
            title={editing ? 'Edit FPO' : 'Onboard FPO'}
          />

          {loadingFpo ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.body,
              // Android draws the keyboard over the screen rather than resizing
              // it, so the space it takes has to be added to the content.
              { paddingBottom: Spacing.six + (Platform.OS === 'android' ? keyboardHeight : 0) },
            ]}
            // Android makes room by growing the content, so this fires at the
            // one moment the new height is real and a scroll can land on it.
            onContentSizeChange={() => countFocused && revealCount()}
            keyboardShouldPersistTaps="handled">
            <View style={styles.photoRow}>
              {photo || savedPhotoUrl ? (
                <Image
                  source={{ uri: photo ?? savedPhotoUrl }}
                  style={styles.photo}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.photo, styles.photoEmpty]}>
                  <Ionicons name="business-outline" size={30} color={theme.textSecondary} />
                </View>
              )}
              <View style={{ flex: 1, gap: Spacing.two }}>
                <Pressable
                  onPress={() => setCameraOpen(true)}
                  style={({ pressed }) => [styles.photoBtn, pressed && { opacity: 0.85 }]}>
                  <Ionicons name="camera-outline" size={18} color={GREEN} />
                  <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                    {photo || savedPhotoUrl ? 'Retake photo' : 'Take photo'}
                  </ThemedText>
                </Pressable>
                {photo ? (
                  // Discards the new shot only. A saved photo is never deleted
                  // from here — that would be a destructive act behind a word.
                  <Pressable onPress={() => setPhoto(null)} hitSlop={6}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {savedPhotoUrl ? 'Undo — keep the old photo' : 'Remove photo'}
                    </ThemedText>
                  </Pressable>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    Optional.
                  </ThemedText>
                )}
              </View>
            </View>

            {/* Read, not typed. Tappable only to retry, never to edit. */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              Area
            </ThemedText>
            <Pressable
              onPress={locating ? undefined : findArea}
              style={({ pressed }) => [
                styles.areaCard,
                { backgroundColor: theme.backgroundElement },
                pressed && !locating && { opacity: 0.85 },
              ]}>
              <Ionicons
                name={area ? 'location' : 'location-outline'}
                size={18}
                color={area ? GREEN : theme.textSecondary}
              />
              <View style={{ flex: 1 }}>
                {locating ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Finding where you are…
                  </ThemedText>
                ) : area ? (
                  <>
                    <ThemedText type="small" style={{ fontWeight: '700' }}>
                      {[area.village, area.taluk, area.district].filter(Boolean).join(', ') ||
                        'Unnamed place'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                      {source === 'search'
                        ? `Chosen place${area.state ? ` · ${area.state}` : ''}`
                        : area.state || 'Where you are now'}
                    </ThemedText>
                  </>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {areaNote ?? 'Tap to detect the area'}
                  </ThemedText>
                )}
              </View>
              {locating ? (
                <ActivityIndicator color={GREEN} />
              ) : (
                <Ionicons name="refresh" size={16} color={theme.textSecondary} />
              )}
            </Pressable>
            {area && areaNote ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                {areaNote}
              </ThemedText>
            ) : null}

            {/* The agronomist is often not at the FPO — met in town, or filing
                one visited earlier. Searching gives a real place to pick, so
                nothing is stored from what they typed. */}
            <Pressable onPress={() => setPlaceOpen(true)} hitSlop={6} style={styles.areaSwitch}>
              <Ionicons name="search" size={13} color={GREEN} />
              <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                {source === 'search' ? 'Search a different place' : 'FPO is somewhere else?'}
              </ThemedText>
            </Pressable>

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              Name <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
            </ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Representative's name"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="words"
              style={field}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              Mobile number <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
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

            {/* Found before the form is filled in, and offering the one useful
                next move: open the record that already exists. */}
            {duplicate && (
              <Pressable
                onPress={() =>
                  router.replace({
                    pathname: '/onboard-fpo',
                    params: { fpoId: duplicate._id },
                  } as never)
                }
                style={({ pressed }) => [styles.dupCard, pressed && { opacity: 0.85 }]}>
                <Ionicons name="alert-circle" size={20} color={Brand.accent} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="small" style={{ color: Brand.accent, fontWeight: '700' }}>
                    Already onboarded
                  </ThemedText>
                  <ThemedText type="small">
                    {duplicate.name}
                    {duplicate.role ? ` · ${duplicate.role}` : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    {[duplicate.address?.taluk, duplicate.address?.district]
                      .filter(Boolean)
                      .join(', ') || 'Tap to open their record'}
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Brand.accent} />
              </Pressable>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              Role at the FPO
            </ThemedText>
            <View style={styles.chipWrap}>
              {ROLES.map((r) => {
                const on = role === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => setRole(on ? '' : r)}
                    style={[
                      styles.chip,
                      { backgroundColor: on ? GREEN : theme.backgroundElement },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                      {r}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            {role === 'Other' && (
              <TextInput
                value={otherRole}
                onChangeText={setOtherRole}
                placeholder="What is their role?"
                placeholderTextColor={theme.textSecondary}
                style={[...field, { marginTop: Spacing.two }]}
              />
            )}

            {/* Optional throughout. An FPO is a committee, and the agronomist
                often meets three of them at once. */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              Other people at this FPO
            </ThemedText>
            {members.map((m, i) => (
              <View
                key={i}
                style={[styles.memberCard, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.memberHead}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    Person {i + 2}
                  </ThemedText>
                  <Pressable onPress={() => dropMember(i)} hitSlop={10}>
                    <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
                  </Pressable>
                </View>
                <TextInput
                  value={m.name}
                  onChangeText={(v) => patchMember(i, { name: v })}
                  placeholder="Name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  style={[styles.memberInput, { color: theme.text, backgroundColor: screenBg }]}
                />
                <View style={styles.memberRow}>
                  <TextInput
                    value={m.mobile}
                    onChangeText={(v) => patchMember(i, { mobile: v.replace(/[^\d]/g, '') })}
                    placeholder="Number"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                    maxLength={15}
                    style={[
                      styles.memberInput,
                      { flex: 1, color: theme.text, backgroundColor: screenBg },
                    ]}
                  />
                  <TextInput
                    value={m.designation}
                    onChangeText={(v) => patchMember(i, { designation: v })}
                    placeholder="Designation"
                    placeholderTextColor={theme.textSecondary}
                    style={[
                      styles.memberInput,
                      { flex: 1, color: theme.text, backgroundColor: screenBg },
                    ]}
                  />
                </View>
              </View>
            ))}
            <Pressable
              onPress={addMember}
              style={({ pressed }) => [styles.addMemberBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="person-add-outline" size={16} color={GREEN} />
              <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                {members.length ? 'Add another person' : 'Add a person'}
              </ThemedText>
            </Pressable>
            {members.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                Optional. Only a name is needed for each.
              </ThemedText>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              Crops they deal in
            </ThemedText>
            {catalog.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                The crop list could not be loaded. You can still save the rest.
              </ThemedText>
            ) : (
              <View style={styles.chipWrap}>
                {catalog.map((c) => {
                  const on = crops.includes(c.name);
                  return (
                    <Pressable
                      key={c._id}
                      onPress={() => toggleCrop(c.name)}
                      style={[
                        styles.chip,
                        { backgroundColor: on ? GREEN : theme.backgroundElement },
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
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              How many farmers do they handle?
            </ThemedText>
            <TextInput
              value={farmerCount}
              onChangeText={(v) => setFarmerCount(v.replace(/[^\d]/g, ''))}
              placeholder="e.g. 250"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              maxLength={6}
              onFocus={() => setCountFocused(true)}
              onBlur={() => setCountFocused(false)}
              style={field}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Whatever they tell you. It is not checked against anything.
            </ThemedText>

            {error && (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            )}

            {/* Blocked rather than left to fail: the server refuses the same
                number anyway, so offering the button would only waste the
                upload of a photo on a save that cannot succeed. */}
            <Pressable
              onPress={save}
              disabled={saving || !!duplicate}
              style={[styles.saveBtn, { opacity: saving || duplicate ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  {duplicate
                    ? 'This number is already used'
                    : editing
                      ? 'Save changes'
                      : 'Onboard this FPO'}
                </ThemedText>
              )}
            </Pressable>
          </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {cameraOpen && (
        <CameraCapture onCapture={capture} onClose={() => setCameraOpen(false)} />
      )}

      {/* Search to find, tap to choose. What lands in the record is the picked
          place's coordinates — the typing never reaches the database. */}
      <Modal
        visible={placeOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPlaceOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPlaceOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: screenBg }]}>
            <SafeAreaView edges={['bottom']}>
              <View style={styles.sheetBar}>
                <ThemedText type="smallBold">Where is the FPO?</ThemedText>
                <Pressable onPress={() => setPlaceOpen(false)} hitSlop={10}>
                  <Ionicons name="close" size={24} color={theme.text} />
                </Pressable>
              </View>

              <View style={[styles.placeSearch, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="search" size={18} color={theme.textSecondary} />
                <TextInput
                  value={placeQuery}
                  onChangeText={setPlaceQuery}
                  placeholder="Village, taluk or town"
                  placeholderTextColor={theme.textSecondary}
                  autoFocus
                  style={[styles.searchInput, { color: theme.text }]}
                />
                {searchingPlace ? <ActivityIndicator color={GREEN} /> : null}
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" style={styles.placeList}>
                {placeQuery.trim().length < 3 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.placeNote}>
                    Type at least three letters.
                  </ThemedText>
                ) : places.length === 0 && placeSearched && !searchingPlace ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.placeNote}>
                    No place found. Try the taluk or the nearest town.
                  </ThemedText>
                ) : (
                  places.map((p) => (
                    <Pressable
                      key={`${p.latitude},${p.longitude},${p.label}`}
                      onPress={() => pickPlace(p)}
                      style={({ pressed }) => [styles.placeRow, pressed && { opacity: 0.7 }]}>
                      <Ionicons name="location-outline" size={16} color={GREEN} />
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small" style={{ fontWeight: '600' }}>
                          {[p.village, p.taluk, p.district].filter(Boolean).join(', ') || p.label}
                        </ThemedText>
                        {/* The full name disambiguates the half-dozen villages
                            that share one name in a single district. */}
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          numberOfLines={2}
                          style={styles.hint}>
                          {p.label}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  label: { marginTop: Spacing.four },
  hint: { fontSize: 11, marginTop: Spacing.one },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.two,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  areaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginTop: Spacing.two,
  },
  dupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginTop: Spacing.two,
    backgroundColor: Brand.accentSurface,
  },
  memberCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  memberHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memberRow: { flexDirection: 'row', gap: Spacing.two },
  memberInput: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  addMemberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    marginTop: Spacing.two,
  },
  areaSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
    alignSelf: 'flex-start',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    maxHeight: '75%',
  },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  placeSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginHorizontal: Spacing.four,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.three, fontSize: 15 },
  placeList: { paddingHorizontal: Spacing.four, marginTop: Spacing.two },
  placeNote: { paddingVertical: Spacing.four, textAlign: 'center' },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
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
  error: { color: Brand.danger, marginTop: Spacing.three },
  saveBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
});
