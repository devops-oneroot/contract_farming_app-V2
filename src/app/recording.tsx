import { Ionicons } from '@expo/vector-icons';
import { usePreventRemove } from '@react-navigation/native';
import { useAudioRecorderState } from 'expo-audio';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { TextInput } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { VoiceNotePlayer } from '@/components/voice-note';
import { Brand, CardShadow, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useRecordingSession } from '@/context/recording';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Farmer, type RecordingReason } from '@/lib/api';
import { fileMeta } from '@/lib/onboarding-recorder';

/** Bars in the live level meter. */
const BARS = 36;
/** Until the server's list arrives (or if it cannot be reached). */
const DEFAULT_REASONS: RecordingReason[] = [
  { key: 'farm_visit', label: 'Farm Visit' },
  { key: 'sale', label: 'Sale' },
  { key: 'other', label: 'Other' },
];
const REASON_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  farm_visit: 'leaf-outline',
  sale: 'cart-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** -60 dB (quiet) .. 0 dB (loud) as 0..1. */
const level = (db?: number) => (db == null ? 0 : Math.max(0, Math.min(1, (db + 60) / 60)));

/**
 * Quick actions > Recording: record a field conversation, then file it with a
 * reason (required), the farmer it is about (optional) and a note.
 *
 * No length limit. The recording lives in a session above the screens
 * (context/recording), so:
 *   - while RECORDING the screen can be left: it keeps recording (notification);
 *   - while PAUSED it can: the recording is kept, and coming back here resumes it;
 *   - once STOPPED it has to be saved with a reason, or deliberately discarded.
 */
