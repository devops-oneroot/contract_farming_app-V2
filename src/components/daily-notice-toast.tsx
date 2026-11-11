import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';

/** How long the notice stays up before sliding away on its own. */
const VISIBLE_MS = 10000;

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The once-a-day reminder for agronomists: mark attendance (log in AND log
 * out) and make 10-12 field visits.
 *
 * Shown the first time the app is opened on a given day, per user. The date it
 * was last shown is kept on the device, so it comes back tomorrow, and a second
 * person signing in on the same phone still gets theirs.
 */
export function DailyNoticeToast({ userId }: { userId?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
      setVisible(false)
    );
  };

  useEffect(() => {
    if (!userId) return;
    const key = `dailyNotice:${userId}`;
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((last) => {
        if (cancelled || last === todayKey()) return;
        // Recorded as soon as it shows: closing the app mid-toast still counts.
        AsyncStorage.setItem(key, todayKey()).catch(() => {});
        setVisible(true);
        Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
        timer.current = setTimeout(hide, VISIBLE_MS);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          top: insets.top + Spacing.two,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }],
        },
      ]}>
      <View style={styles.toast} accessibilityRole="alert">
        <View style={styles.iconWell}>
          <Ionicons name="megaphone" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold" style={styles.title}>
            Today&apos;s must-do
          </ThemedText>
          <View style={styles.line}>
            <Ionicons name="finger-print" size={13} color={Brand.accent} />
            <ThemedText type="small" style={styles.text}>
              Mark attendance without fail: press START and END on My Day (9 hours).
            </ThemedText>
          </View>
          <View style={styles.line}>
            <Ionicons name="map" size={13} color={Brand.accent} />
            <ThemedText type="small" style={styles.text}>
              Make at least 10 to 12 field visits without fail.
            </ThemedText>
          </View>
          <View style={styles.line}>
            <Ionicons name="alert-circle" size={13} color={Brand.accent} />
            <ThemedText type="small" style={styles.text}>
              START works only once a day. Use PAUSE for breaks – do not END until your day is over.
            </ThemedText>
          </View>
          <Pressable
            onPress={() => {
              hide();
              // My Day: its START / END are the attendance.
              router.push('/tracking' as never);
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
            <ThemedText type="small" style={styles.actionText}>
              Start My Day
            </ThemedText>
            <Ionicons name="arrow-forward" size={13} color={Brand.ink} />
          </Pressable>
        </View>
        <Pressable onPress={hide} hitSlop={10} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.8)" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.three, right: Spacing.three, zIndex: 100, elevation: 100 },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    backgroundColor: Brand.ink,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 14, marginBottom: 4 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  text: { color: 'rgba(255,255,255,0.92)', fontSize: 12, flex: 1, lineHeight: 17 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: Brand.accent,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
    marginTop: Spacing.two,
  },
  actionText: { color: Brand.ink, fontWeight: '800', fontSize: 12 },
});
