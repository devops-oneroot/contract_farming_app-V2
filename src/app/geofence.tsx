import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { api, GeoPoint, User } from '@/lib/api';

const GREEN = '#2e9e5b';
// Tutorial video shown before drawing (raw Cloudinary MP4 so we can slow it down).
// Leave '' to show the illustrated guide instead.
const TUTORIAL_VIDEO_URL = 'https://res.cloudinary.com/dz23idc5e/video/upload/video_yzz2b7.mp4';
const TUTORIAL_SPEED = 0.7; // play a bit slower so farmers can follow along
const DEFAULT_CENTER: [number, number] = [15.3173, 75.7139]; // Karnataka, India

/** Live GPS position of the person holding the phone. `accuracy` is a radius in metres. */
type Me = { latitude: number; longitude: number; accuracy: number };

// Leaflet map (satellite tiles, no API key) that lets the farmer tap corners to draw a polygon.
function mapHtml(center: [number, number], initial: GeoPoint[]) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body,#map{height:100%;margin:0;padding:0}
  .info{position:absolute;top:10px;left:10px;right:10px;z-index:1000;background:rgba(0,0,0,0.65);color:#fff;padding:9px 12px;border-radius:10px;font-family:sans-serif;font-size:13px;text-align:center}
  .controls{position:absolute;bottom:18px;left:0;right:0;z-index:1000;display:flex;gap:10px;justify-content:center}
  .btn{background:#fff;border:none;padding:11px 18px;border-radius:22px;font-family:sans-serif;font-weight:700;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,0.35)}
</style></head><body>
<div class="info" id="info">Tap each corner of your farm on the map</div>
<div id="map"></div>
<div class="controls">
  <button class="btn" id="meBtn" onclick="recenterMe()" style="display:none">◎ My location</button>
  <button class="btn" onclick="undo()">↶ Undo</button>
  <button class="btn" onclick="clearAll()">✕ Clear</button>
</div>
<script>
  var CENTER = ${JSON.stringify(center)};
  var pts = ${JSON.stringify(initial)};
  var map = L.map('map',{zoomControl:false}).setView(CENTER, 17);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,attribution:''}).addTo(map);
  // Own pane for the "you are here" dot: keeps it above the polygon (which is redrawn on
  // every tap) and lets taps fall through to the map so corners can be marked underneath it.
  map.createPane('me');
  map.getPane('me').style.zIndex = 650;
  map.getPane('me').style.pointerEvents = 'none';
  var markers=[], poly=null, meDot=null, meRing=null;
  function post(){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({points:pts})); }
  function info(){
    document.getElementById('info').innerText = pts.length===0
      ? (meDot ? 'The blue dot is you — tap each corner of your farm' : 'Tap each corner of your farm on the map')
      : pts.length + ' corner(s)' + (pts.length>=3?' — tap Save above':' (need at least 3)');
  }
  function render(){
    markers.forEach(function(m){map.removeLayer(m)}); markers=[];
    if(poly){map.removeLayer(poly); poly=null;}
    pts.forEach(function(p){ markers.push(L.circleMarker([p.latitude,p.longitude],{radius:6,color:'#fff',weight:2,fillColor:'#2e9e5b',fillOpacity:1}).addTo(map)); });
    if(pts.length>=2){ poly=L.polygon(pts.map(function(p){return [p.latitude,p.longitude]}),{color:'#2e9e5b',weight:3,fillOpacity:0.25}).addTo(map); }
    info();
    post();
  }
  // Called from React Native each time a GPS fix arrives. acc = accuracy radius in metres.
  function showMe(lat,lng,acc){
    if(meRing){map.removeLayer(meRing); meRing=null;}
    if(meDot){map.removeLayer(meDot); meDot=null;}
    if(acc>0){ meRing=L.circle([lat,lng],{pane:'me',radius:acc,stroke:false,fillColor:'#1e88e5',fillOpacity:0.15}).addTo(map); }
    meDot=L.circleMarker([lat,lng],{pane:'me',radius:7,color:'#fff',weight:3,fillColor:'#1e88e5',fillOpacity:1}).addTo(map);
    document.getElementById('meBtn').style.display='block';
    info();
  }
  function recenterMe(){ if(meDot){ map.setView(meDot.getLatLng(), Math.max(map.getZoom(),18)); } }
  map.on('click', function(e){ pts.push({latitude:e.latlng.lat, longitude:e.latlng.lng}); render(); });
  function undo(){ pts.pop(); render(); }
  function clearAll(){ pts=[]; render(); }
  if(pts.length){ map.setView([pts[0].latitude,pts[0].longitude],17); }
  render();
