import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { CameraCapture } from '@/components/camera-capture';
import { SafeAreaView } from '@/components/safe-area-view';
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';
import { api, ProductSale } from '@/lib/api';

/**
 * Proof of payment for a sale already recorded: a UPI screenshot or a photo of
 * the receipt. Unlike every other photo in the app this one may come from the
 * gallery as well as the camera - a UPI payment's proof IS a screenshot, which
 * only exists in the gallery.
 *
 * Added ONCE. The photo picked is shown first, full size, where it can be
 * changed as often as needed; only "Upload" sends it, and after that it is
 * fixed (the server refuses a second one from the app).
 *
 * Usage:
 *   const proof = usePaymentProof();
 *   proof.add(sale._id, (saved) => ..., () => ...);   // pick, check, upload
 *   ...
 *   {proof.overlay}                                    // render once, at the screen's root
 */
type Job = { saleId: string; done?: (s: ProductSale) => void; cancel?: () => void };

export function usePaymentProof() {
  /** Taking a photo for this job. */
  const [cameraFor, setCameraFor] = useState<Job | null>(null);
  /** A photo picked for this job, waiting to be checked and uploaded. */
  const [preview, setPreview] = useState<(Job & { uri: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  /** Shrink before sending: a phone photo is several MB, a receipt reads fine at 1280px. */
  const upload = async (job: Job & { uri: string }) => {
    setBusy(true);
    try {
      let file = job.uri;
      try {
        const out = await ImageManipulator.manipulateAsync(job.uri, [{ resize: { width: 1280 } }], {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        file = out.uri;
      } catch {
        // Never lose the proof because the resize failed: send it as it is.
      }
      const saved = await api.addPaymentProof(job.saleId, {
        uri: file,
        name: `payment-proof-${job.saleId}.jpg`,
        type: 'image/jpeg',
      });
      setPreview(null);
      Alert.alert('Payment proof added ✓', 'It is saved with this sale.', [
        { text: 'OK', onPress: () => job.done?.(saved) },
      ]);
    } catch (e: any) {
      // The preview stays open: try again, change the photo, or close it.
      Alert.alert('Could not upload the proof', e?.message || 'Please check the internet and try again.');
    } finally {
      setBusy(false);
    }
  };

  /** `keep`: a photo is already picked (changing it), so backing out keeps that one. */
  const fromGallery = async (job: Job, keep: boolean) => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (!res.canceled && res.assets[0]?.uri) setPreview({ ...job, uri: res.assets[0].uri });
      else if (!keep) job.cancel?.();
    } catch {
      Alert.alert('Could not open the gallery', 'Please try again, or take a photo instead.');
      if (!keep) job.cancel?.();
    }
  };

  /** Camera or gallery. Used to start, and again from the preview's "Change photo". */
  const choose = (job: Job, changing = false) => {
    Alert.alert(
      changing ? 'Change photo' : 'Payment proof',
      'Add a UPI screenshot or a photo of the receipt.',
      [
        { text: 'Take photo', onPress: () => setCameraFor(job) },
        { text: 'Choose from gallery', onPress: () => fromGallery(job, changing) },
        { text: 'Cancel', style: 'cancel', onPress: () => !changing && job.cancel?.() },
      ],
      { cancelable: true, onDismiss: () => !changing && job.cancel?.() }
    );
  };

  /**
   * Pick, check and upload the proof for a sale. `done` gets the saved sale;
   * `cancel` runs when nothing was uploaded (backed out).
   */
  const add = (saleId: string, done?: (s: ProductSale) => void, cancel?: () => void) =>
    choose({ saleId, done, cancel });

  const overlay = (
    <>
      {preview ? (
        <View style={styles.preview}>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
            <View style={styles.previewHead}>
              <Pressable
                onPress={() => {
                  const { cancel } = preview;
                  setPreview(null);
                  cancel?.();
                }}
                hitSlop={12}
                disabled={busy}
                accessibilityLabel="Close without uploading"
                style={styles.roundBtn}>
                <Ionicons name="close" size={24} color="#fff" />
              </Pressable>
              <ThemedText type="smallBold" style={styles.previewTitle}>
                Check the payment proof
              </ThemedText>
            </View>
            <Image source={{ uri: preview.uri }} style={styles.previewImage} contentFit="contain" />
            <View style={styles.previewFoot}>
              <View style={styles.warnRow}>
                <Ionicons name="lock-closed-outline" size={14} color="#FFD43B" />
                <ThemedText type="small" style={styles.warnText}>
                  Make sure the amount and date are readable. Once uploaded, the proof cannot be changed.
                </ThemedText>
              </View>
              <View style={styles.previewBtns}>
                <Pressable
                  onPress={() => choose(preview, true)}
                  disabled={busy}
                  style={({ pressed }) => [styles.changeBtn, pressed && { opacity: 0.8 }]}>
                  <Ionicons name="images-outline" size={18} color="#fff" />
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Change photo
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => upload(preview)}
                  disabled={busy}
                  style={({ pressed }) => [styles.uploadBtn, (pressed || busy) && { opacity: 0.85 }]}>
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                  )}
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    {busy ? 'Uploading…' : 'Upload'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </View>
      ) : null}
      {cameraFor ? (
        <CameraCapture
          onCapture={(uri) => {
            const job = cameraFor;
            setCameraFor(null);
            setPreview({ ...job, uri });
          }}
          onClose={() => {
            const job = cameraFor;
            setCameraFor(null);
            // Backing out of the camera while changing keeps the photo already picked.
            if (!preview) job.cancel?.();
          }}
        />
      ) : null}
    </>
  );

  return { add, busy, overlay };
}

const styles = StyleSheet.create({
  preview: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 25, elevation: 25 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  previewTitle: { color: '#fff', fontSize: 16 },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: { flex: 1, marginHorizontal: 12, borderRadius: 12 },
  previewFoot: { padding: 16, gap: 14 },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  warnText: { color: 'rgba(255,255,255,0.85)', flex: 1, lineHeight: 18 },
  previewBtns: { flexDirection: 'row', gap: 12 },
  changeBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  uploadBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Brand.primary,
  },
});
