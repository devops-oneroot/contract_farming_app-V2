import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { CameraCapture } from '@/components/camera-capture';
import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { NotificationBell } from '@/components/notification-bell';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, CardShadow, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, Crop, Farmer, isContract, PackageOfPractices, PopStep, saleBuyer } from '@/lib/api';
import { callFarmer } from '@/lib/call';

const GREEN = Brand.primary;
const AMBER = Brand.accent;
const RED = Brand.danger;
const GREEN_SURFACE = Brand.surface;
const DAY_MS = 24 * 60 * 60 * 1000;

// Agronomist verification state for today's step.
type TaskStatus = 'done' | 'not_done' | 'unverified';

type Task = {
  dayN: number; // today's day-number in the crop cycle
  op: string;
  crop: string;
  cropId: string;
  dop: string;
  farmer: string;
  farmerId: string;
  farmerMobile: string;
  /** False when this farmer has no farm boundary drawn yet — the card flags it. */
  hasBoundary: boolean;
  step: PopStep;
  details: string;
  status: TaskStatus;
};

/**
 * A product this agronomist handed over whose follow-up after-photo is now due.
 * One entry per product line, since each carries its own proof.
 */
type FollowUp = {
  saleId: string;
  index: number; // the line's position in the sale's items
  product: string;
  farmer: string;
  crop: string;
  soldAt: string;
  beforePhotoUrl: string;
};

// A boundary needs at least 3 corners to be a polygon — matches the farmer detail
// and profile screens, so "set" means the same thing everywhere.
const MIN_BOUNDARY_CORNERS = 3;