</script></body></html>`;
}

export default function GeofenceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user, signIn } = useAuth();
  // When opened from onboarding, `userId` targets a specific farmer; otherwise self.
  const { userId, name } = useLocalSearchParams<{ userId?: string; name?: string }>();
  const targetId = userId || user?._id || '';
  const isSelf = targetId === user?._id;

  const [phase, setPhase] = useState<'intro' | 'draw'>('intro');
  const [target, setTarget] = useState<User | null>(isSelf ? user : null);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [points, setPoints] = useState<GeoPoint[]>(isSelf ? user?.geofence ?? [] : []);
  const [saving, setSaving] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const pointsRef = useRef<GeoPoint[]>(isSelf ? user?.geofence ?? [] : []);
  const webRef = useRef<WebView>(null);

  // Resolve the target user (self or the onboarded farmer), initial points, and map center,
  // then keep a live "you are here" dot on the map so the farmer can tell which field is theirs.
  useEffect(() => {
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const t = isSelf ? user ?? null : await api.getUser(targetId).catch(() => null);
      if (cancelled) return;
      setTarget(t);
      const gf = t?.geofence ?? [];
      setPoints(gf);
      pointsRef.current = gf;

      // Centre on what we already know first, so the map paints while GPS is still warming up.
      let known: [number, number] | null = null;
      if (gf.length) known = [gf[0].latitude, gf[0].longitude];
      else if (t?.location?.latitude != null && t?.location?.longitude != null) {
        known = [t.location.latitude, t.location.longitude];
      }
      if (known) setCenter(known);

      let granted = false;
      try {
        granted = (await Location.requestForegroundPermissionsAsync()).status === 'granted';
      } catch {
        // ignore
      }
      if (cancelled) return;

      if (!known) {
        let fallback = DEFAULT_CENTER;
        if (granted) {
          try {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            fallback = [pos.coords.latitude, pos.coords.longitude];
          } catch {
            // ignore
          }
        }
        if (cancelled) return;
        setCenter(fallback);
      }

      if (!granted) return;
      // Watch rather than read once: farmers walk the boundary while tapping corners.
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 2 },
        (pos) =>
          setMe({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 0,
          }),
        () => {
          // ignore
        }
      );
      if (cancelled) sub.remove();
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  // Injected, not passed through `mapHtml`: rebuilding the HTML would reload the WebView and
  // wipe any corners drawn so far.
  // The typeof guard covers a fix landing before the map's own script has run; onLoadEnd re-pushes.
  const pushMe = (m: Me) =>
    webRef.current?.injectJavaScript(
      `if(typeof showMe==='function'){showMe(${m.latitude},${m.longitude},${m.accuracy});}true;`
    );

  useEffect(() => {
    if (me) pushMe(me);
  }, [me]);

  const onMessage = (e: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (Array.isArray(data.points)) {
        pointsRef.current = data.points;
        setPoints(data.points);
      }
    } catch {
      // ignore
    }
  };

  const save = async () => {
    if (!targetId) return;
    const pts = pointsRef.current;
    if (pts.length < 3) {
      Alert.alert('Add more corners', 'Mark at least 3 corners to form the farm boundary.');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateProfile(targetId, { geofence: pts });
      posthog?.capture('geofence_saved', { corners: pts.length, forSelf: isSelf });
      if (isSelf) await signIn(updated); // keep own auth user in sync
      Alert.alert('Saved ✓', 'The farm boundary has been saved.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Could not save', err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Intro / tutorial phase ----
  if (phase === 'intro') {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">Farm boundary</ThemedText>
            <View style={{ width: 26 }} />
          </View>

          <View style={styles.introBody}>
            {/* Tutorial video (or illustrated guide if no video is set) */}
            {TUTORIAL_VIDEO_URL ? (
              <View style={styles.video}>
                <WebView
                  source={{
                    html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>html,body{margin:0;background:#000;height:100%}video{width:100%;height:100%;object-fit:contain}</style></head><body>
<video id="v" src="${TUTORIAL_VIDEO_URL}" controls autoplay playsinline></video>
<script>
  var v=document.getElementById('v');
  function slow(){ try{ v.playbackRate=${TUTORIAL_SPEED}; }catch(e){} }
  v.addEventListener('loadedmetadata', slow);
  v.addEventListener('ratechange', function(){ if(v.playbackRate!==${TUTORIAL_SPEED}) slow(); });
  v.addEventListener('play', slow);
  slow();
</script></body></html>`,
                  }}
                  style={{ flex: 1, backgroundColor: '#000' }}
                  allowsInlineMediaPlayback
                  allowsFullscreenVideo
                  mediaPlaybackRequiresUserAction={false}
                />
              </View>
            ) : (
              <View style={[styles.video, styles.videoPlaceholder]}>
                <Ionicons name="play-circle" size={54} color="#fff" />
                <ThemedText style={{ color: '#fff', marginTop: Spacing.two }}>
                  Tutorial video
                </ThemedText>
              </View>
            )}

            <ThemedText type="subtitle" style={{ marginTop: Spacing.four }}>
              {name ? `Mark ${name}'s farm boundary` : 'Mark your farm boundary'}
            </ThemedText>
            <View style={{ gap: Spacing.two, marginTop: Spacing.two }}>
              {[
                'The blue dot is where you are standing — find your farm around it.',
                'Tap each corner of your field, one by one.',
                'The green shape is your boundary — Undo/Clear to fix it.',
                'Tap Save when the whole field is enclosed.',
              ].map((t, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepNum}>
                    <ThemedText style={styles.stepNumText}>{i + 1}</ThemedText>
                  </View>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {t}
                  </ThemedText>
                </View>
              ))}
            </View>

            <Pressable onPress={() => setPhase('draw')} style={styles.startBtn}>
              <Ionicons name="location" size={18} color="#fff" />
              <ThemedText type="smallBold" style={{ color: '#fff' }}>
                Start drawing
              </ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  // ---- Draw phase ----
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => setPhase('intro')} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">
            {name ? `${name}'s farm` : 'Draw your farm'} ({points.length})
          </ThemedText>
          <Pressable onPress={save} disabled={saving} hitSlop={12}>
            {saving ? (
              <ActivityIndicator color={GREEN} />
            ) : (
              <ThemedText type="smallBold" style={{ color: GREEN }}>
                Save
              </ThemedText>
            )}
          </Pressable>
        </View>

        {center ? (
          <WebView
            ref={webRef}
            key={`${center[0]},${center[1]}`}
            originWhitelist={['*']}
            source={{ html: mapHtml(center, target?.geofence ?? []) }}
            onMessage={onMessage}
            onLoadEnd={() => me && pushMe(me)}
            style={{ flex: 1 }}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={GREEN} />
            <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
              Locating your farm…
            </ThemedText>
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
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
  introBody: { flex: 1, paddingHorizontal: Spacing.four },
  video: { height: 200, borderRadius: Spacing.four, overflow: 'hidden' },
  videoPlaceholder: { backgroundColor: '#1f2d24', alignItems: 'center', justifyContent: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: GREEN,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
    marginTop: 'auto',
    marginBottom: Spacing.four,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
