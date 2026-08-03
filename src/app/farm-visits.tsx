import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Farmer, Visit, api } from '@/lib/api';
import { callFarmer } from '@/lib/call';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

// Straight-line distance (km) between two lat/lng points.
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fmtDist(km: number | null) {
  if (km == null) return 'No location';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

type Row = Farmer & { distance: number | null; visited: boolean };

// Map of every farmer around the agronomist. Green pins are still to visit,
// grey ones are already done today. Tapping a pin posts its id back to RN.
function farmersMapHtml(
  pins: { id: string; name: string; lat: number; lng: number; visited: boolean; dist: string }[],
  me: { lat: number; lng: number } | null
) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body,#map{height:100%;margin:0;padding:0}
  .lbl{font-family:sans-serif;font-size:13px;font-weight:700}
  .go{display:inline-block;margin-top:6px;background:#2e9e5b;color:#fff;padding:6px 12px;
      border-radius:14px;font-family:sans-serif;font-size:12px;font-weight:700;text-decoration:none}
</style></head><body>
<div id="map"></div><script>
  var PINS = ${JSON.stringify(pins)};
  var ME = ${JSON.stringify(me)};
  var map = L.map('map',{zoomControl:false,attributionControl:false});
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20}).addTo(map);

  var bounds = [];
  PINS.forEach(function(p){
    var colour = p.visited ? '#8a8f98' : '#2e9e5b';
    var m = L.circleMarker([p.lat,p.lng],
      {radius:10,color:'#fff',weight:3,fillColor:colour,fillOpacity:1}).addTo(map);
    var html = '<div class="lbl">'+p.name+'</div><div>'+p.dist+'</div>'
      + (p.visited ? '<div style="color:#8a8f98">Visited today</div>'
                   : '<a class="go" href="#" onclick="pick(\\''+p.id+'\\');return false;">Start visit</a>');
    m.bindPopup(html);
    bounds.push([p.lat,p.lng]);
  });

  if (ME) {
    L.circleMarker([ME.lat,ME.lng],{radius:7,color:'#fff',weight:3,fillColor:'#1e88e5',fillOpacity:1})
      .addTo(map).bindPopup('<div class="lbl">You are here</div>');
    bounds.push([ME.lat,ME.lng]);
  }

  if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds).pad(0.2));
  else if (bounds.length === 1) map.setView(bounds[0], 15);
  else map.setView([12.97,77.59], 10);

  function pick(id){
    if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({farmerId:id}));
  }
