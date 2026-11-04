import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ThemedText } from '@/components/themed-text';

/**
 * Full-screen in-app camera (expo-camera). Renders inside the app instead of
 * launching an external camera activity, which avoids the Android crash where
 * the OS kills the app while an external camera is open.
 *
 * A photo can also come from the gallery. Both paths hand back a plain file
 * URI through the same `onCapture`, so no caller needs to know which was used
 * — and every one of them resizes what it gets before uploading anyway.
 *
 * Why the gallery belongs here rather than beside each camera button: this
 * component is the one place every photo in the app is taken, so offering it
 * here offers it everywhere, and there is no screen left where an agronomist
 * can be stuck because the light has gone or the shot was already taken.
 *
 * `allowGallery={false}` takes it away again for the shots whose whole point
 * is that they were taken THEN AND THERE — the day's start and end. A picture
 * chosen from the roll proves nothing about where anyone was.
 */
export function CameraCapture({
  onCapture,
  onClose,
  allowGallery = true,
}: {
  onCapture: (uri: string) => void;
  onClose: () => void;
  /** Offer a gallery pick beside the shutter. Default true. */
  allowGallery?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

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

  /**
   * Full quality out of the gallery, deliberately: the callers shrink to
   * 1080px before uploading, and compressing twice only loses detail the
   * agronomist may need to zoom into later.
   */
  const pickFromGallery = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (!res.canceled && res.assets[0]?.uri) onCapture(res.assets[0].uri);
    } catch {
      // A gallery that will not open leaves the camera exactly as it was.
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

  // Permission denied
  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <ThemedText style={styles.whiteText}>Camera access is needed to take photos.</ThemedText>
        <Pressable onPress={requestPermission} style={styles.grantBtn}>
          <ThemedText type="smallBold">Grant permission</ThemedText>
        </Pressable>
        {/* The gallery needs no camera, so a refused permission must not be a
            dead end — a photo taken earlier is still a photo. Except where the
            live shot IS the point, in which case granting the camera is the
            only way through. */}
        {allowGallery ? (
          <Pressable onPress={pickFromGallery} style={styles.galleryWide}>
            <Ionicons name="images" size={18} color="#fff" />
            <ThemedText type="smallBold" style={styles.whiteText}>
              Choose from gallery
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={styles.textBtn}>
          <ThemedText style={styles.whiteText}>Cancel</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <SafeAreaView style={styles.controls} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={16} style={styles.closeBtn}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.bottomBar}>
          {/* Left of the shutter, and the empty slot on the right keeps the
              shutter itself centred — it is still the main thing to hit. Both
              slots stay in place when the gallery is off, so the shutter does
              not shift between screens. */}
          {allowGallery ? (
            <Pressable
              onPress={pickFromGallery}
              disabled={busy}
              hitSlop={10}
              accessibilityLabel="Choose a photo from the gallery"
              style={({ pressed }) => [styles.galleryBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="images" size={22} color="#fff" />
              <ThemedText style={styles.galleryText}>Gallery</ThemedText>
            </Pressable>
          ) : (
            <View style={styles.bottomSlot} />
          )}
          <Pressable onPress={snap} disabled={busy} style={styles.shutterOuter}>
            {busy ? <ActivityIndicator color="#000" /> : <View style={styles.shutterInner} />}
          </Pressable>
          <View style={styles.bottomSlot} />
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
  topBar: { flexDirection: 'row', padding: 16 },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingBottom: 32,
  },
  /** Matches the gallery button's width, so the shutter sits dead centre. */
  bottomSlot: { width: 62 },
  galleryBtn: { width: 62, alignItems: 'center', gap: 4 },
  galleryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  galleryWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
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
