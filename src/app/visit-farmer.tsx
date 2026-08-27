import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  // Core Image, not expo-image: expo-image does not reliably paint a local
  // file:// preview straight off the camera, which left the slots blank.
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { CameraCapture } from '@/components/camera-capture';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { api, GeoPoint, User, VisitSource, visitSourceLabel } from '@/lib/api';

const GREEN = Brand.primary;

/** "Mon, 15 Aug" — a follow-up is a day, so the weekday earns its place. */
const fmtDay = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const GREEN_SURFACE = Brand.surface;

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

// Satellite map showing where the farm is, the boundary if one was drawn, and
// the agronomist's own position so they can see which way to go.
function navMapHtml(target: { lat: number; lng: number }, boundary: GeoPoint[]) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0;padding:0}</style></head>
<body><div id="map"></div><script>
  var T = ${JSON.stringify(target)};
  var B = ${JSON.stringify(boundary)};
  var map = L.map('map',{zoomControl:false,attributionControl:false}).setView([T.lat,T.lng], 16);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20}).addTo(map);
  var layers = [];
  if (B.length >= 3) {
    var poly = L.polygon(B.map(function(p){return [p.latitude,p.longitude]}),
      {color:'#2e9e5b',weight:3,fillOpacity:0.25}).addTo(map);
    layers.push(poly);
    map.fitBounds(poly.getBounds(),{padding:[30,30]});
  } else {
    layers.push(L.marker([T.lat,T.lng]).addTo(map));
  }
  var meDot=null;
  // Called from React Native whenever a GPS fix arrives.
  function showMe(lat,lng){
    if(meDot){map.removeLayer(meDot);}
    meDot=L.circleMarker([lat,lng],{radius:7,color:'#fff',weight:3,fillColor:'#1e88e5',fillOpacity:1}).addTo(map);
    // Frame both the farm and the agronomist so the direction is obvious.
    map.fitBounds(L.latLngBounds([[lat,lng],[T.lat,T.lng]]).pad(0.3));
  }
