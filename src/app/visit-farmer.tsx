import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraCapture } from '@/components/camera-capture';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

const GREEN = '#2e9e5b';
const GREEN_SURFACE = '#E7F5EC';

export default function VisitFarmerScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const params = useLocalSearchParams<{
    farmerId?: string;
    farmerName?: string;
    farmerMobile?: string;
    lat?: string;
    lng?: string;
  }>();

  const [farmPhoto, setFarmPhoto] = useState<string | null>(null);
  const [farmerPhoto, setFarmerPhoto] = useState<string | null>(null);
  const [cameraFor, setCameraFor] = useState<'farm' | 'farmer' | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    params.lat && params.lng ? { lat: Number(params.lat), lng: Number(params.lng) } : null
  );
  const [locating, setLocating] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grab a fresh, accurate location on open.
  useEffect(() => {
    (async () => {
      setLocating(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // keep passed-in coords
      } finally {
        setLocating(false);
      }
    })();
  }, []);

  // Photo comes from the in-app camera (expo-camera) — no external camera app,
  // so no Android activity-recreation crash. We upload the capture directly.
  const handleCapture = (uri: string) => {
    if (cameraFor === 'farm') setFarmPhoto(uri);
    else if (cameraFor === 'farmer') setFarmerPhoto(uri);
    setCameraFor(null);
  };

  const markVisited = async () => {
    if (!user || !params.farmerId) return;
    if (!farmPhoto && !farmerPhoto) {
      setError('Please take at least one photo as proof of visit.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createVisit({
        agronomistId: user._id,
        farmerId: params.farmerId,
        farmerName: params.farmerName,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        notes: notes.trim(),
        farmPhoto: farmPhoto ? { uri: farmPhoto, name: 'farm.jpg', type: 'image/jpeg' } : undefined,
        farmerPhoto: farmerPhoto ? { uri: farmerPhoto, name: 'farmer.jpg', type: 'image/jpeg' } : undefined,
      });
      posthog?.capture('farm_visit_logged', { hasFarmPhoto: !!farmPhoto, hasFarmerPhoto: !!farmerPhoto, hasLocation: !!coords });
      Alert.alert('Visit marked ✓', `${params.farmerName ?? 'Farmer'} marked as visited.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      setError(e?.message || 'Could not save visit.');
    } finally {
      setSaving(false);
    }
  };

  // A render helper (not a component) so state updates don't remount it.
  const renderPhotoSlot = (
    uri: string | null,
    label: string,
    which: 'farm' | 'farmer',
    icon: keyof typeof Ionicons.glyphMap
  ) => (
    <View style={{ flex: 1 }}>
      <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.one }}>
        {label}
      </ThemedText>
      {uri ? (
        <Pressable onPress={() => setCameraFor(which)} style={styles.photoWrap}>
          <Image source={{ uri }} style={styles.photo} contentFit="cover" />
          <View style={styles.retake}>
            <Ionicons name="camera-reverse" size={14} color="#fff" />
            <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>Retake</ThemedText>
          </View>
        </Pressable>
      ) : (
        <Pressable onPress={() => setCameraFor(which)} style={[styles.photoBtn, { borderColor: GREEN }]}>
          <Ionicons name={icon} size={28} color={GREEN} />
          <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>Take photo</ThemedText>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">Mark Visit</ThemedText>
            <View style={{ width: 26 }} />
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle">{params.farmerName ?? 'Farmer'}</ThemedText>
            {params.farmerMobile ? (
              <ThemedText type="small" themeColor="textSecondary">{params.farmerMobile}</ThemedText>
            ) : null}

            {/* Location */}
            <View style={styles.locCard}>
              <Ionicons name="location" size={18} color={GREEN} />
              <ThemedText type="small" style={{ flex: 1 }}>
                {locating
                  ? 'Getting your location…'
                  : coords
                    ? `Location captured (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`
                    : 'Location unavailable'}
              </ThemedText>
              {locating && <ActivityIndicator size="small" color={GREEN} />}
            </View>

            {/* Photos */}
            <View style={styles.photoRow}>
              {renderPhotoSlot(farmPhoto, 'Farm photo', 'farm', 'leaf-outline')}
              {renderPhotoSlot(farmerPhoto, 'Photo with farmer', 'farmer', 'people-outline')}
            </View>

            {/* Notes */}
            <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.four }}>
              Notes (optional)
            </ThemedText>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything about this visit"
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, minHeight: 80, textAlignVertical: 'top' }]}
            />

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <Pressable onPress={markVisited} disabled={saving} style={[styles.submitBtn, { opacity: saving ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>Mark as visited</ThemedText>
                </>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* In-app camera overlay */}
      {cameraFor && <CameraCapture onCapture={handleCapture} onClose={() => setCameraFor(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  locCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.three,
  },
  photoRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.three },
  photoBtn: {
    height: 140,
    borderRadius: Spacing.four,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  photoWrap: { height: 140, borderRadius: Spacing.four, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  retake: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.four,
  },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  error: { color: '#e5484d', marginTop: Spacing.three },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    marginTop: Spacing.five,
  },
});
