import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';

/**
 * Speech, in a format a browser can actually play.
 *
 * NOT `RecordingPresets.LOW_QUALITY`: on Android that yields .3gp/amr_nb, which
 * Cloudinary refuses and no browser can play — the dashboard needs to open these
 * in an <audio> tag. HIGH_QUALITY is .m4a/AAC everywhere; mono at 64 kbps keeps
 * it to roughly half a megabyte per minute, which a field connection can carry.
 */
export const SPEECH_PRESET = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
};

/** The stored file keeps the upload's extension, so send the real one. */
export function fileMeta(uri: string, base = 'onboarding') {
  const ext = (uri.split('.').pop() || 'm4a').split('?')[0].toLowerCase();
  const mime: Record<string, string> = {
    m4a: 'audio/m4a',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    '3gp': 'audio/3gpp',
    caf: 'audio/x-caf',
    wav: 'audio/wav',
    webm: 'audio/webm',
  };
  return { name: `${base}.${ext}`, type: mime[ext] ?? 'audio/m4a' };
}

/**
 * Records the conversation while a farmer is being onboarded.
 *
 * Starts when the screen opens and stops the moment the farmer is saved, so the
 * recording covers exactly the conversation that produced the registration. The
 * upload is deliberately separate from the onboarding request: a farmer must
 * never fail to register because a several-megabyte file could not be sent.
 */
export function useOnboardingRecorder() {
  const recorder = useAudioRecorder(SPEECH_PRESET);
  const state = useAudioRecorderState(recorder);
  const [permitted, setPermitted] = useState<boolean | null>(null);
  // Surfaced to the screen: a swallowed upload failure is indistinguishable
  // from "recording was never on", which makes this impossible to diagnose.
  const [error, setError] = useState<string | null>(null);
  // Tracks whether we actually started, so stop() cannot be called on an idle
  // recorder — that throws on Android.
  const started = useRef(false);

  const begin = useCallback(async () => {
    if (started.current) return;
    try {
      const granted = await AudioModule.requestRecordingPermissionsAsync();
      setPermitted(granted.granted);
      if (!granted.granted) return;

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      started.current = true;
      setError(null);
    } catch (e: any) {
      // Recording is evidence, not the job — never block onboarding over it,
      // but say why it is not running rather than looking like it is.
      setPermitted(false);
      setError(e?.message || 'Recorder could not start');
    }
  }, [recorder]);

  /** Stop and return the local file, or null if nothing was captured. */
  const finish = useCallback(async () => {
    if (!started.current) return null;
    started.current = false;
    try {
      await recorder.stop();
      return recorder.uri ?? null;
    } catch {
      return null;
    }
  }, [recorder]);

  /**
   * Stop, then attach the file to the farmer that was just created. Failures are
   * swallowed: the farmer exists either way, and a missing recording is a far
   * smaller problem than a lost registration.
   */
  const finishAndUpload = useCallback(
    async (farmerId: string) => {
      const seconds = Math.round((state.durationMillis ?? 0) / 1000);
      const uri = await finish();
      if (!uri || !farmerId) {
        setError(uri ? null : 'Nothing was recorded');
        return false;
      }
      try {
        await api.saveOnboardingAudio(farmerId, { uri, ...fileMeta(uri) }, seconds);
        setError(null);
        return true;
      } catch (e: any) {
        setError(e?.message || 'Recording could not be uploaded');
        return false;
      }
    },
    [finish, state.durationMillis]
  );

  // Leaving the screen without finishing — a cancelled onboarding — must not
  // leave the microphone open.
  useEffect(() => {
    return () => {
      if (started.current) {
        started.current = false;
        recorder.stop().catch(() => {});
      }
    };
  }, [recorder]);

  return {
    begin,
    finishAndUpload,
    /** True once audio is actually being captured. */
    recording: state.isRecording,
    /** Null until asked, false when the agent declined the microphone. */
    permitted,
    /** Why recording or upload failed, when it did. */
    error,
    durationMillis: state.durationMillis ?? 0,
  };
}
