import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { CameraCapture } from '@/components/camera-capture';
import { ThemedText } from '@/components/themed-text';
import { api, ProductSale } from '@/lib/api';

/**
 * Proof of payment for a sale already recorded: a UPI screenshot or a photo of
 * the receipt. Unlike every other photo in the app this one may come from the
 * gallery as well as the camera - a UPI payment's proof IS a screenshot, which
 * only exists in the gallery.
 *
 * Usage:
 *   const proof = usePaymentProof();
 *   proof.add(sale._id, (saved) => ...);   // asks Camera / Gallery, uploads
 *   ...
 *   {proof.overlay}                          // render once, at the screen's root
 */
export function usePaymentProof() {
  const [cameraFor, setCameraFor] = useState<{
    saleId: string;
    done?: (s: ProductSale) => void;
    cancel?: () => void;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  /** Shrink before sending: a phone photo is several MB, a receipt reads fine at 1280px. */
  const upload = async (saleId: string, uri: string, done?: (s: ProductSale) => void, cancel?: () => void) => {
    setBusy(true);
    try {
      let file = uri;
      try {
        const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1280 } }], {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        file = out.uri;
      } catch {
        // Never lose the proof because the resize failed: send it as it is.
      }
      const saved = await api.addPaymentProof(saleId, {
        uri: file,
        name: `payment-proof-${saleId}.jpg`,
        type: 'image/jpeg',
      });
      Alert.alert('Payment proof added ✓', 'It is saved with this sale.');
      done?.(saved);
    } catch (e: any) {
      // The sale itself is saved; the proof can be added later from the sales list.
      Alert.alert('Could not add the proof', `${e?.message || 'Please try again.'}
You can add it later from Products Given.`, [
        { text: 'OK', onPress: () => cancel?.() },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const fromGallery = async (saleId: string, done?: (s: ProductSale) => void, cancel?: () => void) => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (!res.canceled && res.assets[0]?.uri) await upload(saleId, res.assets[0].uri, done, cancel);
      else cancel?.();
    } catch {
      Alert.alert('Could not open the gallery', 'Please try again, or take a photo instead.', [
        { text: 'OK', onPress: () => cancel?.() },
      ]);
    }
  };

  /**
   * Ask where the proof comes from, then attach it to the sale. `done` gets
   * the saved sale; `cancel` runs when nothing was added (backed out).
   */
  const add = (saleId: string, done?: (s: ProductSale) => void, cancel?: () => void) => {
    Alert.alert(
      'Payment proof',
      'Add a UPI screenshot or a photo of the receipt.',
      [
        { text: 'Take photo', onPress: () => setCameraFor({ saleId, done, cancel }) },
        { text: 'Choose from gallery', onPress: () => fromGallery(saleId, done, cancel) },
        { text: 'Cancel', style: 'cancel', onPress: () => cancel?.() },
      ],
      { cancelable: true, onDismiss: () => cancel?.() }
    );
  };

  const overlay = (
    <>
      {cameraFor ? (
        <CameraCapture
          onCapture={(uri) => {
            const { saleId, done, cancel } = cameraFor;
            setCameraFor(null);
            upload(saleId, uri, done, cancel);
          }}
          onClose={() => {
            const { cancel } = cameraFor;
            setCameraFor(null);
            cancel?.();
          }}
        />
      ) : null}
      {busy ? (
        <View style={styles.busy} pointerEvents="auto">
          <View style={styles.busyCard}>
            <ActivityIndicator color="#fff" />
            <ThemedText type="smallBold" style={{ color: '#fff' }}>
              Uploading payment proof…
            </ThemedText>
          </View>
        </View>
      ) : null}
    </>
  );

  return { add, busy, overlay };
}

const styles = StyleSheet.create({
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    elevation: 30,
  },
  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(20,20,20,0.9)',
  },
});