</script></body></html>`;
}

export default function VisitFarmerScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const params = useLocalSearchParams<{
    farmerId?: string;
    farmerName?: string;
    farmerMobile?: string;
    lat?: string;
    lng?: string;
    /**
     * Set when the visit was started from the Random visit tab. It is the
     * farmer's own "referred by" where one was recorded, and marks the saved
     * visit as one the agronomist chose to make rather than one off the list.
     */
    source?: VisitSource;
  }>();

  const [farmPhoto, setFarmPhoto] = useState<string | null>(null);
  const [farmerPhoto, setFarmerPhoto] = useState<string | null>(null);
  const [cameraFor, setCameraFor] = useState<'farm' | 'farmer' | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    params.lat && params.lng ? { lat: Number(params.lat), lng: Number(params.lng) } : null
  );
  const [locating, setLocating] = useState(false);
  // The farmer's own record — needed for the farm's location and boundary.
  const [farm, setFarm] = useState<User | null>(null);
  const mapRef = useRef<WebView>(null);
  const scrollRef = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight();
  const [notesFocused, setNotesFocused] = useState(false);

  /**
   * Bring the follow-up note back above the keyboard.
   *
   * Deferred by a frame on purpose. Whichever way the room gets made — Android
   * grows the content by the keyboard's height, iOS shrinks the scroll view
   * under it — `scrollToEnd` computes its target from the layout it can see,
   * and asking on the same tick as the keyboard event measures the layout from
   * before that change. It then lands short by exactly the keyboard's height,
   * which is to say it does not move at all.
   */
  const revealNotes = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (notesFocused && keyboardHeight > 0) revealNotes();
  }, [notesFocused, keyboardHeight, revealNotes]);
  /**
   * When to come back. Required: every visit ends by deciding when the next one
   * is, which is what puts the farmer into the "Follow up" list on the Farm
   * Visits screen. Marking that next visit is what clears it again.
   */
  const [followUp, setFollowUp] = useState<Date | null>(null);
  const [followUpNote, setFollowUpNote] = useState('');
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grab a fresh, accurate location on open.
  useEffect(() => {
    (async () => {
      setLocating(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // keep passed-in coords
      } finally {
        setLocating(false);
      }
    })();
  }, []);

  // Load the farmer so we know where their farm actually is.
  useEffect(() => {
    if (!params.farmerId) return;
    api.getUser(params.farmerId).then(setFarm).catch(() => {});
  }, [params.farmerId]);

  const boundary = farm?.geofence ?? [];

  // Where to navigate to: the centre of the drawn boundary is the most accurate
  // point, falling back to the farmer's registered location.
  const target = useMemo(() => {
    if (boundary.length >= 3) {
      return {
        lat: boundary.reduce((s, p) => s + p.latitude, 0) / boundary.length,
        lng: boundary.reduce((s, p) => s + p.longitude, 0) / boundary.length,
      };
    }
    if (farm?.location?.latitude != null && farm?.location?.longitude != null) {
      return { lat: farm.location.latitude, lng: farm.location.longitude };
    }
    return null;
  }, [farm, boundary]);

  // Push our position into the map each time a fix arrives.
  useEffect(() => {
    if (coords && mapRef.current) {
      mapRef.current.injectJavaScript(`showMe(${coords.lat},${coords.lng});true;`);
    }
  }, [coords, target]);

  // Hand off to the device's maps app for actual turn-by-turn navigation.
  const openNavigation = () => {
    if (!target) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open maps', 'No maps app is available on this device.')
    );
  };

  // Photo comes from the in-app camera (expo-camera) — no external camera app,
  // so no Android activity-recreation crash. We upload the capture directly.
  const handleCapture = (uri: string) => {
    if (cameraFor === 'farm') setFarmPhoto(uri);
    else if (cameraFor === 'farmer') setFarmerPhoto(uri);
    setCameraFor(null);
  };

  const markVisited = async () => {
    if (!user || !params.farmerId) return;
    if (!farmPhoto && !farmerPhoto) {
      setError('Please take at least one photo as proof of visit.');
      return;
    }
    if (!followUpNote.trim()) {
      setError('Write your remarks — what came of this visit.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Shrink here rather than at capture, so the preview never waits on it.
      const [farmUri, farmerUri] = await Promise.all([
        farmPhoto ? shrink(farmPhoto) : null,
        farmerPhoto ? shrink(farmerPhoto) : null,
      ]);
      await api.createVisit({
        agronomistId: user._id,
        farmerId: params.farmerId,
        farmerName: params.farmerName,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        source: params.source ?? null,
        nextFollowUpAt: followUp ? followUp.toISOString() : null,
        followUpNote: followUpNote.trim(),
        farmPhoto: farmUri ? { uri: farmUri, name: 'farm.jpg', type: 'image/jpeg' } : undefined,
        farmerPhoto: farmerUri ? { uri: farmerUri, name: 'farmer.jpg', type: 'image/jpeg' } : undefined,
      });
      posthog?.capture('farm_visit_logged', { hasFarmPhoto: !!farmPhoto, hasFarmerPhoto: !!farmerPhoto, hasLocation: !!coords });
      Alert.alert(
        'Visit marked ✓',
        followUp
          ? `${params.farmerName ?? 'Farmer'} marked as visited. They will appear in Follow up on ${fmtDay(followUp)}.`
          // Said plainly, because leaving the date blank also CLEARS any
          // follow-up this farmer was already carrying.
          : `${params.farmerName ?? 'Farmer'} marked as visited. No follow-up is scheduled.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (e: any) {
      setError(e?.message || 'Could not save visit.');
    } finally {
      setSaving(false);
    }
  };

  // A render helper (not a component) so state updates don't remount it.
  const renderPhotoSlot = (
    uri: string | null,
    label: string,
    which: 'farm' | 'farmer',
    icon: keyof typeof Ionicons.glyphMap
  ) => (
    <View style={{ flex: 1 }}>
      <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.one }}>
        {label}
      </ThemedText>
      {uri ? (
        <Pressable onPress={() => setCameraFor(which)}>
          {/* The image sizes itself — a fixed-height parent with overflow:hidden
              was clipping away everything inside it, preview and all. */}
          <Image source={{ uri }} style={styles.photo} resizeMode="cover" />
          <View style={styles.retake}>
            <Ionicons name="camera-reverse" size={14} color="#fff" />
            <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>Retake</ThemedText>
          </View>
        </Pressable>
      ) : (
        <Pressable onPress={() => setCameraFor(which)} style={[styles.photoBtn, { borderColor: GREEN }]}>
          <Ionicons name={icon} size={28} color={GREEN} />
          <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>Take photo</ThemedText>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">Mark Visit</ThemedText>
            <View style={{ width: 26 }} />
          </View>

          <ScrollView
            ref={scrollRef}
            /*
              Android only. The keyboard draws over the screen there rather than
              resizing it, so the space it takes has to be added to the content
              for the last fields to be reachable at all.

              iOS must NOT get this: the KeyboardAvoidingView above already
              shrinks the scroll view by the keyboard's height, and adding the
              same height again as padding left a second keyboard's worth of
              blank space below the button — which `scrollToEnd` then dutifully
              scrolled to, parking the follow-up note off the top of the screen.
            */
            contentContainerStyle={[
              styles.body,
              { paddingBottom: Spacing.six + (Platform.OS === 'android' ? keyboardHeight : 0) },
            ]}
            // Android makes room by growing the content, so this fires at the
            // one moment the new height is real and a scroll can land on it.
            onContentSizeChange={() => notesFocused && revealNotes()}
            keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle">{params.farmerName ?? 'Farmer'}</ThemedText>
            {params.farmerMobile ? (
              <ThemedText type="small" themeColor="textSecondary">{params.farmerMobile}</ThemedText>
            ) : null}
            {/* Confirms what this visit will be recorded as, before the photos
                are taken — it is saved with the visit and cannot be changed. */}
            {params.source ? (
              <View style={styles.sourceChip}>
                <Ionicons name="shuffle" size={13} color={GREEN} />
                <ThemedText type="small" style={styles.sourceChipText}>
                  Random visit · {visitSourceLabel(params.source)}
                </ThemedText>
              </View>
            ) : null}

            {/* Location */}
            <View style={styles.locCard}>
              <Ionicons name="location" size={18} color={GREEN} />
              <ThemedText type="small" style={{ flex: 1 }}>
                {locating
                  ? 'Getting your location…'
                  : coords
                    ? `Location captured (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`
                    : 'Location unavailable'}
              </ThemedText>
              {locating && <ActivityIndicator size="small" color={GREEN} />}
            </View>

            {/* Where the farm is, and a hand-off to turn-by-turn navigation. */}
            {target ? (
              <View style={styles.navCard}>
                <View style={styles.mapWrap}>
                  <WebView
                    ref={mapRef}
                    originWhitelist={['*']}
                    source={{ html: navMapHtml(target, boundary) }}
                    style={styles.map}
                    scrollEnabled={false}
                    javaScriptEnabled
                  />
                </View>
                <Pressable
                  onPress={openNavigation}
                  style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.85 }]}>
                  <Ionicons name="navigate" size={18} color="#fff" />
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Navigate to farm
                  </ThemedText>
                </Pressable>
                <ThemedText type="small" themeColor="textSecondary" style={styles.navNote}>
                  {boundary.length >= 3
                    ? 'Green outline is the farm boundary; the blue dot is you.'
                    : "Using the farmer's registered location — no boundary drawn yet."}
                </ThemedText>
              </View>
            ) : farm ? (
              <View style={styles.locCard}>
                <Ionicons name="alert-circle-outline" size={18} color={Brand.accent} />
                <ThemedText type="small" style={{ flex: 1 }}>
                  No farm location saved for this farmer, so navigation isn&apos;t available.
                </ThemedText>
              </View>
            ) : null}

            {/* Photos */}
            <View style={styles.photoRow}>
              {renderPhotoSlot(farmPhoto, 'Farm photo', 'farm', 'leaf-outline')}
              {renderPhotoSlot(farmerPhoto, 'Photo with farmer', 'farmer', 'people-outline')}
            </View>

            {/* When to come back. Empty means nothing is owed. */}
            <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.four }}>
              Next follow-up
            </ThemedText>
            <Pressable
              onPress={() => setShowFollowUpPicker(true)}
              style={[
                styles.input,
                styles.dateBtn,
                { backgroundColor: theme.backgroundElement },
              ]}>
              <Ionicons
                name="calendar-outline"
                size={18}
                color={followUp ? GREEN : theme.textSecondary}
              />
              <ThemedText style={{ flex: 1, color: followUp ? theme.text : theme.textSecondary }}>
                {followUp ? fmtDay(followUp) : 'Optional — set a date to come back'}
              </ThemedText>
              {/* Once a date is set there has to be a way back out of it, or
                  "optional" only holds until the picker is opened by mistake. */}
              {followUp ? (
                <Pressable onPress={() => setFollowUp(null)} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              )}
            </Pressable>
            {showFollowUpPicker && (
              <DateTimePicker
                value={followUp ?? new Date(Date.now() + 7 * 86400000)}
                mode="date"
                minimumDate={new Date()}
                onChange={(event, selected) => {
                  if (Platform.OS !== 'ios') setShowFollowUpPicker(false);
                  if (event.type === 'set' && selected) setFollowUp(selected);
                }}
              />
            )}
            {Platform.OS === 'ios' && showFollowUpPicker && (
              <Pressable onPress={() => setShowFollowUpPicker(false)} style={styles.doneBtn}>
                <ThemedText type="linkPrimary">Done</ThemedText>
              </Pressable>
            )}
            {/* What came of the visit. Required, and required whether or not a
                date was set: a visit that leaves no word behind is a row in a
                list that nobody can act on, and "no follow-up needed" is itself
                worth writing down. */}
            <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.four }}>
              Remarks from Farm visits 
            </ThemedText>
            <TextInput
              value={followUpNote}
              onChangeText={setFollowUpNote}
              placeholder="What did you find? Why come back?"
              placeholderTextColor={theme.textSecondary}
              multiline
              onFocus={() => setNotesFocused(true)}
              onBlur={() => setNotesFocused(false)}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  minHeight: 80,
                  textAlignVertical: 'top',
                },
              ]}
            />

            {/* The two things most often needed while standing on the farm.
                Both are separate records, so they open their own screens
                rather than being folded into this form. */}
            <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.four }}>
              While you are here
            </ThemedText>
            <View style={styles.actionRow}>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/report-disease',
                    params: { farmerId: params.farmerId, farmerName: params.farmerName ?? '' },
                  } as never)
                }
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}>
                <View style={[styles.actionIcon, { backgroundColor: Brand.dangerSurface }]}>
                  <Ionicons name="bug" size={18} color={Brand.danger} />
                </View>
                <ThemedText type="small" style={styles.actionLabel}>
                  Report crop disease
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/give-product',
                    params: { farmerId: params.farmerId, farmerName: params.farmerName ?? '' },
                  } as never)
                }
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}>
                <View style={[styles.actionIcon, { backgroundColor: Brand.secondarySurface }]}>
                  <Ionicons name="cart" size={18} color={Brand.secondary} />
                </View>
                <ThemedText type="small" style={styles.actionLabel}>
                  Give product
                </ThemedText>
              </Pressable>
            </View>

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <Pressable onPress={markVisited} disabled={saving} style={[styles.submitBtn, { opacity: saving ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>Mark as visited</ThemedText>
                </>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* In-app camera overlay */}
      {cameraFor && <CameraCapture onCapture={handleCapture} onClose={() => setCameraFor(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  doneBtn: { alignSelf: 'flex-end', padding: Spacing.two },
  actionRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#fff',
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontWeight: '700', textAlign: 'center', fontSize: 12 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  // Navigation card: map preview + "Navigate to farm".
  navCard: { marginTop: Spacing.three, gap: Spacing.two },
  mapWrap: {
    height: 200,
    borderRadius: Spacing.four,
    overflow: 'hidden',
    backgroundColor: '#dfe6df',
  },
  map: { flex: 1 },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: GREEN,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  navNote: { textAlign: 'center' },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.four,
    backgroundColor: Brand.surface,
  },
  sourceChipText: { color: GREEN, fontWeight: '700', fontSize: 12 },
  locCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.three,
  },
  photoRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.three },
  photoBtn: {
    height: 140,
    borderRadius: Spacing.four,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  photo: {
    width: '100%',
    height: 140,
    borderRadius: Spacing.four,
    backgroundColor: '#d8d8d8', // shows through only while the file is decoding
  },
  retake: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.four,
  },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  error: { color: '#e5484d', marginTop: Spacing.three },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    marginTop: Spacing.five,
  },
});
