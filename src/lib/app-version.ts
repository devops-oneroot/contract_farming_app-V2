import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/** The app's version, from app.json ("1.0.1") - never typed by hand on a screen. */
export const appVersion: string = Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? '';

/**
 * When the code now running was made: the over-the-air update's date, or the
 * build's own date when no update has been applied yet. "17 Nov 2026".
 */
export function lastUpdatedDate(): string | null {
  const at = Updates.createdAt;
  if (!at) return null;
  return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "v1.0.1 · 17 Nov 2026" - the version with the last update date next to it. */
export function versionWithDate(): string {
  const date = __DEV__ ? 'dev' : lastUpdatedDate();
  return [`v${appVersion}`, date].filter(Boolean).join(' · ');
}
