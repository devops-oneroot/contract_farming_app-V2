import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isAgronomist, Role } from '@/lib/api';
import { ensureTrackingRunning } from '@/lib/tracking';

type Problem = 'permission' | 'services' | 'background';

// Location switched off from the quick-settings shade does not background the
// app, so AppState alone never notices it. A cheap status read this often does.
const POLL_MS = 4000;

const COPY: Record<Problem, { title: string; body: string; action: string }> = {
  permission: {
    title: 'Allow location access',
    body: 'OneRoot needs your location to record farm boundaries, visits and the distance you travel.',
    action: 'Allow location',
  },
  services: {
    title: 'Turn on location',
    body:
      Platform.OS === 'ios'
        ? 'Location is switched off on this phone. Turn it on in Settings → Privacy → Location Services.'
        : 'Location is switched off on this phone. Turn it on so your visits and travel are recorded.',
    action: 'Turn on location',
  },
  background: {
    title: 'Allow location all the time',
    body: 'Your travel is recorded while the phone is locked. Choose "Allow all the time" for OneRoot, or the kilometres you travel will be missed.',
    action: 'Open settings',
  },
};

/**
 * Keeps location usable for as long as the app is open.
 *
 * Asks for permission as soon as a signed-in user opens the app, then re-checks
 * on every return to the foreground and every few seconds while open. Whenever
 * location is off, denied, or (for agronomists, whose day is tracked) not
 * allowed in the background, a popup stays up until it is fixed. When it is
 * fixed, an open day's tracking is restarted so no more distance is lost.
 */
export function LocationGate({ role }: { role?: Role }) {
  const theme = useTheme();
  const needsBackground = isAgronomist(role);

  const [problem, setProblem] = useState<Problem | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [working, setWorking] = useState(false);

  // A system dialog is open: do not stack another check or request behind it.
  const busy = useRef(false);
  const asked = useRef(false);
  const lastProblem = useRef<Problem | null | undefined>(undefined);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      let fg = await Location.getForegroundPermissionsAsync();
      // Ask once on opening the app, before any popup is needed.
      if (fg.status !== 'granted' && fg.canAskAgain && !asked.current) {
        asked.current = true;
        fg = await Location.requestForegroundPermissionsAsync();
      }

      let next: Problem | null = null;
      let again = true;
      if (fg.status !== 'granted') {
        next = 'permission';
        again = fg.canAskAgain;
      } else if (!(await Location.hasServicesEnabledAsync())) {
        next = 'services';
      } else if (needsBackground) {
        const bg = await Location.getBackgroundPermissionsAsync();
        if (bg.status !== 'granted') {
          next = 'background';
          again = bg.canAskAgain;
        }
      }

      // Back from broken to usable: the OS may have dropped the tracking task
      // while location was off, so start it fresh.
      if (!next && needsBackground) {
        await ensureTrackingRunning(lastProblem.current != null).catch(() => {});
      }
      lastProblem.current = next;
      setProblem(next);
      setCanAskAgain(again);
    } catch {
      // A failed status read is not a reason to block the app.
    } finally {
      busy.current = false;
    }
  }, [needsBackground]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') check();
    }, POLL_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [check]);

  const fix = async () => {
    if (!problem) return;
    setWorking(true);
    busy.current = true;
    try {
      if (problem === 'services') {
        if (Platform.OS === 'android') {
          // Google's in-app "turn on location" dialog; the settings page if it is refused.
          await Location.enableNetworkProviderAsync().catch(() =>
            Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings())
          );
        } else {
          await Linking.openSettings();
        }
      } else if (!canAskAgain) {
        await Linking.openSettings();
      } else if (problem === 'permission') {
        await Location.requestForegroundPermissionsAsync();
      } else {
        await Location.requestBackgroundPermissionsAsync();
      }
    } catch {
      await Linking.openSettings().catch(() => {});
    } finally {
      busy.current = false;
      setWorking(false);
      check();
    }
  };

  if (!problem) return null;
  const copy = COPY[problem];
  const action = problem !== 'services' && !canAskAgain ? 'Open settings' : copy.action;

  return (
    // Not dismissable: back does nothing until location is usable.
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.background }]}>
          <View style={styles.icon}>
            <Ionicons name="location" size={32} color={Brand.primary} />
          </View>
          <ThemedText type="subtitle" style={styles.center}>
            {copy.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={[styles.center, { marginTop: Spacing.two }]}>
            {copy.body}
          </ThemedText>
          {problem === 'background' && Platform.OS === 'android' ? (
            <ThemedText type="small" themeColor="textSecondary" style={[styles.center, { marginTop: Spacing.two }]}>
              Settings → Permissions → Location → Allow all the time
            </ThemedText>
          ) : null}
          <Pressable onPress={fix} disabled={working} style={[styles.button, { opacity: working ? 0.6 : 1 }]}>
            {working ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText type="smallBold" style={{ color: '#fff' }}>
                {action}
              </ThemedText>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
    alignItems: 'center',
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,127,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  center: { textAlign: 'center' },
  button: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: Brand.primary,
  },
});
