import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
  Modal,
  Pressable,
  RefreshControl,
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
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, DayStats, TrackingSession } from '@/lib/api';
import { flushBuffer, resumeTracking, startTracking, stopTracking } from '@/lib/tracking';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

// How often the screen asks the server for the updated total while tracking.
// The route itself is sent by the background task; this is only the display.
const REFRESH_MS = 30_000;

function hhmm(from: string, to?: string | null) {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const mins = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtDay(s: string) {
  return new Date(s).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

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

/** What the camera is currently being opened for. */
type Capturing = 'start' | 'end' | 'no_field';

/**
 * Start and end a tracked work day, and see what it added up to. The route is
 * recorded by a background task, so this screen only starts, stops and reports.
 */
export default function TrackingScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [session, setSession] = useState<TrackingSession | null>(null);
  const [stats, setStats] = useState<DayStats | null>(null);
  const [history, setHistory] = useState<TrackingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Start and end each want a photo, and a day in wants a photo plus a reason.
  const [capturing, setCapturing] = useState<Capturing | null>(null);
  const [noFieldOpen, setNoFieldOpen] = useState(false);
  const [noFieldPhoto, setNoFieldPhoto] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      // Adopt whatever the server thinks is running: the app may have been
      // killed with tracking still on, and a second session would split the day.
      const [live, dayStats, past] = await Promise.all([
        resumeTracking(user._id).catch(() => null),
        api.getDayStats(user._id).catch(() => null),
        api.listTracking(user._id).catch(() => []),
      ]);
      setSession(live);
      setStats(dayStats);
      setHistory(past);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // While tracking, push anything buffered and refresh the totals.
  useEffect(() => {
    if (!session || session.endAt) return;
    const id = setInterval(async () => {
      await flushBuffer();
      if (user) api.getDayStats(user._id).then(setStats).catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [session, user]);

  const begin = async (photoUri: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const uri = await shrink(photoUri);
      const started = await startTracking(user._id, user.role, {
        uri,
        name: 'start.jpg',
        type: 'image/jpeg',
      });
      setSession(started);
      posthog?.capture('tracking_started', { role: user.role });
    } catch (e: any) {
      Alert.alert('Could not start tracking', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const end = async (photoUri: string) => {
    setBusy(true);
    try {
      const uri = await shrink(photoUri);
      const done = await stopTracking({ uri, name: 'end.jpg', type: 'image/jpeg' });
      setSession(null);
      posthog?.capture('tracking_stopped', { distanceKm: done?.distanceKm ?? 0 });
      await load();
    } catch (e: any) {
      Alert.alert('Could not stop tracking', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // The camera is shared by all three flows, so route the shot by what opened it.
  const onCapture = async (uri: string) => {
    const which = capturing;
    setCapturing(null);
    if (which === 'start') await begin(uri);
    else if (which === 'end') await end(uri);
    else if (which === 'no_field') setNoFieldPhoto(uri);
  };

  const confirmEnd = () =>
    Alert.alert('End tracking?', 'Take a photo of where you are finishing.', [
      { text: 'Keep tracking', style: 'cancel' },
      { text: 'Take end photo', onPress: () => setCapturing('end') },
    ]);

  const saveNoField = async () => {
    if (!user) return;
    if (!reason.trim()) {
      Alert.alert('Reason needed', 'Say why you could not go out today.');
      return;
    }
    setBusy(true);
    try {
      const photo = noFieldPhoto
        ? { uri: await shrink(noFieldPhoto), name: 'no-field.jpg', type: 'image/jpeg' }
        : undefined;
      await api.noFieldDay(user._id, reason.trim(), user.role, photo);
      posthog?.capture('no_field_day', { reason: reason.trim() });
      setNoFieldOpen(false);
      setNoFieldPhoto(null);
      setReason('');
      await load();
      Alert.alert('Recorded ✓', 'Your admin will see why there was no field work today.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const tracking = !!session && !session.endAt;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">My Day</ThemedText>
          <View style={{ width: 26 }} />
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
            {/* The one control: start or end. */}
            <ThemedView type="backgroundElement" style={styles.hero}>
              <View style={[styles.dot, { backgroundColor: tracking ? GREEN : theme.textSecondary }]} />
              <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                {tracking ? 'Tracking your day' : 'Not tracking'}
              </ThemedText>
              {tracking && session ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Started {fmtTime(session.startAt)} · {hhmm(session.startAt)}
                </ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  Start when you set off. Your route keeps recording with the phone locked.
                </ThemedText>
              )}

              <Pressable
                onPress={() => (tracking ? confirmEnd() : setCapturing('start'))}
                disabled={busy}
                style={[
                  styles.bigBtn,
                  { backgroundColor: tracking ? Brand.danger : GREEN, opacity: busy ? 0.6 : 1 },
                ]}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name={tracking ? 'stop-circle' : 'play-circle'} size={22} color="#fff" />
                    <ThemedText type="smallBold" style={{ color: '#fff', fontSize: 16 }}>
                      {tracking ? 'END' : 'START'}
                    </ThemedText>
                  </>
                )}
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                {tracking ? 'A photo is taken when you end.' : 'A photo is taken when you start.'}
              </ThemedText>

              {/* Some days the weather decides. Record that rather than nothing. */}
              {!tracking && (
                <Pressable onPress={() => setNoFieldOpen(true)} style={styles.noFieldLink}>
                  <Ionicons name="rainy-outline" size={16} color={Brand.accent} />
                  <ThemedText type="small" style={{ color: Brand.accent, fontWeight: '700' }}>
                    Can&apos;t go out today?
                  </ThemedText>
                </Pressable>
              )}
            </ThemedView>

            {/* The start photo, so the agent can see the day is properly open. */}
            {tracking && session?.startPhotoUrl ? (
              <View style={{ marginTop: Spacing.three }}>
                <ThemedText type="small" themeColor="textSecondary">
                  Start photo
                </ThemedText>
                <RNImage
                  source={{ uri: session.startPhotoUrl }}
                  style={styles.startPhoto}
                  resizeMode="cover"
                />
              </View>
            ) : null}

            {/* What today adds up to — the same numbers the daily report files. */}
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Today
            </ThemedText>
            <View style={styles.statGrid}>
              {[
                { label: 'Distance', value: `${stats?.distanceKm ?? 0} km`, icon: 'navigate' as const },
                { label: 'Tracked', value: `${Math.floor((stats?.trackedMinutes ?? 0) / 60)}h ${(stats?.trackedMinutes ?? 0) % 60}m`, icon: 'time' as const },
                { label: 'New onboarded', value: String(stats?.newFarmers ?? 0), icon: 'person-add' as const },
                { label: 'Existing met', value: String(stats?.oldFarmers ?? 0), icon: 'people' as const },
                { label: 'Visits', value: String(stats?.visits ?? 0), icon: 'location' as const },
                { label: 'Sales', value: `₹${(stats?.salesTotal ?? 0).toLocaleString('en-IN')}`, icon: 'cart' as const },
              ].map((s) => (
                <ThemedView key={s.label} type="backgroundElement" style={styles.statCard}>
                  <Ionicons name={s.icon} size={16} color={GREEN} />
                  <ThemedText type="smallBold" style={{ fontSize: 18 }}>
                    {s.value}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                    {s.label}
                  </ThemedText>
                </ThemedView>
              ))}
            </View>

            <Pressable
              onPress={() => router.push('/daily-report' as never)}
              style={({ pressed }) => [styles.reportBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="clipboard-outline" size={18} color={GREEN} />
              <ThemedText type="smallBold" style={{ color: GREEN }}>
                File today's report
              </ThemedText>
            </Pressable>

            {history.length > 0 && (
              <>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  Past days
                </ThemedText>
                {history.map((s) =>
                  s.kind === 'no_field' ? (
                    <ThemedView key={s._id} type="backgroundElement" style={styles.histRow}>
                      <Ionicons name="rainy-outline" size={18} color={Brand.accent} />
                      <View style={{ flex: 1, marginLeft: Spacing.two }}>
                        <ThemedText type="smallBold">{fmtDay(s.startAt)}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                          No field work · {s.reason}
                        </ThemedText>
                      </View>
                    </ThemedView>
                  ) : (
                    <ThemedView key={s._id} type="backgroundElement" style={styles.histRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="smallBold">{fmtDay(s.startAt)}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {fmtTime(s.startAt)}
                          {s.endAt ? ` – ${fmtTime(s.endAt)}` : ' · running'} · {hhmm(s.startAt, s.endAt)}
                        </ThemedText>
                      </View>
                      <ThemedText type="smallBold" style={{ color: GREEN }}>
                        {s.distanceKm} km
                      </ThemedText>
                    </ThemedView>
                  )
                )}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Why there was no field work today. */}
      <Modal visible={noFieldOpen} transparent animationType="slide" onRequestClose={() => setNoFieldOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: screenBg }]}>
            <View style={styles.sheetBar}>
              <Pressable onPress={() => setNoFieldOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
              <ThemedText type="smallBold">No field work today</ThemedText>
              <View style={{ width: 24 }} />
            </View>

            <View style={styles.sheetBody}>
              <ThemedText type="small" themeColor="textSecondary">
                Say what stopped you, and show it. Your admin sees this instead of an empty day.
              </ThemedText>

              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
                Reason <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
              </ThemedText>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Heavy rain since morning, roads flooded"
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[
                  styles.reasonInput,
                  { color: theme.text, backgroundColor: theme.backgroundElement },
                ]}
              />

              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
                Photo
              </ThemedText>
              {noFieldPhoto ? (
                <Pressable onPress={() => setCapturing('no_field')}>
                  <RNImage source={{ uri: noFieldPhoto }} style={styles.startPhoto} resizeMode="cover" />
                </Pressable>
              ) : (
                <Pressable onPress={() => setCapturing('no_field')} style={styles.photoBtn}>
                  <Ionicons name="camera-outline" size={24} color={GREEN} />
                  <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                    Take a photo
                  </ThemedText>
                </Pressable>
              )}

              <Pressable
                onPress={saveNoField}
                disabled={busy}
                style={[styles.bigBtn, { backgroundColor: GREEN, opacity: busy ? 0.6 : 1 }]}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Save
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {capturing && <CameraCapture onCapture={onCapture} onClose={() => setCapturing(null)} />}
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
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  hero: {
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Spacing.four,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    alignSelf: 'stretch',
    paddingVertical: Spacing.four,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  sectionTitle: { marginTop: Spacing.four, marginBottom: Spacing.two },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  statCard: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    borderColor: GREEN,
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  noFieldLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  startPhoto: {
    width: '100%',
    height: 160,
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
    backgroundColor: '#d8d8d8', // shows through only while the file is decoding
  },
  photoBtn: {
    height: 120,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  reasonInput: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: Spacing.one,
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
