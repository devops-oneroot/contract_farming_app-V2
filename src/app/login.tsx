import * as Location from 'expo-location';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { api, Role } from '@/lib/api';

type Coords = { latitude: number | null; longitude: number | null };

export default function LoginScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();

  const [role, setRole] = useState<Role>('farmer');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [coords, setCoords] = useState<Coords>({ latitude: null, longitude: null });
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getLocation = async () => {
    setError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. You can continue without it.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      setError('Could not fetch location.');
    } finally {
      setLocating(false);
    }
  };

  const onSubmit = async () => {
    setError(null);
    if (!name.trim()) return setError('Please enter your name.');
    if (!/^\d{7,15}$/.test(mobile.trim())) return setError('Please enter a valid mobile number.');

    setSubmitting(true);
    try {
      const user = await api.onboard({
        role,
        name: name.trim(),
        mobile: mobile.trim(),
        location: coords,
      });
      await signIn(user);
      // RootNavigation redirects to home once user is set.
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Is the backend running?');
    } finally {
      setSubmitting(false);
    }
  };

  const hasLocation = coords.latitude != null && coords.longitude != null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="subtitle">OneRoot</ThemedText>
          <ThemedText themeColor="textSecondary">Let&apos;s get you set up</ThemedText>
        </View>

        {/* Role selection: two sections */}
        <ThemedText type="smallBold">I am a</ThemedText>
        <View style={styles.roleRow}>
          {(['farmer', 'aggregator'] as Role[]).map((r) => {
            const selected = role === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                style={[
                  styles.roleCard,
                  {
                    backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                    borderColor: selected ? theme.text : 'transparent',
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.roleLabel}>
                  {r === 'farmer' ? '🌾 Farmer' : '🤝 Aggregator'}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        {/* Onboarding fields */}
        <ThemedText type="smallBold" style={styles.fieldLabel}>
          Name
        </ThemedText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your full name"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        <ThemedText type="smallBold" style={styles.fieldLabel}>
          Mobile number
        </ThemedText>
        <TextInput
          value={mobile}
          onChangeText={setMobile}
          placeholder="e.g. 9876543210"
          placeholderTextColor={theme.textSecondary}
          keyboardType="phone-pad"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        <ThemedText type="smallBold" style={styles.fieldLabel}>
          Location (GPS)
        </ThemedText>
        <Pressable
          onPress={getLocation}
          disabled={locating}
          style={[styles.locationBtn, { backgroundColor: theme.backgroundElement }]}>
          {locating ? (
            <ActivityIndicator color={theme.text} />
          ) : (
            <ThemedText type="small">
              {hasLocation
                ? `📍 ${coords.latitude!.toFixed(4)}, ${coords.longitude!.toFixed(4)}`
                : '📍 Use my current location'}
            </ThemedText>
          )}
        </Pressable>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <Pressable
          onPress={onSubmit}
          disabled={submitting}
          style={[styles.submitBtn, { backgroundColor: theme.text, opacity: submitting ? 0.6 : 1 }]}>
          {submitting ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              Continue
            </ThemedText>
          )}
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
    justifyContent: 'center',
  },
  header: { gap: Spacing.one, marginBottom: Spacing.four },
  roleRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  roleCard: {
    flex: 1,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 2,
  },
  roleLabel: { textAlign: 'center' },
  fieldLabel: { marginTop: Spacing.two },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  locationBtn: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  error: { color: '#e5484d', marginTop: Spacing.one },
  submitBtn: {
    marginTop: Spacing.four,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
