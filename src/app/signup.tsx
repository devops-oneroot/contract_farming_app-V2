import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { AUTH, AuthScaffold, authStyles } from '@/components/auth-scaffold';
import { useAuth } from '@/context/auth';
import { api, Role } from '@/lib/api';

type Coords = { latitude: number | null; longitude: number | null };

export default function SignUpScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [role, setRole] = useState<Role>('farmer');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [coords, setCoords] = useState<Coords>({ latitude: null, longitude: null });
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneRef = useRef<TextInput>(null);

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
    if (!/^\d{7,15}$/.test(mobile.trim())) return setError('Please enter a valid phone number.');

    setSubmitting(true);
    try {
      const user = await api.onboard({ role, name: name.trim(), mobile: mobile.trim(), location: coords });
      await signIn(user);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Is the backend running?');
    } finally {
      setSubmitting(false);
    }
  };

  const hasLocation = coords.latitude != null && coords.longitude != null;

  const roleBtn = (r: Role, label: string) => {
    const on = role === r;
    return (
      <Pressable
        key={r}
        onPress={() => setRole(r)}
        style={[
          authStyles.roleBtn,
          { backgroundColor: on ? '#fff' : AUTH.input, borderColor: on ? AUTH.btn : 'transparent' },
        ]}>
        <Text style={[authStyles.roleText, { color: on ? AUTH.btn : '#374151' }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <AuthScaffold title="Create account" subtitle="Join OneRoot to manage your farms.">
      <Text style={authStyles.cardTitle}>Account</Text>
      <Text style={authStyles.cardSub}>Role, name, and phone.</Text>

      <Text style={authStyles.label}>Role</Text>
      <View style={authStyles.roleRow}>
        {roleBtn('farmer', 'Farmer')}
        {roleBtn('agronomist', 'Agronomist')}
      </View>
      {/* A senior does everything an agronomist does, and answers the crop
          disease reports field agents send in — so it sits on its own row. */}
      <View style={authStyles.roleRow}>{roleBtn('senior_agronomist', 'Senior Agronomist')}</View>

      <Text style={authStyles.label}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your full name"
        placeholderTextColor={AUTH.subtitle}
        autoCapitalize="words"
        returnKeyType="next"
        onSubmitEditing={() => phoneRef.current?.focus()}
        style={authStyles.input}
      />

      <Text style={authStyles.label}>Phone Number</Text>
      <TextInput
        ref={phoneRef}
        value={mobile}
        onChangeText={setMobile}
        placeholder="Enter your phone number"
        placeholderTextColor={AUTH.subtitle}
        keyboardType="phone-pad"
        style={authStyles.input}
      />

      <Text style={authStyles.label}>Location (optional)</Text>
      <Pressable onPress={getLocation} disabled={locating} style={authStyles.input}>
        {locating ? (
          <ActivityIndicator color={AUTH.btn} />
        ) : (
          <Text style={{ color: hasLocation ? '#1a1a1a' : AUTH.subtitle, fontSize: 16 }}>
            {hasLocation
              ? `📍 ${coords.latitude!.toFixed(4)}, ${coords.longitude!.toFixed(4)}`
              : '📍 Use my current location'}
          </Text>
        )}
      </Pressable>

      {error && <Text style={authStyles.error}>{error}</Text>}

      <Pressable
        onPress={onSubmit}
        disabled={submitting}
        style={[authStyles.primaryBtn, { opacity: submitting ? 0.7 : 1 }]}>
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Text style={authStyles.primaryText}>Continue</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </>
        )}
      </Pressable>

      <Pressable onPress={() => router.replace('/login')} style={authStyles.link}>
        <Text style={{ color: AUTH.subtitle, fontSize: 15 }}>
          Already have an account? <Text style={{ color: AUTH.btn, fontWeight: '700' }}>Sign in</Text>
        </Text>
      </Pressable>
    </AuthScaffold>
  );
}
