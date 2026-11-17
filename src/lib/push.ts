import { isRunningInExpoGo } from 'expo';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { api } from '@/lib/api';

// Expo Go (SDK 53+) dropped remote push and errors as soon as expo-notifications is
// imported, so only load it in a dev/production build.
const Notifications: typeof import('expo-notifications') | null = isRunningInExpoGo()
  ? null
  : require('expo-notifications');

// Show notifications while the app is foregrounded.
Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * React to pushes: `onReceive` when one arrives while the app is open (to
 * update the bell's count), `onTap` when the person taps one (to open the
 * Notifications screen). Returns the cleanup. Does nothing in Expo Go.
 */
export function listenForPushes(onReceive: () => void, onTap: () => void) {
  if (!Notifications) return () => {};
  const received = Notifications.addNotificationReceivedListener(() => onReceive());
  const tapped = Notifications.addNotificationResponseReceivedListener(() => onTap());
  return () => {
    received.remove();
    tapped.remove();
  };
}

// Ask permission, get the device's FCM push token, and save it to the backend.
// No-ops gracefully in Expo Go / simulators / when permission is denied.
export async function registerForPush(userId: string) {
  try {
    if (!Notifications || !Device.isDevice) return; // push needs a dev build on a physical device

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    // Native FCM device token (requires google-services.json + a dev build).
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (token && String(token) !== lastSaved) {
      await api.savePushToken(userId, String(token));
      lastSaved = String(token);
    }

    // Firebase can rotate the token at any time; save the new one at once.
    if (!tokenSub) {
      tokenSub = Notifications.addPushTokenListener(({ data }) => {
        if (data && String(data) !== lastSaved) {
          api
            .savePushToken(userId, String(data))
            .then(() => {
              lastSaved = String(data);
            })
            .catch(() => {});
        }
      });
    }
  } catch {
    // No FCM token available (e.g. missing google-services.json) — ignore.
  }
}

/**
 * Called on every return to the foreground: the server clears a token
 * Firebase rejects, so this re-saves the current one. Cheap - the token is
 * cached by the OS and only sent when the server may not have it.
 */
export function refreshPushToken(userId: string) {
  lastSaved = null; // the server may have cleared it; send it again
  return registerForPush(userId);
}

let lastSaved: string | null = null;
let tokenSub: { remove: () => void } | null = null;
