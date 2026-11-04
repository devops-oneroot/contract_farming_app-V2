import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { CameraCapture } from '@/components/camera-capture';
import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import {
  api,
  CatalogCrop,
  Crop,
  isContract,
  PackageOfPractices,
  ProductSale,
  Visit,
} from '@/lib/api';
import { dueLabel } from '@/lib/dates';

const DAY_MS = 24 * 60 * 60 * 1000;
const GREEN = Brand.primary;
const AMBER = Brand.accent;

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

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
  const { user } = useAuth();
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
  // Only the agronomist who registered this farmer may remove them, so the
  // action is hidden entirely for farmers who were merely assigned.
  const [onboardedByMe, setOnboardedByMe] = useState(false);
  const [trashing, setTrashing] = useState(false);

  // Add a crop, or fill in a planting date that was left blank at onboarding.
  // `cropSheet` is null when closed, holds the crop being edited, or 'new' to add.
  const [sales, setSales] = useState<ProductSale[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  // Which sale line we are taking the follow-up after-photo for.
  const [afterFor, setAfterFor] = useState<{ saleId: string; index: number } | null>(null);
  const [uploadingAfter, setUploadingAfter] = useState(false);

  // Setting the return date straight from a logged visit. `followUpFor` is the
  // visit being edited, or null when the sheet is closed.
  const [followUpFor, setFollowUpFor] = useState<Visit | null>(null);
  const [fuDate, setFuDate] = useState<Date | null>(null);
  const [fuNote, setFuNote] = useState('');
  const [fuPicker, setFuPicker] = useState(false);
  const [savingFu, setSavingFu] = useState(false);

  useFocusEffect(
    useCallback(() => {
    (async () => {
      try {
        const [cropList, farmerUser, catalogList, saleList, visitList] = await Promise.all([
          api.listCrops(farmerId),
          api.getUser(farmerId).catch(() => null),
          api.listCropCatalog().catch(() => []),
          api.listProductSales({ farmerId }).catch(() => []),
          api.listFarmerVisits(farmerId).catch(() => []),
        ]);
        setCrops(cropList);
        setCatalog(catalogList);
        setSales(saleList);
        setVisits(visitList);
        setGeofenceCount(farmerUser?.geofence?.length ?? 0);
        if (farmerUser) {
          setFarmerName(farmerUser.name ?? '');
          setFarmerMobile(farmerUser.mobile ?? '');
          setOnboardedByMe(!!user && String(farmerUser.onboardedBy ?? '') === user._id);
        }
        // Fetch the schedule for each distinct crop to compute the current stage.
        // Regular crops have no schedule, so they are not worth a request.
        const names = [...new Set(cropList.filter(isContract).map((c) => c.name))];
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
    }, [farmerId, user])
  );

  // Each crop's own picture from the admin catalog, matched on name.
  const catalogImage = (name: string) =>
    catalog.find((c) => c.name.toLowerCase() === name.toLowerCase())?.imageUrl;

  /** Everything editable about this farmer lives on one screen. */
  const openEdit = () =>
    router.push({ pathname: '/edit-farmer', params: { farmerId } } as never);

  /**
   * Move this one farmer to the trash. Confirmed first, and worded so it is
   * clear nothing is being destroyed - their crops and history come back if
   * they are restored. The server independently re-checks that this agronomist
   * onboarded them; this screen only decides whether to offer the action.
   */
  const confirmTrash = () => {
    if (!user || !farmerId || trashing) return;
    const who = farmerName || name || 'this farmer';
    Alert.alert(
      `Remove ${who}?`,
      `They move to your trash and stop appearing in your lists. Nothing is deleted — their ${
        crops.length === 1 ? 'crop' : 'crops'
      }, visits and calls stay, and you can restore them from Trash.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to trash',
          style: 'destructive',
          onPress: async () => {
            setTrashing(true);
            try {
              await api.trashFarmer(user._id, farmerId);
              router.back();
            } catch (e: any) {
              Alert.alert('Could not remove', e?.message || 'Please try again.');
            } finally {
              setTrashing(false);
            }
          },
        },
      ]
    );
  };

  /** Open the follow-up sheet on a visit, pre-filled with whatever it holds. */
  const openFollowUp = (v: Visit) => {
    setFollowUpFor(v);
    setFuDate(v.nextFollowUpAt ? new Date(v.nextFollowUpAt) : null);
    setFuNote(v.followUpNote ?? '');
    setFuPicker(false);
  };

  /**
   * Save the date onto the visit. `date` is passed in rather than read from
   * state so Remove can clear it without first having to set state and wait a
   * render — the two paths are the same request with a different value.
   */
  const saveFollowUp = async (date: Date | null) => {
    if (!followUpFor || savingFu) return;
    setSavingFu(true);
    try {
      const updated = await api.setVisitFollowUp(followUpFor._id, {
        nextFollowUpAt: date ? date.toISOString() : null,
        followUpNote: date ? fuNote.trim() : '',
      });
      // Patch the one card in place: refetching would rebuild the whole screen
      // and lose the scroll position the agent was reading from.
      setVisits((vs) => vs.map((v) => (v._id === updated._id ? { ...v, ...updated } : v)));
      setFollowUpFor(null);
    } catch (e: any) {
      Alert.alert('Could not save the follow-up', e?.message || 'Please try again.');
    } finally {
      setSavingFu(false);
    }
  };

  const captureAfter = async (uri: string) => {
    if (!afterFor) return;
    const { saleId, index } = afterFor;
    setAfterFor(null);
    setUploadingAfter(true);
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
      const updated = await api.addAfterPhotos(saleId, [
        { index, photo: { uri: sized, name: `after_${index}.jpg`, type: 'image/jpeg' } },
      ]);
      setSales((ss) => ss.map((s) => (s._id === updated._id ? updated : s)));
    } catch (e: any) {
      Alert.alert('Could not save the photo', e?.message || 'Please try again.');
    } finally {
      setUploadingAfter(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader
          onBack={() => router.back()}
          title={name ?? 'Farmer'}
        />

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
                  <ThemedView type="card" style={styles.geoBtn}>
                    <View style={[styles.geoIcon, { backgroundColor: '#FF7F00' }]}>
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
                  <ThemedView type="card" style={styles.geoBtn}>
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
                {/* Revisiting: photograph the farm again and note what was seen. */}
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/visit-farmer',
                      params: {
                        farmerId,
                        farmerName: farmerName || name || '',
                        farmerMobile,
                      },
                    })
                  }
                  style={({ pressed }) => pressed && { opacity: 0.85 }}>
                  <ThemedView type="card" style={styles.geoBtn}>
                    <View style={[styles.geoIcon, { backgroundColor: AMBER }]}>
                      <Ionicons name="camera" size={18} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">Log a visit</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {visits.length > 0
                          ? `${visits.length} visit${visits.length > 1 ? 's' : ''} · last ${fmt(
                              new Date(visits[0].visitedAt)
                            )}`
                          : 'Photos and notes from this visit'}
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </ThemedView>
                </Pressable>

                {/* Something wrong with a crop — photograph it and ask a senior. */}
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/report-disease',
                      params: { farmerId, farmerName: farmerName || name || '' },
                    })
                  }
                  style={({ pressed }) => pressed && { opacity: 0.85 }}>
                  <ThemedView type="card" style={styles.geoBtn}>
                    <View style={[styles.geoIcon, { backgroundColor: Brand.danger }]}>
                      <Ionicons name="bug" size={18} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">Report crop disease</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Photograph it and ask a senior agronomist
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </ThemedView>
                </Pressable>

                {/* Sell a product on the spot, with before/after proof photos. */}
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/give-product',
                      params: { farmerId, farmerName: farmerName || name || '' },
                    })
                  }
                  style={({ pressed }) => pressed && { opacity: 0.85 }}>
                  <ThemedView type="card" style={styles.geoBtn}>
                    <View style={[styles.geoIcon, { backgroundColor: Brand.secondary }]}>
                      <Ionicons name="cart" size={18} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">Give product</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {sales.length > 0
                          ? `${sales.length} sold · ${money(sales.reduce((s, x) => s + (x.total ?? 0), 0))}`
                          : 'Sell on the field with before/after photos'}
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </ThemedView>
                </Pressable>

                <View style={styles.cropsHead}>
                  <ThemedText type="smallBold">Crops ({crops.length})</ThemedText>
                  <Pressable
                    onPress={openEdit}
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
              <ThemedView type="card" style={styles.empty}>
                <ThemedText themeColor="textSecondary" type="small">
                  {error ?? 'This farmer has not added any crops yet.'}
                </ThemedText>
              </ThemedView>
            }
            ListFooterComponent={
              <>
              {/* Every previous visit to this farm — photos and what was noted. */}
              {visits.length > 0 && (
                <View style={{ marginTop: Spacing.four }}>
                  <ThemedText type="smallBold" style={{ marginBottom: Spacing.two }}>
                    Visits ({visits.length})
                  </ThemedText>
                  {visits.map((v, i) => {
                    const photos = [
                      { url: v.farmPhotoUrl, label: 'Farm' },
                      { url: v.farmerPhotoUrl, label: 'With farmer' },
                    ].filter((p) => p.url);
                    /**
                     * The day the agent promised to come back, as set at THIS
                     * visit. Visits are newest-first and logging one overwrites
                     * the farmer's pending date, so only the top card's date is
                     * still owed — every older one was superseded.
                     */
                    const due = dueLabel(v.nextFollowUpAt);
                    const pending = i === 0 && !!due;
                    /**
                     * Only the newest visit can be given a date from here.
                     * The farmer holds one live follow-up, so a date typed onto
                     * an older card would either do nothing or send the agent
                     * back to someone they have since been to see.
                     */
                    const latest = i === 0;
                    return (
                      <ThemedView key={v._id} type="card" style={styles.saleCard}>
                        <View style={styles.saleItemHead}>
                          <ThemedText type="smallBold" style={{ flex: 1 }}>
                            {fmt(new Date(v.visitedAt))}
                          </ThemedText>
                          {typeof v.agronomist === 'object' && v.agronomist?.name ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              {v.agronomist.name}
                            </ThemedText>
                          ) : null}
                        </View>
                        {photos.length > 0 && (
                          <View style={styles.salePhotos}>
                            {photos.map((p) => (
                              <View key={p.label} style={{ flex: 1 }}>
                                <TappablePhoto uri={p.url} style={styles.salePhoto} caption={p.label} />
                                <ThemedText type="small" themeColor="textSecondary" style={styles.salePhotoLabel}>
                                  {p.label}
                                </ThemedText>
                              </View>
                            ))}
                          </View>
                        )}
                        {v.notes ? (
                          <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                            {v.notes}
                          </ThemedText>
                        ) : null}
                        {/* When the agent said they would return, and why — both
                            as written on the day, not the farmer's current
                            reason, which a later visit will have overwritten.

                            The pending one is a banner and opens the visit
                            screen, because it is the only follow-up here that
                            is still work owed. Superseded dates stay as one
                            quiet line: they explain the history without
                            competing with it. */}
                        {pending ? (
                          // Tapping the band edits the promise it is showing.
                          // Going out to the farm is a separate decision, so it
                          // gets its own button rather than being what happens
                          // when the date itself is tapped.
                          <Pressable
                            onPress={() => openFollowUp(v)}
                            style={({ pressed }) => [
                              styles.followUpDue,
                              {
                                backgroundColor: due!.overdue
                                  ? Brand.dangerSurface
                                  : Brand.accentSurface,
                              },
                              pressed && { opacity: 0.85 },
                            ]}>
                            <Ionicons
                              name="alarm"
                              size={14}
                              color={due!.overdue ? Brand.danger : AMBER}
                            />
                            <View style={{ flex: 1 }}>
                              <ThemedText
                                type="smallBold"
                                style={{ color: due!.overdue ? Brand.danger : AMBER }}>
                                Follow up {due!.label}
                              </ThemedText>
                              {v.followUpNote ? (
                                <ThemedText type="small" themeColor="textSecondary">
                                  {v.followUpNote}
                                </ThemedText>
                              ) : null}
                            </View>
                            {/* The only way from here to Mark visit. Named for
                                where it goes: the agent is being sent to a
                                camera and a form, which is a different thing
                                from correcting a date. */}
                            <Pressable
                              onPress={() =>
                                router.push({
                                  pathname: '/visit-farmer',
                                  params: {
                                    farmerId,
                                    farmerName: farmerName || name || '',
                                    farmerMobile,
                                  },
                                })
                              }
                              hitSlop={10}
                              style={({ pressed }) => [
                                styles.editDateBtn,
                                pressed && { opacity: 0.7 },
                              ]}>
                              <Ionicons
                                name="camera"
                                size={12}
                                color={due!.overdue ? Brand.danger : AMBER}
                              />
                              <ThemedText
                                type="small"
                                style={{
                                  color: due!.overdue ? Brand.danger : AMBER,
                                  fontWeight: '700',
                                }}>
                                Mark visit
                              </ThemedText>
                              <Ionicons
                                name="chevron-forward"
                                size={11}
                                color={due!.overdue ? Brand.danger : AMBER}
                              />
                            </Pressable>
                          </Pressable>
                        ) : (
                          <>
                            {due ? (
                              <View style={styles.whyBack}>
                                <Ionicons
                                  name="checkmark-done-outline"
                                  size={12}
                                  color={theme.textSecondary}
                                />
                                <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                                  Follow-up was set for {fmt(new Date(v.nextFollowUpAt!))}
                                </ThemedText>
                              </View>
                            ) : null}
                            {v.followUpNote ? (
                              <View style={styles.whyBack}>
                                <Ionicons name="alarm-outline" size={12} color={AMBER} />
                                <ThemedText type="small" style={{ color: AMBER, flex: 1 }}>
                                  {v.followUpNote}
                                </ThemedText>
                              </View>
                            ) : null}
                            {/* A visit logged without a return date is the
                                common case now that the date is optional when
                                marking one. This is where it gets added, so
                                nobody has to log a visit that never happened
                                just to promise a day. */}
                            {latest && !due ? (
                              <Pressable
                                onPress={() => openFollowUp(v)}
                                style={({ pressed }) => [
                                  styles.addFollowUp,
                                  pressed && { opacity: 0.8 },
                                ]}>
                                <Ionicons name="calendar-outline" size={14} color={GREEN} />
                                <ThemedText
                                  type="small"
                                  style={{ color: GREEN, fontWeight: '700', flex: 1 }}>
                                  Add next follow-up
                                </ThemedText>
                                <Ionicons name="add" size={14} color={GREEN} />
                              </Pressable>
                            ) : null}
                          </>
                        )}
                      </ThemedView>
                    );
                  })}
                </View>
              )}

              {sales.length > 0 ? (
                <View style={{ marginTop: Spacing.four }}>
                  <ThemedText type="smallBold" style={{ marginBottom: Spacing.two }}>
                    Products given ({sales.length})
                  </ThemedText>
                  {sales.map((s) => (
                    <ThemedView key={s._id} type="card" style={styles.saleCard}>
                      <View style={styles.saleTop}>
                        <View style={{ flex: 1 }}>
                          <ThemedText type="smallBold">
                            {s.items.length} product{s.items.length > 1 ? 's' : ''}
                            {s.cropName ? ` · ${s.cropName}` : ''}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {fmt(new Date(s.soldAt))}
                            {typeof s.agronomist === 'object' && s.agronomist?.name
                              ? ` · ${s.agronomist.name}`
                              : s.agronomistName
                                ? ` · ${s.agronomistName}`
                                : ''}
                          </ThemedText>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <ThemedText type="smallBold" style={{ color: GREEN }}>
                            {money(s.total)}
                          </ThemedText>
                          {/* The bill for this one sale. Opened rather than
                              fetched: the phone's browser downloads it and can
                              then share it straight to the farmer. */}
                          <Pressable
                            onPress={() =>
                              Linking.openURL(api.saleInvoicePdfUrl(s._id)).catch(() =>
                                Alert.alert('Could not open', 'Please try again.')
                              )
                            }
                            hitSlop={8}
                            style={({ pressed }) => [styles.billBtn, pressed && { opacity: 0.7 }]}>
                            <Ionicons name="download-outline" size={12} color={GREEN} />
                            <ThemedText type="small" style={styles.billBtnText}>
                              Bill
                            </ThemedText>
                          </Pressable>
                        </View>
                      </View>

                      {/* Before at handover; after once the waiting period is up. */}
                      {s.items.map((it, i) => {
                        const dueAt = s.afterDueAt ? new Date(s.afterDueAt) : null;
                        const daysLeft = dueAt
                          ? Math.ceil((dueAt.getTime() - Date.now()) / DAY_MS)
                          : 0;
                        const due = !dueAt || daysLeft <= 0;
                        return (
                          <View key={it.product} style={styles.saleItem}>
                            <View style={styles.saleItemHead}>
                              <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                                {it.name}
                              </ThemedText>
                              <ThemedText type="small" themeColor="textSecondary">
                                {it.qty} × {money(it.unitPrice)} = {money(it.lineTotal)}
                              </ThemedText>
                            </View>
                            <View style={styles.salePhotos}>
                              <View style={{ flex: 1 }}>
                                {it.beforePhotoUrl ? (
                                  <TappablePhoto
                                    uri={it.beforePhotoUrl}
                                    group={[it.beforePhotoUrl, it.afterPhotoUrl].filter(Boolean)}
                                    index={0}
                                    style={styles.salePhoto}
                                    caption={`${it.name} — before`}
                                  />
                                ) : (
                                  <View style={[styles.salePhoto, styles.salePhotoEmpty]} />
                                )}
                                <ThemedText type="small" themeColor="textSecondary" style={styles.salePhotoLabel}>
                                  Before
                                </ThemedText>
                              </View>

                              <View style={{ flex: 1 }}>
                                {it.afterPhotoUrl ? (
                                  <TappablePhoto
                                    uri={it.afterPhotoUrl}
                                    group={[it.beforePhotoUrl, it.afterPhotoUrl].filter(Boolean)}
                                    index={it.beforePhotoUrl ? 1 : 0}
                                    style={styles.salePhoto}
                                    caption={`${it.name} — after`}
                                  />
                                ) : due ? (
                                  // The wait is over — one tap to capture it.
                                  <Pressable
                                    onPress={() => setAfterFor({ saleId: s._id, index: i })}
                                    disabled={uploadingAfter}
                                    style={[styles.salePhoto, styles.afterBtn]}>
                                    {uploadingAfter ? (
                                      <ActivityIndicator color={GREEN} />
                                    ) : (
                                      <>
                                        <Ionicons name="camera-outline" size={20} color={GREEN} />
                                        <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                                          Take now
                                        </ThemedText>
                                      </>
                                    )}
                                  </Pressable>
                                ) : (
                                  <View style={[styles.salePhoto, styles.afterWait]}>
                                    <Ionicons name="time-outline" size={18} color={AMBER} />
                                    <ThemedText type="small" style={{ color: AMBER, fontWeight: '700' }}>
                                      in {daysLeft}d
                                    </ThemedText>
                                  </View>
                                )}
                                <ThemedText type="small" themeColor="textSecondary" style={styles.salePhotoLabel}>
                                  After
                                </ThemedText>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                      {s.notes ? (
                        <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                          {s.notes}
                        </ThemedText>
                      ) : null}
                    </ThemedView>
                  ))}
                </View>
              ) : null}

              {/* Removing a farmer sits on its own at the very bottom, well away
                  from the day's work, and only for farmers this agronomist
                  registered themselves. */}
              {onboardedByMe ? (
                <Pressable
                  onPress={confirmTrash}
                  disabled={trashing}
                  style={({ pressed }) => [
                    styles.trashBtn,
                    (pressed || trashing) && { opacity: 0.7 },
                  ]}>
                  {trashing ? (
                    <ActivityIndicator color={Brand.danger} size="small" />
                  ) : (
                    <Ionicons name="trash-outline" size={18} color={Brand.danger} />
                  )}
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" style={{ color: Brand.danger }}>
                      Remove this farmer
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Moves to trash — restore any time, nothing is deleted
                    </ThemedText>
                  </View>
                </Pressable>
              ) : null}
              </>
            }
            renderItem={({ item }) => {
              // Only contract crops have a Package of Practices. A regular crop's card
              // opens its details instead, so the agronomist can still correct them.
              const contract = isContract(item);
              const pop = pops[item.name.toLowerCase()];
              const dayN = dayNumber(item.dop);
              const doneCount = (item.progress ?? []).filter((p) => p.done).length;
              const total = pop?.steps.length ?? 0;
              const img = catalogImage(item.name);
              return (
                <Pressable
                  onPress={() =>
                    contract
                      ? router.push({
                          pathname: '/practices',
                          params: {
                            cropId: item._id,
                            crop: item.name,
                            dop: item.dop ?? '',
                            variety: item.variety ?? '',
                          },
                        })
                      : openEdit()
                  }
                  style={({ pressed }) => pressed && { opacity: 0.7 }}>
                  <ThemedView type="card" style={styles.card}>
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
                          {item.area != null ? ` · ${item.area} acres` : ''}
                        </ThemedText>
                        {!contract ? (
                          <ThemedText type="small" themeColor="textSecondary">
                            Regular farming
                          </ThemedText>
                        ) : item.dop ? (
                          <ThemedText type="small" themeColor="textSecondary">
                            Planted {fmt(new Date(item.dop))}
                          </ThemedText>
                        ) : (
                          // No planting date means no schedule at all — make fixing it one tap.
                          <Pressable onPress={openEdit} hitSlop={8}>
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

                    {contract ? (
                      <>
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
                      </>
                    ) : (
                      <View style={[styles.stageBox, { backgroundColor: theme.background }]}>
                        <ThemedText type="small" themeColor="textSecondary">
                          No Package of Practices — tap to edit details
                        </ThemedText>
                      </View>
                    )}
                  </ThemedView>
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>

      {afterFor && <CameraCapture onCapture={captureAfter} onClose={() => setAfterFor(null)} />}

      {/* Setting the return date on a visit already logged. A sheet rather than
          a screen: the agent is reading the visit they are scheduling from, and
          a push would take it away from them. */}
      <Modal
        visible={!!followUpFor}
        transparent
        animationType="slide"
        onRequestClose={() => setFollowUpFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setFollowUpFor(null)}>
          {/* Swallows taps meant for the form, which would otherwise reach the
              backdrop behind it and close the sheet mid-edit. */}
          <Pressable onPress={() => {}}>
            <ThemedView style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <ThemedText type="smallBold">Next follow-up</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {followUpFor
                  ? `Visit on ${fmt(new Date(followUpFor.visitedAt))}`
                  : ''}
              </ThemedText>

              <Pressable
                onPress={() => setFuPicker(true)}
                style={[
                  styles.input,
                  styles.dateBtn,
                  { backgroundColor: theme.backgroundElement, marginTop: Spacing.three },
                ]}>
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={fuDate ? GREEN : theme.textSecondary}
                />
                <ThemedText
                  style={{ flex: 1, marginLeft: Spacing.two, color: fuDate ? theme.text : theme.textSecondary }}>
                  {fuDate ? fmt(fuDate) : 'Pick a day to come back'}
                </ThemedText>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </Pressable>

              {fuPicker && (
                <DateTimePicker
                  value={fuDate ?? new Date(Date.now() + 7 * DAY_MS)}
                  mode="date"
                  minimumDate={new Date()}
                  onChange={(event, selected) => {
                    if (Platform.OS !== 'ios') setFuPicker(false);
                    if (event.type === 'set' && selected) setFuDate(selected);
                  }}
                />
              )}
              {Platform.OS === 'ios' && fuPicker && (
                <Pressable onPress={() => setFuPicker(false)} style={styles.doneBtn}>
                  <ThemedText type="linkPrimary">Done</ThemedText>
                </Pressable>
              )}

              <TextInput
                value={fuNote}
                onChangeText={setFuNote}
                placeholder="Why come back? (optional)"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.backgroundElement },
                ]}
              />

              <Pressable
                onPress={() => saveFollowUp(fuDate)}
                disabled={!fuDate || savingFu}
                style={({ pressed }) => [
                  styles.saveBtn,
                  (!fuDate || savingFu || pressed) && { opacity: 0.7 },
                ]}>
                {savingFu ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={{ color: '#fff', fontWeight: '700' }}>
                    {followUpFor?.nextFollowUpAt ? 'Update follow-up' : 'Set follow-up'}
                  </ThemedText>
                )}
              </Pressable>

              {/* A date set by mistake has to be removable, or "optional" only
                  holds until the first wrong tap. */}
              {followUpFor?.nextFollowUpAt ? (
                <Pressable
                  onPress={() => saveFollowUp(null)}
                  disabled={savingFu}
                  style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.7 }]}>
                  <ThemedText type="small" style={{ color: Brand.danger, fontWeight: '700' }}>
                    Remove follow-up
                  </ThemedText>
                </Pressable>
              ) : null}
            </ThemedView>
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
  /** Go out to the farm, sitting inside the band that says a return is owed. */
  editDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  /** Offered on the newest visit when no return date was set at the time. */
  addFollowUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `${GREEN}66`,
    backgroundColor: Brand.primarySurface,
  },
  // The reason a return was promised, as written at that visit.
  whyBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  /** The follow-up still owed, on its own tinted band so it is not read as
   *  another note about the visit that has been made. */
  followUpDue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
  fieldLabel: { marginTop: Spacing.three },
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
  },
  trashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.five,
    marginBottom: Spacing.four,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: `${Brand.danger}44`,
    backgroundColor: Brand.dangerSurface,
  },
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
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.04)',
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
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  geoBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  geoIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FF7F00', alignItems: 'center', justifyContent: 'center' },
  empty: { padding: Spacing.four, borderRadius: Spacing.three, alignItems: 'center' },
  saleCard: { padding: Spacing.three, borderRadius: Spacing.three, marginBottom: Spacing.two },
  /** Download this sale's bill, under its total where the money already is. */
  billBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: `${GREEN}55`,
    backgroundColor: Brand.primarySurface,
  },
  billBtnText: { color: GREEN, fontWeight: '700', fontSize: 11 },
  saleTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  saleItem: { marginTop: Spacing.three },
  saleItemHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  salePhotos: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  salePhoto: { width: '100%', height: 96, borderRadius: Spacing.two },
  salePhotoEmpty: { backgroundColor: 'rgba(127,127,127,0.15)' },
  afterBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: GREEN,
    backgroundColor: Brand.primarySurface,
  },
  afterWait: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: Brand.accentSurface,
  },
  salePhotoLabel: { textAlign: 'center', marginTop: Spacing.one, fontSize: 11 },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.three },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  emoji: { fontSize: 28 },
  cropIcon: { width: 40, height: 40, borderRadius: Spacing.two },
  statsRow: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.two, gap: 2 },
  stageBox: { padding: Spacing.three, borderRadius: Spacing.two, gap: 2 },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  editBody: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.one,
  },
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
    backgroundColor: '#FF7F00',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.four,
  },
});
