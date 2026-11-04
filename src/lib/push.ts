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
    if (token) await api.savePushToken(userId, String(token));
  } catch {
    // No FCM token available (e.g. missing google-services.json) — ignore.
  }
}
