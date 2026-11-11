import * as Location from 'expo-location';

import type { GeoPoint } from '@/lib/api';

/** A fix older than this is not "where you are now". */
const MAX_FIX_AGE_MS = 2 * 60 * 1000;

/**
 * Where the agent is right now - for stamping attendance on START / END.
 *
 * A fresh fix first; if the GPS cannot give one in `timeoutMs`, a fix from the
 * last two minutes. Anything older could place the attendance somewhere the
 * agent has since left, so it is not used: throws, or with `required: false`
 * returns null (END must never be blocked by a GPS hiccup).
 */
export async function currentFix(
  opts: { required?: boolean; timeoutMs?: number } = {}
): Promise<GeoPoint | null> {
  const { required = true, timeoutMs = 15000 } = opts;
  const fail = (msg: string) => {
    if (required) throw new Error(msg);
    return null;
  };

  const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
  const granted =
    perm?.status === 'granted' ||
    (await Location.requestForegroundPermissionsAsync().catch(() => null))?.status === 'granted';
  if (!granted) return fail('Location permission is needed. Allow it in Settings.');

  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_FIX_AGE_MS }).catch(() => null);
    if (last) return { latitude: last.coords.latitude, longitude: last.coords.longitude };
    return fail('Could not get your location. Turn on location (GPS) and try again.');
  }
}
