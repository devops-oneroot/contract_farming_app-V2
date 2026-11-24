import { AudioModule, setAudioModeAsync, useAudioRecorder, type AudioRecorder } from 'expo-audio';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/context/auth';
import { SPEECH_PRESET } from '@/lib/onboarding-recorder';

/** Speech preset, plus the live level for the meter on the Recording screen. */
const PRESET = { ...SPEECH_PRESET, isMeteringEnabled: true };

/**
 * Keeps recording with the screen locked or the app in the background. On
 * Android that runs a foreground service, whose notification shows "Recording"
 * with a live timer, or "Recording paused" (patches/expo-audio+*.patch).
 * Needs `enableBackgroundRecording` in app.json, so a new native build.
 */
const RECORD_MODE = { allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true } as const;

export type RecPhase = 'idle' | 'recording' | 'paused' | 'stopped';

type Session = {
  /** The one recorder; the Recording screen reads its live state. */
  recorder: AudioRecorder;
  phase: RecPhase;
  /** Length so far, as of the last pause / stop. */
  seconds: number;
  /** The finished file, once stopped. */
  uri: string | null;
  /** When recording started, ISO. */
  startedAt: string | null;
  start: () => Promise<'ok' | 'denied'>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  /** Back to idle: after a save or a discard. */
  reset: () => void;
};

const Ctx = createContext<Session | null>(null);

/**
 * The Recording quick action's session, above every screen.
 *
 * It lives here and not in the Recording screen so a PAUSED recording survives
 * leaving the screen: the agronomist can go elsewhere in the app, come back and
 * resume. (While it is actually recording, the screen does not let them leave.)
 */
export function RecordingProvider({ children }: { children: ReactNode }) {
  const recorder = useAudioRecorder(PRESET);
  const { user } = useAuth();
  const [phase, setPhase] = useState<RecPhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const live = useRef(false);

  const lengthNow = useCallback(() => {
    try {
      const s = recorder.getStatus();
      return Math.round((s.durationMillis ?? recorder.currentTime * 1000) / 1000);
    } catch {
      return Math.round(recorder.currentTime || 0);
    }
  }, [recorder]);

  const start = useCallback(async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) return 'denied' as const;
    await setAudioModeAsync(RECORD_MODE);
    await recorder.prepareToRecordAsync();
    recorder.record();
    live.current = true;
    setUri(null);
    setSeconds(0);
    setStartedAt(new Date().toISOString());
    setPhase('recording');
    return 'ok' as const;
  }, [recorder]);

  const pause = useCallback(() => {
    recorder.pause();
    setSeconds(lengthNow());
    setPhase('paused');
  }, [recorder, lengthNow]);

  const resume = useCallback(() => {
    // Another recorder (a voice note, an onboarding) may have reset the audio
    // mode while this one was paused; put background recording back first.
    setAudioModeAsync(RECORD_MODE)
      .catch(() => {})
      .finally(() => recorder.record());
    setPhase('recording');
  }, [recorder]);

  const stop = useCallback(async () => {
    const secs = lengthNow();
    live.current = false;
    await recorder.stop();
    // Back to playback through the speaker, not the earpiece.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!recorder.uri) throw new Error('Nothing was recorded');
    setUri(recorder.uri);
    setSeconds(secs);
    setPhase('stopped');
  }, [recorder, lengthNow]);

  const reset = useCallback(() => {
    if (live.current) {
      live.current = false;
      recorder.stop().catch(() => {});
    }
    setUri(null);
    setSeconds(0);
    setStartedAt(null);
    setPhase('idle');
  }, [recorder]);

  // Signing out ends any recording: it belongs to that user.
  useEffect(() => {
    if (!user && phase !== 'idle') reset();
  }, [user, phase, reset]);

  const value = useMemo<Session>(
    () => ({ recorder, phase, seconds, uri, startedAt, start, pause, resume, stop, reset }),
    [recorder, phase, seconds, uri, startedAt, start, pause, resume, stop, reset]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecordingSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRecordingSession must be used within RecordingProvider');
  return ctx;
}