// Agronomist "Pending": TODAY's Package-of-Practices step for each mapped
// farmer's crop, with whether the farmer has completed it (uploaded the day's
// product photos) so it can be verified on this day.
export default function PendingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const scheme = useColorScheme();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [afterFor, setAfterFor] = useState<FollowUp | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cropFilter, setCropFilter] = useState<string | null>(null);
  /** Tapping a counter in the progress card narrows the list to that status. */
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetTask, setSheetTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      // Follow-up photos this agronomist owes: they belong to whoever handed the
      // product over, not to whoever now manages the farmer.
      api
        .listProductSales({ agronomistId: user._id, pendingAfter: true })
        .then((sales) =>
          setFollowUps(
            sales.flatMap((s) =>
              s.items
                .map((it, index) => ({ it, index }))
                /**
                 * Only a line photographed at handover is owed the second shot.
                 * A line with neither would sit here for ever asking for the
                 * other half of a comparison that does not exist — the server
                 * filters the same way, this is the matching half.
                 */
                .filter(({ it }) => !!it.beforePhotoUrl && !it.afterPhotoUrl)
                .map(({ it, index }) => ({
                  saleId: s._id,
                  index,
                  product: it.name,
                  // Farmer or FPO — one helper, so the row can never name the
                  // wrong kind of buyer or show a blank.
                  farmer: saleBuyer(s).name,
                  crop: s.cropName,
                  soldAt: s.soldAt,
                  beforePhotoUrl: it.beforePhotoUrl,
                }))
            )
          )
        )
        .catch(() => setFollowUps([]));

      const farmers: Farmer[] = await api.listAgronomistFarmers(user._id);
      const cropLists = await Promise.all(
        farmers.map((f) =>
          api
            .listCrops(f._id)
            .then((cs) => ({ farmer: f, crops: cs }))
            .catch(() => ({ farmer: f, crops: [] as Crop[] }))
        )
      );
      // Distinct crop names → their Package of Practices. Regular crops follow no
      // schedule, so they raise no tasks to verify and are not worth a request.
      const names = [...new Set(cropLists.flatMap((cl) => cl.crops.filter(isContract).map((c) => c.name)))];
      const pops = await Promise.all(names.map((n) => api.getPractices(n).catch(() => null)));
      const popMap: Record<string, PackageOfPractices> = {};
      pops.forEach((p, i) => {
        if (p) popMap[names[i].toLowerCase()] = p;
      });

      const now = Date.now();
      const out: Task[] = [];
      for (const { farmer, crops } of cropLists) {
        for (const c of crops) {
          if (!isContract(c) || !c.dop) continue;
          const pop = popMap[c.name.toLowerCase()];
          if (!pop) continue;
          // Which day of the crop cycle is today?
          const dayN = Math.floor((now - new Date(c.dop).getTime()) / DAY_MS) + 1;
          if (dayN < 1 || dayN > pop.durationDays) continue; // not planted yet / cycle over

          // Only the step(s) whose scheduled window covers TODAY.
          for (const s of pop.steps) {
            if (dayN < s.day[0] || dayN > s.day[1]) continue;
            // Agronomist's verifications for this step (operation and/or product).
            const vs = (c.verifications ?? []).filter((x) => x.day === s.day[0]);
            const status: TaskStatus = vs.some((v) => v.status === 'done')
              ? 'done'
              : vs.some((v) => v.status === 'not_done')
                ? 'not_done'
                : 'unverified';
            out.push({
              dayN,
              op: s.operation,
              crop: c.name,
              cropId: c._id,
              dop: c.dop,
              farmer: farmer.name,
              farmerId: farmer._id,
              farmerMobile: farmer.mobile,
              hasBoundary: (farmer.geofenceCount ?? 0) >= MIN_BOUNDARY_CORNERS,
              step: s,
              details: s.details,
              status,
            });
          }
        }
      }
      // Unverified first (what needs checking), then not-done, then done.
      const rank: Record<TaskStatus, number> = { unverified: 0, not_done: 1, done: 2 };
      out.sort((a, b) => rank[a.status] - rank[b.status] || a.farmer.localeCompare(b.farmer));
      setTasks(out);
    } catch (e: any) {
      setError(e?.message || 'Could not load tasks.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // The follow-up shot, taken a week after handover to show what the product did.
  const captureAfter = async (uri: string) => {
    if (!afterFor) return;
    const { saleId, index } = afterFor;
    setAfterFor(null);
    setUploading(true);
    try {
      let sized = uri;
      try {
        const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
          compress: 0.6,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        sized = out.uri;
      } catch {
        // never lose the shot because the resize failed
      }
      await api.addAfterPhotos(saleId, [
        { index, photo: { uri: sized, name: `after_${index}.jpg`, type: 'image/jpeg' } },
      ]);
      // Off the list the moment it is done — this is a to-do, not a log.
      setFollowUps((fs) => fs.filter((f) => !(f.saleId === saleId && f.index === index)));
    } catch (e: any) {
      Alert.alert('Could not save the photo', e?.message || 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // Open the day in a given mode: 'operation' (POP of the day) or 'product'.
  const openMode = (t: Task, mode: 'operation' | 'product') => {
    setSheetTask(null);
    router.push({
      pathname: '/agronomist-verify',
      params: {
        mode,
        cropId: t.cropId,
        crop: t.crop,
        farmer: t.farmer,
        dop: t.dop,
        day: String(t.step.day[0]),
        dayEnd: String(t.step.day[1]),
        operation: t.op,
        details: t.details,
        stepCategory: t.step.category,
        stepProducts: JSON.stringify(t.step.products ?? []),
      },
    } as never);
  };

  // Draw this farmer's farm boundary — offered from the sheet when it is missing.
  const openBoundary = (t: Task) => {
    setSheetTask(null);
    router.push({
      pathname: '/geofence',
      params: { userId: t.farmerId, name: t.farmer },
    } as never);
  };

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // Distinct crops present in today's tasks, for the filter chips.
  const crops = useMemo(() => [...new Set(tasks.map((t) => t.crop))].sort(), [tasks]);
  // The crop filter sets the scope; the counters are worked out within it.
  const cropTasks = useMemo(
    () => (cropFilter ? tasks.filter((t) => t.crop === cropFilter) : tasks),
    [tasks, cropFilter]
  );
  const counts = useMemo(
    () => ({
      unverified: cropTasks.filter((t) => t.status === 'unverified').length,
      done: cropTasks.filter((t) => t.status === 'done').length,
      not_done: cropTasks.filter((t) => t.status === 'not_done').length,
    }),
    [cropTasks]
  );
  const visibleTasks = useMemo(
    () => (statusFilter ? cropTasks.filter((t) => t.status === statusFilter) : cropTasks),
    [cropTasks, statusFilter]
  );
  const pendingCount = counts.unverified;
  const checked = counts.done + counts.not_done;
  const progress = cropTasks.length ? checked / cropTasks.length : 0;

  const badge = (t: Task) => {
    if (t.status === 'done')
      return { color: GREEN, label: 'Verified', icon: 'checkmark-circle' as const };
    if (t.status === 'not_done')
      return { color: RED, label: 'Not done', icon: 'close-circle' as const };
    return { color: AMBER, label: 'To verify', icon: 'time' as const };
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.headerTitle}>Today's Tasks</ThemedText>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={13} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                {today}
              </ThemedText>
            </View>
          </View>
          <NotificationBell />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[GREEN]}
              tintColor={GREEN}
            />
          }>
          {/* Progress: how much of today's checking is done, and the counters as filters. */}
          {!loading && cropTasks.length > 0 && (
            <ThemedView style={styles.progressCard}>
              <View style={styles.progressHead}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.progressTitle}>
                    {checked} of {cropTasks.length} checked
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                    {pendingCount ? `${pendingCount} still to verify today` : 'All of today’s practices are checked 🎉'}
                  </ThemedText>
                </View>
                <ThemedText style={styles.progressPct}>{Math.round(progress * 100)}%</ThemedText>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(progress * 100, progress ? 4 : 0)}%` }]} />
              </View>
              <View style={styles.counterRow}>
                {(
                  [
                    { key: 'unverified', label: 'To verify', n: counts.unverified, color: AMBER, icon: 'time' },
                    { key: 'done', label: 'Verified', n: counts.done, color: Brand.secondary, icon: 'checkmark-circle' },
                    { key: 'not_done', label: 'Not done', n: counts.not_done, color: RED, icon: 'close-circle' },
                  ] as const
                ).map((c) => {
                  const on = statusFilter === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      onPress={() => setStatusFilter(on ? null : c.key)}
                      style={[styles.counter, { backgroundColor: on ? c.color : `${c.color}14`, borderColor: `${c.color}55` }]}>
                      <Ionicons name={c.icon} size={14} color={on ? '#fff' : c.color} />
                      <ThemedText style={[styles.counterNum, { color: on ? '#fff' : c.color }]}>{c.n}</ThemedText>
                      <ThemedText style={[styles.counterLabel, { color: on ? '#fff' : theme.text }]} numberOfLines={1}>
                        {c.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </ThemedView>
          )}

          {/* Crop filter */}
          {crops.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {[null, ...crops].map((c) => {
                const on = cropFilter === c;
                return (
                  <Pressable
                    key={c ?? 'all'}
                    onPress={() => setCropFilter(c)}
                    style={[styles.chip, on ? { backgroundColor: GREEN, borderColor: GREEN } : { backgroundColor: theme.card }]}>
                    <Ionicons name={c ? 'leaf' : 'apps'} size={12} color={on ? '#fff' : GREEN} />
                    <ThemedText style={[styles.chipText, { color: on ? '#fff' : theme.text }]}>{c ?? 'All crops'}</ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* Follow-up after-photos that came due — owed by whoever sold the
              product, so they sit above the day's verification work. */}
          {followUps.length > 0 && (
            <View style={{ gap: Spacing.two }}>
              <View style={styles.sectionHead}>
                <View style={[styles.sectionIcon, { backgroundColor: `${AMBER}22` }]}>
                  <Ionicons name="camera" size={14} color={AMBER} />
                </View>
                <ThemedText style={styles.sectionTitle}>After photos due</ThemedText>
                <View style={[styles.countBadge, { backgroundColor: AMBER }]}>
                  <ThemedText style={styles.countBadgeText}>{followUps.length}</ThemedText>
                </View>
              </View>
              {followUps.map((f) => {
                const days = Math.max(0, Math.floor((Date.now() - new Date(f.soldAt).getTime()) / DAY_MS));
                return (
                  <ThemedView key={`${f.saleId}-${f.index}`} style={styles.followCard}>
                    {f.beforePhotoUrl ? (
                      <TappablePhoto uri={f.beforePhotoUrl} style={styles.followThumb} caption="before photo" />
                    ) : (
                      <View style={[styles.followThumb, { backgroundColor: 'rgba(127,127,127,0.15)' }]} />
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ThemedText style={styles.cardTitle} numberOfLines={1}>
                        {f.product}
                      </ThemedText>
                      <View style={styles.metaRow}>
                        <Ionicons name="person-outline" size={12} color={theme.textSecondary} />
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.metaText}>
                          {f.farmer}
                          {f.crop ? ` · ${f.crop}` : ''}
                        </ThemedText>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: `${AMBER}18` }]}>
                        <Ionicons name="hourglass-outline" size={11} color={AMBER} />
                        <ThemedText style={[styles.statusText, { color: AMBER }]}>Given {days} days ago</ThemedText>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => setAfterFor(f)}
                      disabled={uploading}
                      style={({ pressed }) => [styles.followBtn, { opacity: uploading ? 0.6 : pressed ? 0.85 : 1 }]}>
                      {uploading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Ionicons name="camera-outline" size={16} color="#fff" />
                          <ThemedText style={styles.followBtnText}>Photo</ThemedText>
                        </>
                      )}
                    </Pressable>
                  </ThemedView>
                );
              })}
            </View>
          )}

          {/* Today's practices */}
          {!loading && visibleTasks.length > 0 && (
            <View style={styles.sectionHead}>
              <View style={[styles.sectionIcon, { backgroundColor: `${GREEN}1F` }]}>
                <Ionicons name="leaf" size={14} color={GREEN} />
              </View>
              <ThemedText style={styles.sectionTitle}>
                {statusFilter === 'unverified'
                  ? 'To verify'
                  : statusFilter === 'done'
                    ? 'Verified'
                    : statusFilter === 'not_done'
                      ? 'Not done'
                      : "Today's practices"}
              </ThemedText>
              <View style={[styles.countBadge, { backgroundColor: GREEN }]}>
                <ThemedText style={styles.countBadgeText}>{visibleTasks.length}</ThemedText>
              </View>
            </View>
          )}

          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : visibleTasks.length === 0 && followUps.length === 0 ? (
            <ThemedView style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="checkmark-done" size={30} color={Brand.secondary} />
              </View>
              <ThemedText type="smallBold">{statusFilter ? 'Nothing here' : 'All clear for today'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {statusFilter
                  ? 'No practices with this status. Tap the counter again to see all.'
                  : cropFilter
                    ? `No ${cropFilter} practices scheduled today.`
                    : 'No practices scheduled for any farmer today.'}
              </ThemedText>
              {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
            </ThemedView>
          ) : (
            visibleTasks.map((t, i) => {
              const b = badge(t);
              return (
                <Pressable
                  key={`${t.cropId}-${t.dayN}-${i}`}
                  onPress={() => setSheetTask(t)}
                  style={({ pressed }) => [styles.card, { backgroundColor: theme.card, borderLeftColor: b.color }, pressed && { opacity: 0.85 }]}>
                  <View style={[styles.dayBadge, { backgroundColor: `${b.color}1C` }]}>
                    <ThemedText style={[styles.dayBadgeLabel, { color: b.color }]}>DAY</ThemedText>
                    <ThemedText style={[styles.dayBadgeNum, { color: b.color }]}>{t.dayN}</ThemedText>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <ThemedText style={styles.cardTitle} numberOfLines={1}>
                      {t.op}
                    </ThemedText>
                    <View style={styles.metaRow}>
                      <Ionicons name="person-outline" size={12} color={theme.textSecondary} />
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.metaText}>
                        {t.farmer}
                      </ThemedText>
                      <Ionicons name="leaf-outline" size={12} color={theme.textSecondary} style={{ marginLeft: 4 }} />
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.metaText}>
                        {t.crop}
                      </ThemedText>
                    </View>
                    <View style={styles.tagRow}>
                      <View style={[styles.statusPill, { backgroundColor: `${b.color}18` }]}>
                        <Ionicons name={b.icon} size={11} color={b.color} />
                        <ThemedText style={[styles.statusText, { color: b.color }]}>{b.label}</ThemedText>
                      </View>
                      {/* This farm has no boundary drawn yet. */}
                      {!t.hasBoundary && (
                        <View style={[styles.statusPill, { backgroundColor: `${RED}14` }]}>
                          <Ionicons name="map-outline" size={11} color={RED} />
                          <ThemedText style={[styles.statusText, { color: RED }]}>No boundary</ThemedText>
                        </View>
                      )}
                    </View>
                  </View>
                  {t.farmerMobile ? (
                    <Pressable
                      onPress={() => callFarmer(user, { _id: t.farmerId, name: t.farmer, mobile: t.farmerMobile })}
                      hitSlop={8}
                      accessibilityLabel={`Call ${t.farmer}`}
                      style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.8 }]}>
                      <Ionicons name="call" size={16} color="#fff" />
                    </Pressable>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Choice sheet: Operation (POP of the day) or Products of the day */}
      <Modal
        visible={!!sheetTask}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetTask(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetTask(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            {sheetTask && (
              <>
                <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                  {sheetTask.op}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
                  {sheetTask.farmer} · {sheetTask.crop} · Day {sheetTask.dayN}
                </ThemedText>

                <Pressable
                  onPress={() => openMode(sheetTask, 'operation')}
                  style={({ pressed }) => [styles.sheetOption, pressed && { opacity: 0.85 }]}>
                  <View style={styles.sheetIcon}>
                    <Ionicons name="leaf-outline" size={22} color={GREEN} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" style={{ fontSize: 15 }}>
                      Operation
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Package of Practices for this day
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                </Pressable>

                <Pressable
                  onPress={() => openMode(sheetTask, 'product')}
                  style={({ pressed }) => [styles.sheetOption, pressed && { opacity: 0.85 }]}>
                  <View style={styles.sheetIcon}>
                    <Ionicons name="cube-outline" size={22} color={GREEN} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" style={{ fontSize: 15 }}>
                      Products
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {(sheetTask.step.products?.length ?? 0) > 0
                        ? `${sheetTask.step.products!.length} product(s) for this day`
                        : 'Products to use this day'}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                </Pressable>

                {/* Only offered while this farmer still has no boundary drawn. */}
                {!sheetTask.hasBoundary && (
                  <Pressable
                    onPress={() => openBoundary(sheetTask)}
                    style={({ pressed }) => [
                      styles.sheetOption,
                      styles.sheetOptionAlert,
                      pressed && { opacity: 0.85 },
                    ]}>
                    <View style={[styles.sheetIcon, { backgroundColor: `${RED}18` }]}>
                      <Ionicons name="map-outline" size={22} color={RED} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold" style={{ fontSize: 15 }}>
                        Farm boundary
                      </ThemedText>
                      <ThemedText type="small" style={{ color: RED }}>
                        Not set · tap to draw it
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                  </Pressable>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {afterFor && <CameraCapture onCapture={captureAfter} onClose={() => setAfterFor(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  // ----- Progress card -----
  progressCard: { borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.two, ...CardShadow },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  progressTitle: { fontSize: 16, fontWeight: '800', lineHeight: 21 },
  progressPct: { fontSize: 22, fontWeight: '800', color: GREEN },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(127,127,127,0.15)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: Brand.secondary },
  counterRow: { flexDirection: 'row', gap: Spacing.two, marginTop: 2 },
  counter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  counterNum: { fontSize: 15, fontWeight: '800' },
  counterLabel: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  // ----- Crop chips -----
  filterRow: { gap: Spacing.two, alignItems: 'center', paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,127,0,0.25)',
  },
  chipText: { fontSize: 13, fontWeight: '700' },
  // ----- Sections -----
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 2 },
  sectionIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800' },
  countBadge: { minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  countBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  // ----- Cards -----
  followCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderLeftWidth: 4,
    borderLeftColor: AMBER,
    ...CardShadow,
  },
  followThumb: { width: 54, height: 54, borderRadius: Radius.md },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: GREEN,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
    borderRadius: Radius.md,
  },
  followBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderLeftWidth: 4,
    ...CardShadow,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { fontSize: 12, flexShrink: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  dayBadge: {
    width: 52,
    height: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBadgeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  dayBadgeNum: { fontSize: 21, fontWeight: '800', lineHeight: 25 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    marginTop: Spacing.two,
    padding: Spacing.five,
    borderRadius: Radius.lg,
    alignItems: 'center',
    gap: Spacing.two,
    ...CardShadow,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Brand.secondarySurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  error: { color: '#e5484d' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,127,0,0.25)',
  },
  sheetOptionAlert: { borderColor: `${RED}55` },
  sheetIcon: {
    width: 46,
    height: 46,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(255,127,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
