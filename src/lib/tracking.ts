import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { api, TrackPoint } from './api';

export const TRACKING_TASK = 'oneroot-location-tracking';

// Which session the background task is feeding. The task runs in its own
// JS context with no access to React state, so this has to go through storage.
const SESSION_KEY = 'oneroot.tracking.sessionId';
// Fixes that could not be sent yet — a field agent spends much of the day out
// of signal, and a dropped batch is a hole in the route and the distance.
const BUFFER_KEY = 'oneroot.tracking.buffer';

// Sampling: often enough to trace a road, rarely enough to survive a workday on
// one battery. `distanceInterval` does most of the work — a parked phone stops
// producing fixes entirely rather than filling the route with jitter.
const TIME_INTERVAL_MS = 30_000;
const DISTANCE_INTERVAL_M = 25;

// A day of dead zone should not grow without limit. At one fix per 30s this is
// several hours of backlog; older points are dropped oldest-first.
const MAX_BUFFERED_POINTS = 2000;

async function readBuffer(): Promise<TrackPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    return raw ? (JSON.parse(raw) as TrackPoint[]) : [];
  } catch {
    return [];
  }
}

async function writeBuffer(points: TrackPoint[]) {
  const trimmed = points.slice(-MAX_BUFFERED_POINTS);
  await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(trimmed)).catch(() => {});
}

export async function getActiveSessionId() {
  return AsyncStorage.getItem(SESSION_KEY);
}

/**
 * Send everything buffered. The server drops points it already has (matched on
 * timestamp), so a batch that succeeded but whose response was lost is safe to
 * resend — better a duplicate request than a hole in the route.
 */
export async function flushBuffer(): Promise<number | null> {
  const sessionId = await getActiveSessionId();
  if (!sessionId) return null;

  const points = await readBuffer();
  if (!points.length) return null;

  try {
    const res = await api.addTrackPoints(sessionId, points);
    await writeBuffer([]);
    return res.distanceKm;
  } catch {
    return null; // stays buffered for the next attempt
  }
}

// Runs outside React, including while the app is backgrounded or killed.
TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] })?.locations ?? [];
  if (!locations.length) return;

  const sessionId = await getActiveSessionId();
  if (!sessionId) return; // tracking was stopped; drop the fixes

  const fresh: TrackPoint[] = locations.map((l) => ({
    latitude: l.coords.latitude,
    longitude: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null,
    at: new Date(l.timestamp).toISOString(),
  }));

  // Buffer first, then try to send. If the send fails — or the OS kills us
  // mid-request — the points are already on disk rather than lost.
  const buffered = await readBuffer();
  await writeBuffer([...buffered, ...fresh]);
  await flushBuffer();
});

/**
 * Begin tracking. Needs foreground permission AND background permission —
 * Android asks for them separately, and "while using the app" is not enough to
 * keep recording once the phone is locked.
 */
export async function startTracking(
  userId: string,
  role?: string,
  photo?: { uri: string; name: string; type: string }
) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    throw new Error('Location permission is needed to track your day.');
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    throw new Error(
      'Background location is needed so your route keeps recording with the phone locked. Enable "Allow all the time" for OneRoot in Settings.'
    );
  }

  const session = await api.startTracking(userId, role, photo);
  await AsyncStorage.setItem(SESSION_KEY, session._id);
  await writeBuffer([]);

  const already = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  if (already) await Location.stopLocationUpdatesAsync(TRACKING_TASK).catch(() => {});

  await Location.startLocationUpdatesAsync(TRACKING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: TIME_INTERVAL_MS,
    distanceInterval: DISTANCE_INTERVAL_M,
    pausesUpdatesAutomatically: false,
    // Android requires a visible notification for background location. It also
    // makes the tracking honest: the agent can always see it is running.
    foregroundService: {
      notificationTitle: 'OneRoot is tracking your day',
      notificationBody: 'Your route is being recorded. Tap END in the app to stop.',
      notificationColor: '#2E9E5B',
    },
  });

  return session;
}

/** Stop tracking and flush whatever is still buffered into the closing session. */
export async function stopTracking(photo?: { uri: string; name: string; type: string }) {
  const sessionId = await getActiveSessionId();

  const running = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(TRACKING_TASK).catch(() => {});

  if (!sessionId) return null;
  const trailing = await readBuffer();
  let session = null;
  try {
    session = await api.stopTracking(sessionId, trailing, photo);
    await writeBuffer([]);
  } catch {
    // Leave the buffer alone: the session stays open server-side and the next
    // start will close it, rather than silently discarding the day's tail.
  }
  await AsyncStorage.removeItem(SESSION_KEY);
  return session;
}

/**
 * Reconcile with the server after the app was killed or reinstalled. If the
 * server still has an open session, adopt it and make sure the task is running.
 */
export async function resumeTracking(userId: string) {
  const session = await api.currentTracking(userId).catch(() => null);
  if (!session) {
    await AsyncStorage.removeItem(SESSION_KEY);
    const running = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
    if (running) await Location.stopLocationUpdatesAsync(TRACKING_TASK).catch(() => {});
    return null;
  }

  await AsyncStorage.setItem(SESSION_KEY, session._id);
  const running = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  if (!running) {
    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bg?.status === 'granted') {
      await Location.startLocationUpdatesAsync(TRACKING_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: TIME_INTERVAL_MS,
        distanceInterval: DISTANCE_INTERVAL_M,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'OneRoot is tracking your day',
          notificationBody: 'Your route is being recorded. Tap END in the app to stop.',
          notificationColor: '#2E9E5B',
        },
      }).catch(() => {});
    }
  }
  await flushBuffer();
  return session;
}
