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
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { CameraCapture } from '@/components/camera-capture';
import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, DayStats, TrackingSession } from '@/lib/api';
import {
  flushBuffer,
  isPaused,
  pauseTracking,
  resumePausedTracking,
  resumeTracking,
  startTracking,
  stopTracking,
} from '@/lib/tracking';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;
// Paused is neither running nor stopped, so it gets its own colour rather than
// borrowing the green of a live day or the red of an ended one.
const AMBER = '#B45309';

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
type Capturing = 'start' | 'end' | 'no_field' | 'pause';

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

  // Stepping out of the day. Kept apart from `reason` above so a half-typed
  // no-field reason can never be filed as a pause, or the other way round.
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [pausePhoto, setPausePhoto] = useState<string | null>(null);

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
    // Nothing is being recorded while paused, so there is nothing to push or
    // refresh — polling would only spend the agent's data.
    if (!session || session.endAt || isPaused(session)) return;
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

  const doPause = async () => {
    if (!pauseReason.trim()) {
      Alert.alert('Reason needed', 'Say why you are pausing.');
      return;
    }
    if (!pausePhoto) {
      Alert.alert('Photo needed', 'Take a photo of where you are pausing.');
      return;
    }
    setBusy(true);
    try {
      const uri = await shrink(pausePhoto);
      await pauseTracking(pauseReason.trim(), { uri, name: 'pause.jpg', type: 'image/jpeg' });
      posthog?.capture('tracking_paused', { reason: pauseReason.trim() });
      setPauseOpen(false);
      setPauseReason('');
      setPausePhoto(null);
      await load();
    } catch (e: any) {
      Alert.alert('Could not pause', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Backing out drops the draft, so a stale reason and photo can never be
  // filed against a later pause.
  const closePause = () => {
    setPauseOpen(false);
    setPauseReason('');
    setPausePhoto(null);
  };

  /**
   * Open the camera for a pause photo.
   *
   * The sheet is closed first: a React Native Modal is its own native window on
   * Android, so the camera — an absolutely positioned view in the activity —
   * would otherwise be drawn underneath it and the agent would be shooting
   * blind. `onCapture` puts the sheet back.
   */
  const shootPause = () => {
    setPauseOpen(false);
    setCapturing('pause');
  };

  const doResume = async () => {
    setBusy(true);
    try {
      await resumePausedTracking();
      posthog?.capture('tracking_resumed');
      await load();
    } catch (e: any) {
      Alert.alert('Could not resume', e?.message || 'Please try again.');
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
    else if (which === 'pause') {
      setPausePhoto(uri);
      setPauseOpen(true); // hidden for the shot; bring the sheet back with it
    }
  };

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
  const paused = tracking && isPaused(session);
  // The pause still running, so the screen can show when it began and why.
  const openPause = session?.pauses?.find((x) => !x.resumedAt);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader
          onBack={() => router.back()}
          title="My Day"
        />

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
            {/* The one control: start or end. */}
            <ThemedView type="card" style={styles.hero}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: paused ? AMBER : tracking ? GREEN : theme.textSecondary },
                ]}
              />
              <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                {paused ? 'Paused' : tracking ? 'Tracking your day' : 'Not tracking'}
              </ThemedText>
              {tracking && session ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    Started {fmtTime(session.startAt)} · {hhmm(session.startAt)}
                  </ThemedText>
                  {paused && openPause ? (
                    <ThemedText
                      type="small"
                      style={{ color: AMBER, textAlign: 'center', fontWeight: '700' }}>
                      Paused {fmtTime(openPause.pausedAt)} · {hhmm(openPause.pausedAt)}
                      {openPause.reason ? `\n${openPause.reason}` : ''}
                    </ThemedText>
                  ) : null}
                </>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  Start when you set off. Your route keeps recording with the phone locked.
                </ThemedText>
              )}

              <Pressable
                // END goes straight to the camera. There is no "are you sure":
                // the day is over, and the next one is a fresh START.
                onPress={() => setCapturing(tracking ? 'end' : 'start')}
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
              {/*
                * Stepping out of the day without ending it — lunch, a personal
                * errand, a breakdown. Recording stops and the distance covered
                * in between is left out of the day's kilometres.
                */}
              {tracking ? (
                <Pressable
                  onPress={() => (paused ? doResume() : setPauseOpen(true))}
                  disabled={busy}
                  style={[styles.pauseBtn, { borderColor: paused ? GREEN : AMBER, opacity: busy ? 0.6 : 1 }]}>
                  <Ionicons
                    name={paused ? 'play' : 'pause'}
                    size={18}
                    color={paused ? GREEN : AMBER}
                  />
                  <ThemedText
                    type="smallBold"
                    style={{ color: paused ? GREEN : AMBER, fontSize: 15 }}>
                    {paused ? 'RESUME' : 'PAUSE'}
                  </ThemedText>
                </Pressable>
              ) : null}

              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ fontSize: 11, textAlign: 'center' }}>
                {paused
                  ? 'Your route is not being recorded. Tap RESUME when you are back.'
                  : tracking
                    ? 'A photo is taken when you end.'
                    : 'A photo is taken when you start.'}
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
                {/* Uploaded, so expo-image can render it — unlike the local
                    file:// previews further down, which need core Image. */}
                <TappablePhoto
                  uri={session.startPhotoUrl}
                  style={styles.startPhoto}
                  caption="start photo"
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
                <ThemedView key={s.label} type="card" style={styles.statCard}>
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
                    <ThemedView key={s._id} type="card" style={styles.histRow}>
                      <Ionicons name="rainy-outline" size={18} color={Brand.accent} />
                      <View style={{ flex: 1, marginLeft: Spacing.two }}>
                        <ThemedText type="smallBold">{fmtDay(s.startAt)}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                          No field work · {s.reason}
                        </ThemedText>
                      </View>
                    </ThemedView>
                  ) : (
                    <ThemedView key={s._id} type="card" style={styles.histRow}>
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
      {/* Why the day is being paused. Required — an unexplained gap in the
          route is exactly what this is meant to prevent. */}
      <Modal visible={pauseOpen} transparent animationType="slide" onRequestClose={closePause}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: screenBg }]}>
            <View style={styles.sheetBar}>
              <Pressable onPress={closePause} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
              <ThemedText type="smallBold">Pause tracking</ThemedText>
              <View style={{ width: 24 }} />
            </View>

            <View style={styles.sheetBody}>
              <ThemedText type="small" themeColor="textSecondary">
                Your day stays open. Recording stops until you resume, and the distance you
                cover in between is left out of today&apos;s kilometres.
              </ThemedText>

              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
                Reason <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
              </ThemedText>
              <TextInput
                value={pauseReason}
                onChangeText={setPauseReason}
                placeholder="e.g. Lunch break, going home for an hour"
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[
                  styles.reasonInput,
                  { color: theme.text, backgroundColor: theme.backgroundElement },
                ]}
              />

              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
                Photo <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
              </ThemedText>
              {pausePhoto ? (
                <Pressable onPress={shootPause}>
                  <RNImage source={{ uri: pausePhoto }} style={styles.startPhoto} resizeMode="cover" />
                </Pressable>
              ) : (
                <Pressable onPress={shootPause} style={styles.photoBtn}>
                  <Ionicons name="camera-outline" size={24} color={AMBER} />
                  <ThemedText type="small" style={{ color: AMBER, fontWeight: '700' }}>
                    Take a photo
                  </ThemedText>
                </Pressable>
              )}

              <Pressable
                onPress={doPause}
                disabled={busy}
                style={[styles.bigBtn, { backgroundColor: AMBER, opacity: busy ? 0.6 : 1 }]}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Pause tracking
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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

      {capturing && (
        <CameraCapture
          onCapture={onCapture}
          // Camera only. These shots are the evidence of where the day started
          // and ended, and one picked from the roll is evidence of nothing.
          allowGallery={false}
          onClose={() => {
            // Backing out of the camera must return to the pause sheet, or the
            // reason typed a moment ago is stranded behind a closed modal.
            if (capturing === 'pause') setPauseOpen(true);
            setCapturing(null);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  pauseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    alignSelf: 'stretch',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: Spacing.three,
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
