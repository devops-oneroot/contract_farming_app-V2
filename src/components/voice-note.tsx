import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SPEECH_PRESET } from '@/lib/onboarding-recorder';

export type VoiceNote = { uri: string; seconds: number };

// Long enough to describe any crop problem, short enough to upload from a field
// (~2.5 MB at the speech preset's 64 kbps).
const MAX_SECONDS = 5 * 60;

function clock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Play / pause and elapsed time for one recording - a local file being
 * reviewed before sending, or the uploaded one on a report.
 */
export function VoiceNotePlayer({ uri, fallbackSeconds = 0 }: { uri: string; fallbackSeconds?: number }) {
  const theme = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const duration = status.duration || fallbackSeconds;

  useEffect(() => {
    // Back to the start once it has played through, ready to play again.
    if (status.didJustFinish) {
      player.pause();
      player.seekTo(0).catch(() => {});
    }
  }, [status.didJustFinish, player]);

  const toggle = () => (status.playing ? player.pause() : player.play());
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  return (
    <View style={[styles.player, { backgroundColor: theme.backgroundElement }]}>
      <Pressable onPress={toggle} hitSlop={8} style={styles.playBtn}>
        <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color="#fff" />
      </Pressable>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
        {clock(status.playing || status.currentTime > 0 ? status.currentTime : duration)}
      </ThemedText>
    </View>
  );
}

/**
 * Record the problem by voice instead of typing it.
 *
 * Tap to start, tap to stop; the result can be played back, and deleted to
 * record again, before the report is sent. `value` is the finished recording.
 */
export function VoiceNoteRecorder({
  value,
  onChange,
}: {
  value: VoiceNote | null;
  onChange: (note: VoiceNote | null) => void;
}) {
  const theme = useTheme();
  const recorder = useAudioRecorder(SPEECH_PRESET);
  const state = useAudioRecorderState(recorder, 250);
  const [starting, setStarting] = useState(false);
  // stop() on an idle recorder throws on Android.
  const started = useRef(false);
  const seconds = Math.floor((state.durationMillis ?? 0) / 1000);

  const start = async () => {
    if (started.current || starting) return;
    setStarting(true);
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Microphone needed',
          'Allow the microphone for OneRoot to record a voice note.',
          perm.canAskAgain
            ? [{ text: 'OK' }]
            : [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open settings', onPress: () => Linking.openSettings() },
              ]
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      started.current = true;
    } catch (e: any) {
      Alert.alert('Could not record', e?.message || 'Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!started.current) return;
    started.current = false;
    const length = Math.max(1, Math.round((state.durationMillis ?? 0) / 1000));
    try {
      await recorder.stop();
      if (recorder.uri) onChange({ uri: recorder.uri, seconds: length });
    } catch {
      Alert.alert('Could not record', 'The recording could not be saved. Please try again.');
    }
    // Recording mode routes playback to the earpiece on iOS; leave it for review.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  };

  // A note that runs on is stopped and kept, not lost.
  useEffect(() => {
    if (state.isRecording && seconds >= MAX_SECONDS) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, state.isRecording]);

  // Leaving the screen mid-recording must not leave the microphone open.
  useEffect(() => {
    return () => {
      if (started.current) {
        started.current = false;
        recorder.stop().catch(() => {});
      }
    };
  }, [recorder]);

  if (value && !state.isRecording) {
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <VoiceNotePlayer uri={value.uri} fallbackSeconds={value.seconds} />
        </View>
        <Pressable
          onPress={() => onChange(null)}
          hitSlop={8}
          style={[styles.iconBtn, { backgroundColor: theme.backgroundElement }]}
          accessibilityLabel="Delete voice note">
          <Ionicons name="trash-outline" size={18} color={Brand.danger} />
        </Pressable>
      </View>
    );
  }

  const recording = state.isRecording;
  return (
    <Pressable
      onPress={recording ? stop : start}
      disabled={starting}
      style={[
        styles.recordBtn,
        recording
          ? { backgroundColor: Brand.danger, borderColor: Brand.danger }
          : { backgroundColor: theme.backgroundElement, borderColor: Brand.primary },
        { opacity: starting ? 0.6 : 1 },
      ]}>
      <Ionicons name={recording ? 'stop' : 'mic'} size={20} color={recording ? '#fff' : Brand.primary} />
      <ThemedText type="smallBold" style={{ color: recording ? '#fff' : Brand.primary }}>
        {recording ? `Recording ${clock(seconds)} · tap to stop` : 'Record voice note'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: 4, backgroundColor: Brand.primary },
  time: { minWidth: 38, textAlign: 'right', fontVariant: ['tabular-nums'] },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
});
