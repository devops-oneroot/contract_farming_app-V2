import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Farmer, Visit, api } from '@/lib/api';

const GREEN = '#2e9e5b';
const GREEN_SURFACE = '#E7F5EC';

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
      const hasLoc = f.location?.latitude != null && f.location?.longitude != null;
      const distance =
        me && hasLoc ? distanceKm(me, { lat: f.location.latitude!, lng: f.location.longitude! }) : null;
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

  const remaining = rows.filter((r) => !r.visited);
  const visited = rows.filter((r) => r.visited);
  const list = tab === 'remaining' ? remaining : visited;
  const nearest = remaining[0];

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

        {/* Nearest suggestion */}
        {tab === 'remaining' && nearest && (
          <Pressable onPress={() => startVisit(nearest)} style={styles.nearestCard}>
            <Ionicons name="navigate" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.nearestLabel}>Nearest farmer</ThemedText>
              <ThemedText style={styles.nearestName} numberOfLines={1}>
                {nearest.name} · {fmtDist(nearest.distance)}
              </ThemedText>
            </View>
            <View style={styles.startPill}>
              <ThemedText style={styles.startPillText}>Start visit</ThemedText>
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
