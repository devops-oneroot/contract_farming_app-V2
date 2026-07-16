import { Alert, Linking } from 'react-native';

import { api } from '@/lib/api';

type Agronomist = { _id?: string | null; mobile?: string | null; name?: string } | null | undefined;
type Farmer = { _id?: string | null; name?: string; mobile: string };

// Call a farmer. Preferred path: Plivo click-to-call — the backend rings the
// agronomist's phone, then connects the farmer, and records the conversation
// (visible in the dashboard Calls tab). Falls back to the device dialer if
// calling isn't configured or the request fails.
export async function callFarmer(agronomist: Agronomist, farmer: Farmer) {
  if (!farmer.mobile) return;

  // Try the recorded Plivo call first.
  if (agronomist?._id && agronomist?.mobile) {
    try {
      await api.clickToCall({
        agronomistId: agronomist._id,
        agronomistMobile: agronomist.mobile,
        farmerId: farmer._id ?? null,
        farmerName: farmer.name ?? '',
        farmerMobile: farmer.mobile,
      });
      Alert.alert('Connecting your call', 'Your phone will ring shortly to connect you to the farmer.');
      return;
    } catch {
      // fall through to direct dial
    }
  }

  // Fallback: log the attempt and open the device dialer.
  if (agronomist?._id) {
    api
      .logCall({
        agronomistId: agronomist._id,
        farmerId: farmer._id ?? null,
        farmerName: farmer.name ?? '',
        farmerMobile: farmer.mobile,
      })
      .catch(() => {});
  }
  Linking.openURL(`tel:${farmer.mobile}`).catch(() => {});
}