</script></body></html>`;
}

export default function FarmVisitsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [visitsByFarmer, setVisitsByFarmer] = useState<Record<string, Visit>>({});
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [tab, setTab] = useState<'remaining' | 'visited'>('remaining');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [loading, setLoading] = useState(true);

  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };

  const load = useCallback(async () => {
    if (!user) return;
    try {
      // Current location (best-effort — sorting just falls back if denied).
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // ignore
      }
      const [fs, visits] = await Promise.all([
        api.listAgronomistFarmers(user._id),
        api.listVisits(user._id, startOfToday()).catch(() => []),
      ]);
      setFarmers(fs);
      // Map farmer id -> their (most recent) visit today, for the visited view.
      const map: Record<string, Visit> = {};
      for (const v of visits) {
        const fid = typeof v.farmer === 'string' ? v.farmer : v.farmer?._id;
        if (fid && !map[fid]) map[fid] = v;
      }
      setVisitsByFarmer(map);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = farmers.map((f) => {
      // farmPoint is the boundary centre (or registered location) — `location`
      // alone is empty for virtually every farmer.
      const p = f.farmPoint;
      const distance =
        me && p ? distanceKm(me, { lat: p.latitude, lng: p.longitude }) : null;
      return { ...f, distance, visited: !!visitsByFarmer[f._id] };
    });
    // Nearest first; farmers without a distance go last.
    out.sort((a, b) => {
      if (a.distance == null && b.distance == null) return a.name.localeCompare(b.name);
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });
    return out;
  }, [farmers, me, visitsByFarmer]);

  // Farmers whose record is still missing a boundary or a crop — worth fixing
  // while the agronomist is out on visits and standing on the farm.
  const incomplete = useMemo(
    () =>
      farmers
        .map((f) => ({
          farmer: f,
          needsBoundary: (f.geofenceCount ?? 0) < 3,
          needsCrop: (f.cropCount ?? 0) < 1,
        }))
        .filter((x) => x.needsBoundary || x.needsCrop),
    [farmers]
  );

  const remaining = rows.filter((r) => !r.visited);
  const visited = rows.filter((r) => r.visited);
  const list = tab === 'remaining' ? remaining : visited;
  const nearest = remaining[0];

  // Everyone we can actually place on the map.
  const pins = useMemo(
    () =>
      rows
        .filter((r) => r.farmPoint)
        .map((r) => ({
          id: r._id,
          name: r.name,
          lat: r.farmPoint!.latitude,
          lng: r.farmPoint!.longitude,
          visited: r.visited,
          dist: fmtDist(r.distance),
        })),
    [rows]
  );

  const startVisit = (f: Farmer) =>
    router.push({
      pathname: '/visit-farmer',
      params: {
        farmerId: f._id,
        farmerName: f.name,
        farmerMobile: f.mobile,
        lat: me?.lat != null ? String(me.lat) : '',
        lng: me?.lng != null ? String(me.lng) : '',
      },
    } as never);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">Farm Visits</ThemedText>
          <View style={{ width: 26 }} />
        </View>

        {/* Summary */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <ThemedText style={[styles.summaryNum, { color: GREEN }]}>{visited.length}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Visited today</ThemedText>
          </View>
          <View style={styles.summaryCard}>
            <ThemedText style={[styles.summaryNum, { color: '#f59e0b' }]}>{remaining.length}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Remaining</ThemedText>
          </View>
        </View>

        {/* Nearest suggestion — opens the map of every farmer around you. */}
        {tab === 'remaining' && nearest && (
          <Pressable
            onPress={() => setShowMap(true)}
            style={({ pressed }) => [styles.nearestCard, pressed && { opacity: 0.9 }]}>
            <Ionicons name="navigate" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.nearestLabel}>Nearest farmer</ThemedText>
              <ThemedText style={styles.nearestName} numberOfLines={1}>
                {nearest.name} · {fmtDist(nearest.distance)}
              </ThemedText>
            </View>
            <View style={styles.startPill}>
              <ThemedText style={styles.startPillText}>
                {pins.length > 0 ? 'View map' : 'Start visit'}
              </ThemedText>
            </View>
          </Pressable>
        )}

        {/* Farmers still missing a boundary or a crop. */}
        {incomplete.length > 0 && (
          <Pressable
            onPress={() => setShowIncomplete(true)}
            style={({ pressed }) => [styles.needsCard, pressed && { opacity: 0.85 }]}>
            <Ionicons name="alert-circle" size={22} color={Brand.secondary} />
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" style={{ color: Brand.secondary }}>
                {incomplete.length} farmer{incomplete.length > 1 ? 's' : ''} need details
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Farm boundary or crop still missing
              </ThemedText>
            </View>
            <View style={styles.needsPill}>
              <ThemedText style={styles.needsPillText}>View</ThemedText>
            </View>
          </Pressable>
        )}

        {/* Segmented */}
        <View style={styles.segment}>
          {(['remaining', 'visited'] as const).map((k) => {
            const on = tab === k;
            const count = k === 'remaining' ? remaining.length : visited.length;
            return (
              <Pressable key={k} onPress={() => setTab(k)} style={[styles.segBtn, on && { backgroundColor: GREEN }]}>
                <ThemedText type="small" style={{ color: on ? '#fff' : theme.textSecondary, fontWeight: '700', textTransform: 'capitalize' }}>
                  {k} ({count})
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : list.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.empty}>
              <Ionicons name={tab === 'remaining' ? 'checkmark-done-circle-outline' : 'walk-outline'} size={40} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {tab === 'remaining' ? 'All farmers visited today! 🎉' : 'No visits logged today yet.'}
              </ThemedText>
            </ThemedView>
          ) : (
            list.map((f) => {
              const visit = visitsByFarmer[f._id];
              const thumb = visit?.farmPhotoUrl || visit?.farmerPhotoUrl;
              return (
                <Pressable
                  key={f._id}
                  onPress={() => (f.visited ? setSelectedVisit(visit) : startVisit(f))}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
                  {f.visited && thumb ? (
                    <Image source={{ uri: thumb }} style={styles.rowThumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatar, { backgroundColor: f.visited ? GREEN : 'rgba(46,158,91,0.12)' }]}>
                      {f.visited ? (
                        <Ionicons name="checkmark" size={22} color="#fff" />
                      ) : (
                        <ThemedText style={{ color: GREEN, fontWeight: '800', fontSize: 18 }}>
                          {f.name?.charAt(0)?.toUpperCase() ?? '?'}
                        </ThemedText>
                      )}
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" numberOfLines={1}>{f.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {f.visited ? 'Visited · tap to view photos' : fmtDist(f.distance)}
                    </ThemedText>
                  </View>
                  {f.mobile ? (
                    <Pressable
                      onPress={() => callFarmer(user, { _id: f._id, name: f.name, mobile: f.mobile })}
                      hitSlop={8}
                      style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.85 }]}>
                      <Ionicons name="call" size={16} color="#fff" />
                    </Pressable>
                  ) : null}
                  {f.visited ? (
                    <Ionicons name="images-outline" size={20} color={GREEN} />
                  ) : (
                    <View style={styles.visitBtn}>
                      <Ionicons name="camera" size={16} color="#fff" />
                      <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>Visit</ThemedText>
                    </View>
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>

      {/* All farmers around you. Tap a pin to start that visit. */}
      <Modal visible={showMap} animationType="slide" onRequestClose={() => setShowMap(false)}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <View style={styles.topBar}>
              <Pressable onPress={() => setShowMap(false)} hitSlop={10}>
                <Ionicons name="close" size={26} color={theme.text} />
              </Pressable>
              <ThemedText type="smallBold">Farmers near you ({pins.length})</ThemedText>
              <View style={{ width: 26 }} />
            </View>

            {pins.length === 0 ? (
              <ThemedView type="backgroundElement" style={[styles.empty, { margin: Spacing.four }]}>
                <Ionicons name="map-outline" size={40} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  None of your farmers have a farm boundary or location saved yet, so there is
                  nothing to show on the map.
                </ThemedText>
              </ThemedView>
            ) : (
              <WebView
                originWhitelist={['*']}
                source={{ html: farmersMapHtml(pins, me) }}
                style={{ flex: 1 }}
                javaScriptEnabled
                onMessage={(e) => {
                  try {
                    const { farmerId } = JSON.parse(e.nativeEvent.data);
                    const f = rows.find((r) => r._id === farmerId);
                    if (f) {
                      setShowMap(false);
                      startVisit(f);
                    }
                  } catch {
                    // ignore malformed messages
                  }
                }}
              />
            )}

            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: GREEN }]} />
                <ThemedText type="small" themeColor="textSecondary">To visit</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#8a8f98' }]} />
                <ThemedText type="small" themeColor="textSecondary">Visited today</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#1e88e5' }]} />
                <ThemedText type="small" themeColor="textSecondary">You</ThemedText>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Farmers needing details — tap one to open their record and fix it. */}
      <Modal
        visible={showIncomplete}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIncomplete(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowIncomplete(false)}>
          <Pressable style={[styles.detailSheet, { backgroundColor: theme.background }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <ThemedText type="subtitle">Needs details</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
              Tap a farmer to draw their boundary or add a crop.
            </ThemedText>

            <ScrollView showsVerticalScrollIndicator={false}>
              {incomplete.map(({ farmer: f, needsBoundary, needsCrop }) => (
                <Pressable
                  key={f._id}
                  onPress={() => {
                    setShowIncomplete(false);
                    router.push({
                      pathname: '/farmer',
                      params: { farmerId: f._id, name: f.name },
                    } as never);
                  }}
                  style={({ pressed }) => [styles.needsRow, pressed && { opacity: 0.85 }]}>
                  <View style={styles.needsAvatar}>
                    <ThemedText style={styles.needsAvatarText}>
                      {f.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" numberOfLines={1}>{f.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{f.mobile}</ThemedText>
                    <View style={styles.missRow}>
                      {needsBoundary && (
                        <View style={styles.missChip}>
                          <Ionicons name="map-outline" size={10} color={Brand.danger} />
                          <ThemedText type="small" style={styles.missText}>No boundary</ThemedText>
                        </View>
                      )}
                      {needsCrop && (
                        <View style={styles.missChip}>
                          <Ionicons name="leaf-outline" size={10} color={Brand.danger} />
                          <ThemedText type="small" style={styles.missText}>No crop</ThemedText>
                        </View>
                      )}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Visit detail — the photos the agronomist captured */}
      <Modal
        visible={!!selectedVisit}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedVisit(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelectedVisit(null)}>
          <Pressable style={[styles.detailSheet, { backgroundColor: theme.background }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            {selectedVisit && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <ThemedText type="subtitle">{selectedVisit.farmerName || 'Farmer'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
                  Visited {new Date(selectedVisit.visitedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </ThemedText>

                {selectedVisit.farmPhotoUrl ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>Farm photo</ThemedText>
                    <Image source={{ uri: selectedVisit.farmPhotoUrl }} style={styles.detailPhoto} contentFit="cover" />
                  </>
                ) : null}
                {selectedVisit.farmerPhotoUrl ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>Photo with farmer</ThemedText>
                    <Image source={{ uri: selectedVisit.farmerPhotoUrl }} style={styles.detailPhoto} contentFit="cover" />
                  </>
                ) : null}
                {!selectedVisit.farmPhotoUrl && !selectedVisit.farmerPhotoUrl ? (
                  <ThemedText type="small" themeColor="textSecondary">No photos were captured for this visit.</ThemedText>
                ) : null}

                {selectedVisit.notes ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>Notes</ThemedText>
                    <ThemedText type="small">{selectedVisit.notes}</ThemedText>
                  </>
                ) : null}

                {selectedVisit.location?.latitude != null && selectedVisit.location?.longitude != null ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(
                        `https://www.google.com/maps?q=${selectedVisit.location.latitude},${selectedVisit.location.longitude}`
                      ).catch(() => {})
                    }
                    style={styles.mapLink}>
                    <Ionicons name="location" size={16} color={GREEN} />
                    <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>View location on map</ThemedText>
                  </Pressable>
                ) : null}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
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
  summaryRow: { flexDirection: 'row', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  summaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    alignItems: 'center',
  },
  summaryNum: { fontSize: 26, fontWeight: '800' },
  nearestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: GREEN,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  nearestLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  nearestName: { color: '#fff', fontSize: 16, fontWeight: '800' },
  startPill: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: Spacing.four },
  startPillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  // Map legend.
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.three,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  // "N farmers need details" button + the sheet it opens.
  needsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Brand.secondarySurface,
    borderWidth: 1,
    borderColor: `${Brand.secondary}55`,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  needsPill: {
    backgroundColor: Brand.secondary,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.four,
  },
  needsPillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  needsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  needsAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Brand.secondarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  needsAvatarText: { color: Brand.secondary, fontSize: 17, fontWeight: '700' },
  missRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  missChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Brand.dangerSurface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Spacing.four,
  },
  missText: { color: Brand.danger, fontWeight: '700', fontSize: 11 },
  segment: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.04)',
    padding: 4,
    borderRadius: Spacing.five,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.five },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.two },
  empty: { marginTop: Spacing.four, padding: Spacing.five, borderRadius: Spacing.three, alignItems: 'center', gap: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  rowThumb: { width: 44, height: 44, borderRadius: Spacing.two },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  detailSheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    padding: Spacing.four,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  detailLabel: { marginTop: Spacing.three, marginBottom: Spacing.one, fontWeight: '700' },
  detailPhoto: { width: '100%', height: 220, borderRadius: Spacing.four },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.four, marginBottom: Spacing.two },
  callBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: GREEN,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
  },
});
