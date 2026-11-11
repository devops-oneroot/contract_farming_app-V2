import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { api, GeoPoint, TrackingPause, TrackPoint } from './api';
import { currentFix } from './location-fix';

export const TRACKING_TASK = 'oneroot-location-tracking';

// Which session the background task is feeding. The task runs in its own
// JS context with no access to React state, so this has to go through storage.
const SESSION_KEY = 'oneroot.tracking.sessionId';
// Fixes that could not be sent yet — a field agent spends much of the day out
// of signal, and a dropped batch is a hole in the route and the distance.
const BUFFER_KEY = 'oneroot.tracking.buffer';
// Set while the day is paused, so the app can tell "stopped on purpose" from
// "stopped because location went off" without asking the server - the agent is
// often offline exactly when this matters.
const PAUSED_KEY = 'oneroot.tracking.paused';
/**
 * An END the server has not confirmed yet. END is the day's attendance, so it
 * must never be lost to a dead zone: it is kept here - with the moment it was
 * pressed and where - and re-sent until the server takes it.
 */
const PENDING_STOP_KEY = 'oneroot.tracking.pendingStop';

type PendingStop = {
  sessionId: string;
  endedAt: string;
  location: GeoPoint | null;
  points: TrackPoint[];
  photo?: { uri: string; name: string; type: string };
};

async function readPendingStop(): Promise<PendingStop | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_STOP_KEY);
    return raw ? (JSON.parse(raw) as PendingStop) : null;
  } catch {
    return null;
  }
}

/**
 * Send a saved END, if there is one. Returns true when nothing is left
 * pending. Safe to call any time and repeatedly; the server takes the END at
 * the time it was pressed, not the time it arrives.
 */
export async function flushPendingStop(): Promise<boolean> {
  const pending = await readPendingStop();
  if (!pending) return true;
  const send = (photo?: PendingStop['photo']) =>
    api.stopTracking(pending.sessionId, pending.points, photo, {
      location: pending.location,
      endedAt: pending.endedAt,
    });
  try {
    try {
      await send(pending.photo);
    } catch (e: any) {
      // Still offline: keep it for next time. Anything else may be the photo
      // file gone from the cache - send without it rather than never.
      if (!pending.photo || /network|fetch/i.test(String(e?.message))) throw e;
      await send(undefined);
    }
    await AsyncStorage.removeItem(PENDING_STOP_KEY);
    return true;
  } catch (e: any) {
    // The server has no such session: nothing will ever accept this END.
    if (/not found/i.test(String(e?.message))) {
      await AsyncStorage.removeItem(PENDING_STOP_KEY).catch(() => {});
      return true;
    }
    return false;
  }
}

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
/**
 * Start the background location task, unless it is already running.
 *
 * The options live here rather than at each call site because they are the
 * contract with the OS: change the interval in one place and forget another,
 * and the route silently records at two different resolutions depending on
 * whether the day was started, resumed from a pause, or picked up on relaunch.
 */
async function beginLocationUpdates() {
  const running = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  if (running) return;

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
      notificationColor: '#FF7F00',
    },
  });
}

/** Stop the background location task, unless it is already stopped. */
async function endLocationUpdates() {
  const running = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(TRACKING_TASK).catch(() => {});
}

/** Is this session currently paused? A pause with no `resumedAt` is running. */
export function isPaused(session?: { pauses?: TrackingPause[] } | null) {
  return !!session?.pauses?.some((p) => !p.resumedAt);
}

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

  // An earlier END still waiting for signal goes first, so that day keeps its END.
  await flushPendingStop();

  // START is the day's attendance: where they are now is part of the record.
  const location = await currentFix({ required: true });
  const session = await api.startTracking(userId, role, photo, location);
  await AsyncStorage.setItem(SESSION_KEY, session._id);
  await AsyncStorage.removeItem(PAUSED_KEY);
  await writeBuffer([]);

  await endLocationUpdates();
  await beginLocationUpdates();

  return session;
}

/**
 * Pause the day: send whatever is buffered, tell the server why, and stop the
 * location updates.
 *
 * Updates are stopped rather than merely ignored so the pause costs no battery
 * and records no personal movement in the first place. The server also drops
 * any segment straddling the pause, so nothing slips through either way.
 */
export async function pauseTracking(
  reason: string,
  photo: { uri: string; name: string; type: string }
) {
  const sessionId = await getActiveSessionId();
  if (!sessionId) return null;

  await flushBuffer();
  const res = await api.pauseTracking(sessionId, reason, photo);

  await endLocationUpdates();
  await AsyncStorage.setItem(PAUSED_KEY, '1');
  return res;
}

