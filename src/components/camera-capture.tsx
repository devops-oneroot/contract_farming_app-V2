import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ThemedText } from '@/components/themed-text';

/**
 * Full-screen in-app camera (expo-camera). Renders inside the app instead of
 * launching an external camera activity, which avoids the Android crash where
 * the OS kills the app while an external camera is open.
 *
 * Camera only - there is no gallery pick. Every photo in the app is proof of
 * something seen there and then (a visit, a sale, a disease, the day's start
 * and end), and a picture chosen from the roll proves nothing.
 * (The one exception, payment proof after a sale, offers the gallery itself -
 * a UPI screenshot only exists there. See components/payment-proof.tsx.)
 */
/**
 * The flash, cycled Off -> On -> Auto from the camera's top bar. Kept between
 * openings (for as long as the app runs), so an agent who needs it at dusk
 * does not have to switch it on again for every photo.
 */
const FLASH_ORDER: FlashMode[] = ['off', 'on', 'auto'];
const FLASH_UI: Record<FlashMode, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  off: { icon: 'flash-off', label: 'Off' },
  on: { icon: 'flash', label: 'On' },
  auto: { icon: 'flash-outline', label: 'Auto' },
};
let lastFlash: FlashMode = 'off';

export function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (uri: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<FlashMode>(lastFlash);

  const cycleFlash = () => {
    const next = FLASH_ORDER[(FLASH_ORDER.indexOf(flash) + 1) % FLASH_ORDER.length];
    lastFlash = next;
    setFlash(next);
  };

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const snap = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onCapture(photo.uri);
    } finally {
      setBusy(false);
    }
  };

  // Permission still loading
  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // Permission denied: granting the camera is the only way through.
  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <ThemedText style={styles.whiteText}>Camera access is needed to take photos.</ThemedText>
        <Pressable onPress={requestPermission} style={styles.grantBtn}>
          <ThemedText type="smallBold">Grant permission</ThemedText>
        </Pressable>
        <Pressable onPress={onClose} style={styles.textBtn}>
          <ThemedText style={styles.whiteText}>Cancel</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" flash={flash} />
      <SafeAreaView style={styles.controls} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={16} style={styles.closeBtn}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {/* Flash: Off -> On -> Auto. Highlighted while it can fire. */}
          <Pressable
            onPress={cycleFlash}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Flash ${FLASH_UI[flash].label}. Tap to change`}
            style={({ pressed }) => [styles.flashBtn, flash !== 'off' && styles.flashBtnOn, pressed && { opacity: 0.8 }]}>
            <Ionicons name={FLASH_UI[flash].icon} size={20} color={flash === 'off' ? '#fff' : '#1a1a1a'} />
            <ThemedText style={[styles.flashText, flash !== 'off' && { color: '#1a1a1a' }]}>{FLASH_UI[flash].label}</ThemedText>
          </Pressable>
        </View>
        <View style={styles.bottomBar}>
          <Pressable onPress={snap} disabled={busy} accessibilityLabel="Take photo" style={styles.shutterOuter}>
            {busy ? <ActivityIndicator color="#000" /> : <View style={styles.shutterInner} />}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 20, elevation: 20 },
  centered: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    zIndex: 20,
    elevation: 20,
  },
  whiteText: { color: '#fff', textAlign: 'center' },
  grantBtn: { backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  textBtn: { padding: 8 },
  controls: { flex: 1, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  flashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  /** Bright while the flash can fire, so it is obvious at a glance. */
  flashBtnOn: { backgroundColor: '#FFD43B' },
  flashText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The shutter alone, dead centre. */
  bottomBar: { alignItems: 'center', paddingBottom: 32 },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});