export default function RecordingScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : Brand.surface;

  const session = useRecordingSession();
  const rec = useAudioRecorderState(session.recorder, 100);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const phase = saving ? 'saving' : session.phase;
  const { uri, seconds } = session;

  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [reasons, setReasons] = useState<RecordingReason[]>(DEFAULT_REASONS);
  const [reason, setReason] = useState<RecordingReason | null>(null);
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [note, setNote] = useState('');
  const [picker, setPicker] = useState<'farmer' | 'reason' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Loaded as soon as the screen opens.
  const farmers = useAllFarmers();

  // The clock: live while recording, the kept length while paused or stopped.
  const ms =
    phase === 'recording'
      ? Math.max(rec.durationMillis ?? 0, seconds * 1000)
      : phase === 'paused'
        ? Math.max(rec.durationMillis ?? 0, seconds * 1000)
        : seconds * 1000;

  useEffect(() => {
    api.recordingReasons().then((r) => r?.length && setReasons(r)).catch(() => {});
  }, []);

  // The level meter: newest level on the right, frozen while paused.
  useEffect(() => {
    if (phase !== 'recording') return;
    setLevels((prev) => [...prev.slice(1), level(rec.metering)]);
  }, [rec.durationMillis, rec.metering, phase]);

  // A pulsing ring around the record button while it records.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (phase !== 'recording') {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const start = async () => {
    setError(null);
    try {
      const res = await session.start();
      if (res === 'denied') {
        Alert.alert('Microphone needed', 'Allow microphone access to record.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      setLevels(Array(BARS).fill(0));
    } catch (e: any) {
      setError(e?.message || 'The recorder could not start');
    }
  };

  const pause = () => {
    try {
      session.pause();
    } catch (e: any) {
      setError(e?.message || 'Could not pause');
    }
  };

  const resume = () => {
    try {
      session.resume();
    } catch (e: any) {
      setError(e?.message || 'Could not resume');
    }
  };

  const stop = async () => {
    try {
      await session.stop();
    } catch (e: any) {
      setError(e?.message || 'Could not stop the recording');
      session.reset();
    }
  };

  const clearForm = () => {
    setReason(null);
    setFarmer(null);
    setNote('');
    setError(null);
    setLevels(Array(BARS).fill(0));
  };

  const discard = () =>
    Alert.alert('Discard this recording?', 'It will be deleted and cannot be recovered.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          session.reset();
          clearForm();
        },
      },
    ]);

  const save = async () => {
    if (!uri) return;
    if (!reason) {
      setError('Choose a reason for this recording');
      return;
    }
    if (!user?._id) {
      setError('Sign in again to save recordings');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.saveRecording({
        audio: { uri, ...fileMeta(uri, 'recording') },
        reason: reason.key,
        userId: user._id,
        farmerId: farmer?._id ?? null,
        note: note.trim(),
        seconds,
        recordedAt: session.startedAt ?? undefined,
      });
      Alert.alert('Recording saved', `${reason.label}${farmer ? ` · ${farmer.name}` : ''} (${clock(seconds * 1000)})`);
      session.reset();
      setSaved(true);
    } catch (e: any) {
      setError(e?.message || 'Could not save the recording. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  // Saved: leave once the guard below has let go.
  useEffect(() => {
    if (saved && session.phase === 'idle') router.back();
  }, [saved, session.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Header back, Android back and iOS swipe: free while recording or paused -
  // the recording carries on (or waits) in the session, with its notification,
  // and coming back here shows it. Blocked only once stopped: save or discard.
  const blocked = phase === 'stopped' || phase === 'saving';
  usePreventRemove(blocked, ({ data }) => {
    if (phase === 'saving') return;
    Alert.alert('Recording not saved', 'Save it with a reason, or discard it before leaving.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Discard and leave',
        style: 'destructive',
        onPress: () => {
          session.reset();
          // Re-dispatching the blocked action goes through (React Navigation's own pattern).
          navigation.dispatch(data.action);
        },
      },
    ]);
  });

  const live = phase === 'recording' || phase === 'paused';
  const ring = {
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }],
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader onBack={() => router.back()} title="Recording" bell={false} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Recorder card */}
            <View style={[styles.card, styles.recorder, { backgroundColor: theme.card }]}>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor:
                        phase === 'recording' ? Brand.dangerSurface : phase === 'paused' ? Brand.accentSurface : theme.backgroundElement,
                    },
                  ]}>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          phase === 'recording' ? Brand.danger : phase === 'paused' ? Brand.accent : phase === 'idle' ? theme.textSecondary : Brand.secondary,
                      },
                    ]}
                  />
                  <ThemedText type="smallBold" style={{ fontSize: 12, letterSpacing: 0.6 }}>
                    {phase === 'recording' ? 'REC' : phase === 'paused' ? 'PAUSED' : phase === 'idle' ? 'READY' : 'RECORDED'}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  No time limit
                </ThemedText>
              </View>

              <ThemedText style={styles.timer}>{clock(ms)}</ThemedText>

              {/* Live level meter */}
              <View style={styles.meter}>
                {levels.map((l, i) => (
                  <View
                    key={i}
                    style={[
                      styles.bar,
                      {
                        height: 6 + l * 54,
                        backgroundColor: phase === 'recording' ? Brand.primary : theme.backgroundSelected,
                        opacity: phase === 'recording' ? 0.35 + (i / BARS) * 0.65 : 1,
                      },
                    ]}
                  />
                ))}
              </View>

              {/* Controls */}
              {phase === 'idle' && (
                <View style={styles.controls}>
                  <Pressable
                    onPress={start}
                    accessibilityLabel="Start recording"
                    style={({ pressed }) => [styles.bigBtn, { backgroundColor: Brand.danger }, pressed && styles.pressed]}>
                    <Ionicons name="mic" size={34} color="#fff" />
                  </Pressable>
                  <ThemedText type="small" themeColor="textSecondary">
                    Tap to start recording
                  </ThemedText>
                </View>
              )}

              {live && (
                <View style={styles.controlsRow}>
                  <View style={styles.ctl}>
                    <Pressable
                      onPress={phase === 'recording' ? pause : resume}
                      accessibilityLabel={phase === 'recording' ? 'Pause' : 'Resume'}
                      style={({ pressed }) => [styles.sideBtn, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
                      <Ionicons name={phase === 'recording' ? 'pause' : 'play'} size={26} color={theme.text} />
                    </Pressable>
                    <ThemedText type="small" themeColor="textSecondary">
                      {phase === 'recording' ? 'Pause' : 'Resume'}
                    </ThemedText>
                  </View>

                  <View style={styles.ctl}>
                    <View style={styles.bigWrap}>
                      {phase === 'recording' && <Animated.View style={[styles.ring, ring]} />}
                      <View style={[styles.bigBtn, { backgroundColor: phase === 'recording' ? Brand.danger : Brand.accent }]}>
                        <Ionicons name={phase === 'recording' ? 'mic' : 'mic-off'} size={34} color="#fff" />
                      </View>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {phase === 'recording' ? 'Recording…' : 'Paused'}
                    </ThemedText>
                  </View>

                  <View style={styles.ctl}>
                    <Pressable
                      onPress={stop}
                      accessibilityLabel="Stop"
                      style={({ pressed }) => [styles.sideBtn, { backgroundColor: Brand.ink }, pressed && styles.pressed]}>
                      <Ionicons name="stop" size={24} color="#fff" />
                    </Pressable>
                    <ThemedText type="small" themeColor="textSecondary">
                      Stop
                    </ThemedText>
                  </View>
                </View>
              )}

              {live && (
                <View style={[styles.hint, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons
                    name="information-circle-outline"
                    size={14}
                    color={theme.textSecondary}
                  />
                  <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                    {phase === 'recording'
                      ? 'You can go back - it keeps recording. Come back here (or use the notification) to pause or stop.'
                      : 'Paused. You can leave this screen; the recording is kept and you can resume it here.'}
                  </ThemedText>
                </View>
              )}

              {(phase === 'stopped' || phase === 'saving') && uri && (
                <View style={{ gap: Spacing.two, width: '100%' }}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Listen back
                  </ThemedText>
                  <VoiceNotePlayer uri={uri} fallbackSeconds={seconds} />
                </View>
              )}
            </View>

            {/* Details, once stopped */}
            {(phase === 'stopped' || phase === 'saving') && (
              <View style={[styles.card, { backgroundColor: theme.card, gap: Spacing.three }]}>
                <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                  Recording details
                </ThemedText>

                <Field label="Reason" required>
                  <SelectBox
                    icon={reason ? REASON_ICON[reason.key] ?? 'pricetag-outline' : 'pricetag-outline'}
                    value={reason?.label}
                    placeholder="Choose a reason"
                    invalid={!!error && !reason}
                    onPress={() => setPicker('reason')}
                  />
                </Field>

                <Field label="Farmer" hint="Optional">
                  <SelectBox
                    icon="person-outline"
                    value={farmer ? `${farmer.name} · ${farmer.mobile}` : undefined}
                    placeholder="Search and choose a farmer"
                    onPress={() => setPicker('farmer')}
                    onClear={farmer ? () => setFarmer(null) : undefined}
                  />
                </Field>

                <Field label="Note" hint="Optional">
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Anything to remember about this recording"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    maxLength={2000}
                    style={[styles.input, styles.note, { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background }]}
                  />
                </Field>
              </View>
            )}

            {error && (
              <View style={[styles.error]}>
                <Ionicons name="alert-circle" size={16} color={Brand.danger} />
                <ThemedText type="small" style={{ color: Brand.danger, flex: 1 }}>
                  {error}
                </ThemedText>
              </View>
            )}
          </ScrollView>

          {(phase === 'stopped' || phase === 'saving') && (
            <View style={[styles.footer, { backgroundColor: theme.card, borderTopColor: theme.backgroundSelected }]}>
              <Pressable
                onPress={discard}
                disabled={phase === 'saving'}
                style={({ pressed }) => [styles.secondaryBtn, { borderColor: theme.backgroundSelected }, pressed && styles.pressed]}>
                <Ionicons name="trash-outline" size={18} color={Brand.danger} />
                <ThemedText type="smallBold" style={{ color: Brand.danger }}>
                  Discard
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={phase === 'saving'}
                style={({ pressed }) => [styles.primaryBtn, (!reason || phase === 'saving') && { opacity: 0.6 }, pressed && styles.pressed]}>
                {phase === 'saving' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                )}
                <ThemedText type="smallBold" style={{ color: '#fff', fontSize: 15 }}>
                  {phase === 'saving' ? 'Saving…' : 'Save recording'}
                </ThemedText>
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ReasonSheet
        open={picker === 'reason'}
        reasons={reasons}
        selected={reason?.key}
        onPick={(r) => {
          setReason(r);
          setError(null);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <FarmerSheet
        open={picker === 'farmer'}
        all={farmers.all}
        loading={farmers.loading}
        failed={farmers.failed}
        selected={farmer?._id}
        onPick={(f) => {
          setFarmer(f);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {required ? (
          <ThemedText type="smallBold" style={{ color: Brand.danger }}>
            *
          </ThemedText>
        ) : null}
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A dropdown-style field that opens a sheet. */
function SelectBox({
  icon,
  value,
  placeholder,
  invalid,
  onPress,
  onClear,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value?: string;
  placeholder: string;
  invalid?: boolean;
  onPress: () => void;
  onClear?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.input,
        styles.select,
        { borderColor: invalid ? Brand.danger : theme.backgroundSelected, backgroundColor: theme.background },
        pressed && { opacity: 0.8 },
      ]}>
      <Ionicons name={icon} size={18} color={value ? Brand.primary : theme.textSecondary} />
      <ThemedText style={{ flex: 1, fontSize: 15 }} themeColor={value ? 'text' : 'textSecondary'} numberOfLines={1}>
        {value || placeholder}
      </ThemedText>
      {onClear ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityLabel="Clear">
          <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
        </Pressable>
      ) : (
        <Ionicons name="chevron-down" size={18} color={theme.textSecondary} />
      )}
    </Pressable>
  );
}

function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.card }]}>
        <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />
        <View style={styles.sheetHead}>
          <ThemedText type="smallBold" style={{ fontSize: 17, flex: 1 }}>
            {title}
          </ThemedText>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

function ReasonSheet({
  open,
  reasons,
  selected,
  onPick,
  onClose,
}: {
  open: boolean;
  reasons: RecordingReason[];
  selected?: string;
  onPick: (r: RecordingReason) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Sheet open={open} title="Reason" onClose={onClose}>
      <View style={{ paddingBottom: Spacing.five }}>
        {reasons.map((r) => {
          const on = r.key === selected;
          return (
            <Pressable
              key={r.key}
              onPress={() => onPick(r)}
              style={({ pressed }) => [styles.option, on && { backgroundColor: Brand.primarySurface }, pressed && { opacity: 0.8 }]}>
              <View style={[styles.optionIcon, { backgroundColor: on ? Brand.primary : theme.backgroundElement }]}>
                <Ionicons name={REASON_ICON[r.key] ?? 'pricetag-outline'} size={18} color={on ? '#fff' : Brand.primary} />
              </View>
              <ThemedText style={{ flex: 1, fontSize: 15 }}>{r.label}</ThemedText>
              {on && <Ionicons name="checkmark-circle" size={20} color={Brand.primary} />}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/** Kept between visits to the screen, so the list is there at once while it refreshes. */
let farmerCache: Farmer[] | null = null;

/**
 * Every farmer, fetched as soon as the Recording screen opens (not when the
 * picker opens), so the picker is ready by the time it is needed.
 */
function useAllFarmers() {
  const [all, setAll] = useState<Farmer[]>(farmerCache ?? []);
  const [loading, setLoading] = useState(!farmerCache);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .listAllFarmers()
      .then((list) => {
        if (!alive) return;
        const sorted = [...(list ?? [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        farmerCache = sorted;
        setAll(sorted);
        setFailed(false);
      })
      .catch(() => alive && setFailed(!farmerCache))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { all, loading, failed };
}

/** Every farmer, searched on the phone by name or mobile. */
function FarmerSheet({
  open,
  all,
  loading,
  failed,
  selected,
  onPick,
  onClose,
}: {
  open: boolean;
  all: Farmer[];
  loading: boolean;
  failed: boolean;
  selected?: string;
  onPick: (f: Farmer) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [q, setQ] = useState('');

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    const digits = t.replace(/\D/g, '');
    return all.filter(
      (f) => (f.name || '').toLowerCase().includes(t) || (digits.length > 0 && (f.mobile || '').includes(digits))
    );
  }, [all, q]);

  return (
    <Sheet open={open} title={all.length ? `Choose a farmer · ${all.length.toLocaleString('en-IN')}` : 'Choose a farmer'} onClose={onClose}>
      <View style={[styles.input, styles.select, { borderColor: theme.backgroundSelected, backgroundColor: theme.background, marginHorizontal: Spacing.four }]}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          autoFocus
          placeholder="Search name or mobile"
          placeholderTextColor={theme.textSecondary}
          style={{ flex: 1, fontSize: 15, color: theme.text, paddingVertical: 0 }}
        />
        {loading ? <ActivityIndicator size="small" color={Brand.primary} /> : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(f) => f._id}
        keyboardShouldPersistTaps="handled"
        // Long lists: render a screenful at a time.
        initialNumToRender={20}
        maxToRenderPerBatch={30}
        windowSize={10}
        style={{ maxHeight: 420 }}
        contentContainerStyle={{ paddingVertical: Spacing.two, paddingBottom: Spacing.five }}
        ListEmptyComponent={
          loading ? null : (
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', padding: Spacing.four }}>
              {failed ? 'Could not load farmers. Check your connection.' : 'No farmers match.'}
            </ThemedText>
          )
        }
        renderItem={({ item }) => {
          const on = item._id === selected;
          return (
            <Pressable
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.option, on && { backgroundColor: Brand.primarySurface }, pressed && { opacity: 0.8 }]}>
              <View style={[styles.optionIcon, { backgroundColor: on ? Brand.primary : Brand.primarySurface }]}>
                <ThemedText type="smallBold" style={{ color: on ? '#fff' : Brand.primary }}>
                  {(item.name || '?').trim().charAt(0).toUpperCase()}
                </ThemedText>
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontSize: 15 }} numberOfLines={1}>
                  {item.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {item.mobile}
                </ThemedText>
              </View>
              {on && <Ionicons name="checkmark-circle" size={20} color={Brand.primary} />}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.three },
  card: { borderRadius: Radius.xl, padding: Spacing.four, ...CardShadow },
  recorder: { alignItems: 'center', gap: Spacing.three },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  timer: { fontSize: 52, lineHeight: 60, fontWeight: '700', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  meter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, height: 64, width: '100%' },
  bar: { width: 4, borderRadius: 2 },
  controls: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', width: '100%', paddingVertical: Spacing.two },
  ctl: { alignItems: 'center', gap: 6, minWidth: 72 },
  bigWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 84, height: 84, borderRadius: 42, backgroundColor: Brand.danger },
  bigBtn: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', ...CardShadow },
  sideBtn: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.95 }], opacity: 0.9 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, width: '100%' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  select: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  note: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top', fontSize: 15 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: Brand.dangerSurface },
  footer: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: Spacing.four, height: 50, borderRadius: 14, borderWidth: 1 },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 14, backgroundColor: Brand.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: Spacing.two },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: Spacing.two },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingBottom: Spacing.three },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.four, paddingVertical: 12 },
  optionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
