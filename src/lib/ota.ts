import * as Updates from 'expo-updates';

/**
 * Apply a newer OTA update on this launch rather than the next one.
 *
 * By default expo-updates starts the bundle it already has and only swaps in a
 * newer one on the launch after it downloads - so a phone holding a broken
 * update stays broken for one more open, and a fix seems not to have arrived.
 * Here the app asks once at start-up and, when something newer exists, fetches
 * it and restarts into it straight away.
 *
 * Any failure (offline, server down) is ignored: the bundle already running
 * carries on, and the next launch tries again.
 */
export async function applyPendingUpdate() {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    if (fetched.isNew) await Updates.reloadAsync();
  } catch {
    // Keep running what we have.
  }
}