/** Pick the day back up: restart location updates on the same session. */
export async function resumePausedTracking() {
  const sessionId = await getActiveSessionId();
  if (!sessionId) return null;

  const res = await api.resumeTracking(sessionId);
  await AsyncStorage.removeItem(PAUSED_KEY);
  await beginLocationUpdates();
  return res;
}

/**
 * Stop tracking - this is also the day's attendance END.
 *
 * The END time is taken now, when the button is pressed. If the server can't
 * be reached it is saved (with the location and the day's last points) and
 * re-sent by flushPendingStop until it lands, so a dead zone at the end of the
 * day can never turn it into an absence. Returns { session, pending }.
 */
export async function stopTracking(photo?: { uri: string; name: string; type: string }) {
  const endedAt = new Date().toISOString();
  const sessionId = await getActiveSessionId();

  // Unconditionally, and before anything can fail: whatever else happens, the
  // phone must stop recording. Already stopped if the day was paused.
  await endLocationUpdates();

  if (!sessionId) return { session: null, pending: false };
  // Where they ended. Best effort and quick: a GPS that can't answer must not
  // stand between the agent and ending their day.
  const location = await currentFix({ required: false, timeoutMs: 10000 }).catch(() => null);
  const trailing = await readBuffer();
  let session = null;
  let pending = false;
  try {
    session = await api.stopTracking(sessionId, trailing, photo, { location, endedAt });
  } catch {
    const stop: PendingStop = { sessionId, endedAt, location, points: trailing, photo };
    await AsyncStorage.setItem(PENDING_STOP_KEY, JSON.stringify(stop)).catch(() => {});
    pending = true;
  }
  // Either sent, or now inside the pending END - not left for a later session.
  await writeBuffer([]);
  await AsyncStorage.multiRemove([SESSION_KEY, PAUSED_KEY]);
  return { session, pending };
}

/**
 * Reconcile with the server after the app was killed or reinstalled. If the
 * server still has an open session, adopt it and make sure the task is running.
 */
export async function resumeTracking(userId: string) {
  // An END still waiting for signal goes first. Until it lands, the server
  // still thinks that day is running - it must not be adopted and restarted.
  const pendingClear = await flushPendingStop();
  const pendingStop = pendingClear ? null : await readPendingStop();

  const fetched = await api.currentTracking(userId).catch(() => null);
  const session = fetched && fetched._id === pendingStop?.sessionId ? null : fetched;
  if (!session) {
    await AsyncStorage.multiRemove([SESSION_KEY, PAUSED_KEY]);
    const running = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
    if (running) await Location.stopLocationUpdatesAsync(TRACKING_TASK).catch(() => {});
    return null;
  }

  await AsyncStorage.setItem(SESSION_KEY, session._id);

  if (isPaused(session)) {
    // The day is open but the agent stepped out of it. Reopening the app must
    // not quietly start recording again — only the RESUME button does that.
    await AsyncStorage.setItem(PAUSED_KEY, '1');
    await endLocationUpdates();
  } else {
    await AsyncStorage.removeItem(PAUSED_KEY);
    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bg?.status === 'granted') await beginLocationUpdates().catch(() => {});
  }

  await flushBuffer();
  return session;
}

/**
 * Signing out on this phone: send what is buffered, stop recording, and forget
 * the session here. The day stays open on the server - signing back in picks
 * it up again (resumeTracking) - but this phone must not keep feeding it, or
 * feed it from whoever signs in next.
 */
export async function detachTracking() {
  await flushBuffer().catch(() => null);
  await endLocationUpdates();
  await AsyncStorage.multiRemove([SESSION_KEY, PAUSED_KEY, BUFFER_KEY]).catch(() => {});
}

/**
 * Make sure an open, unpaused day is actually recording.
 *
 * Switching location off, or revoking the permission, can stop the OS task
 * while the day stays open - every fix until it is restarted is lost distance.
 * Called by the location gate whenever location is usable again; `restart`
 * forces a fresh start, since a task that survived location being off may
 * still be registered yet never deliver another fix.
 *
 * Works from local state only, so it re-arms tracking with no signal.
 */
export async function ensureTrackingRunning(restart = false) {
  // Location (and often signal) just came back: a good moment to land an END
  // that is still waiting.
  flushPendingStop().catch(() => {});
  const [[, sessionId], [, paused]] = await AsyncStorage.multiGet([SESSION_KEY, PAUSED_KEY]);
  if (!sessionId || paused) return;

  const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (bg?.status !== 'granted') return;

  if (restart) await endLocationUpdates();
  await beginLocationUpdates();
  await flushBuffer();
}
