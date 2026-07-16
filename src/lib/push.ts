import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/lib/api';

// Show notifications while the app is foregrounded.
Notifications.setNotificationHandler({
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
    if (!Device.isDevice) return; // push only works on a physical device

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
    // Expo Go can't get a native FCM token — ignore until a dev build is used.
  }
}
