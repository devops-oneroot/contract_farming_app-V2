import { Image } from 'expo-image';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Photos } from '@/constants/photos';
import { Brand, LogoAspect, Logos } from '@/constants/theme';

/** Long enough to be seen, short enough not to hold anyone up in the field. */
const MIN_SHOW_MS = 1200;
const FADE_MS = 400;

/**
 * The branded opening screen: a field officer with a farmer on top, shown
 * whole, and the logo and the line below. Drawn over the app while it loads, then
 * faded away.
 *
 * In JavaScript rather than the native splash so it ships over the air; the
 * native splash (app.json) is the same picture, so one hands over to the other
 * without a visible change.
 */
export function AppSplash({ ready }: { ready: boolean }) {
  const insets = useSafeAreaInsets();
  const [minDone, setMinDone] = useState(false);
  const [gone, setGone] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const enter = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), MIN_SHOW_MS);
    // The brand settles in; the bar fills over the minimum show time.
    Animated.timing(enter, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.timing(progress, { toValue: 1, duration: MIN_SHOW_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start();
    return () => clearTimeout(t);
  }, [enter, progress]);

  useEffect(() => {
    if (!ready || !minDone) return;
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
  }, [ready, minDone, opacity]);

  if (gone) return null;
  const rise = { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] };
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity }]}
      pointerEvents={ready && minDone ? 'none' : 'auto'}>
      {/* The partnership the app exists for, filling the whole screen behind
          everything. A tall screen trims the photo's sides; anchored so the
          two people stay in. */}
      <Image
        source={Photos.splash}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        contentPosition={{ left: '30%', top: '40%' }}
        accessibilityLabel="A field officer talking with a farmer"
      />
      {/* One even dim, so the white logo and text read over the field. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim]} />
      {/* Top half left clear for the photo. */}
      <View style={{ flex: 1 }} />

      {/* Bottom half: the brand, centred. */}
      <View style={[styles.brandArea, { paddingBottom: insets.bottom + 16 }]}>
        <Animated.View style={[styles.brand, rise]}>
          <Animated.View style={{ transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}>
            <Image source={Logos.stackedWhite} style={styles.logo} contentFit="contain" accessibilityLabel="OneRoot" />
          </Animated.View>
          <Text style={styles.tagline}>Contract farming, simplified.</Text>
          <Text style={styles.sub}>From the field to the market, together.</Text>

          <View style={styles.track}>
            <Animated.View
              style={[styles.fill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['8%', '100%'] }) }]}
            />
          </View>
        </Animated.View>
        <Text style={[styles.version, { bottom: insets.bottom + 16 }]}>{versionLine()}</Text>
      </View>
    </Animated.View>
  );
}

/** "Version 1.0.0", plus the update date when running an over-the-air update. */
function versionLine() {
  const base = 'Version 1.0.0';
  if (!Updates.createdAt || Updates.isEmbeddedLaunch) return base;
  return `${base} · ${Updates.createdAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

const styles = StyleSheet.create({
  root: { zIndex: 100, backgroundColor: Brand.surface },
  dim: { backgroundColor: 'rgba(0,0,0,0.38)' },
  brandArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  brand: { alignItems: 'center' },
  logo: { width: 176, height: 176 / LogoAspect.stacked },
  tagline: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6, color: '#fff', fontSize: 21, fontWeight: '800', marginTop: 22, textAlign: 'center', letterSpacing: -0.2 },
  sub: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6, color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  track: { width: 140, height: 4, borderRadius: 2, marginTop: 24, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.3)' },
  fill: { height: '100%', borderRadius: 2, backgroundColor: Brand.primary },
  version: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
});
