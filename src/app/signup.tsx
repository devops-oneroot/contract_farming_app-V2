import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { Text } from '@/components/exo-text';

import {
  AUTH,
  AuthButton,
  AuthCheckbox,
  AuthChoice,
  AuthError,
  AuthField,
  AuthHeading,
  AuthScaffold,
  AuthSwitch,
  authStyles,
} from '@/components/auth-scaffold';
import { Brand } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { api, defaultPasswordFor, Role } from '@/lib/api';

type Coords = { latitude: number | null; longitude: number | null };
type Field = 'name' | 'mobile' | 'password';

/** Matches the server's minimum. */
const MIN_PASSWORD = 6;

const ROLES: { key: Role; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'farmer', label: 'Farmer', hint: 'Grow & sell with us', icon: 'leaf' },
  { key: 'agronomist', label: 'Agronomist', hint: 'Visit & advise farms', icon: 'flask' },
  // A senior does everything an agronomist does, and answers the crop disease
  // reports field agents send in.
  { key: 'senior_agronomist', label: 'Senior Agronomist', hint: 'Lead the agronomy team', icon: 'ribbon' },
];

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
  // Which field the error is about, so only that one turns red.
  const [errorField, setErrorField] = useState<Field | null>(null);
  const phoneRef = useRef<RNTextInput>(null);
  const passwordRef = useRef<RNTextInput>(null);

  // Ticked by default: the account gets Oneroot@<mobile>, shown in the field
  // as it is built from the number. Untick to choose your own.
  const [useDefaultPw, setUseDefaultPw] = useState(true);
  const [customPw, setCustomPw] = useState('');
  const password = useDefaultPw ? defaultPasswordFor(mobile) : customPw;

  const fail = (msg: string, field: Field | null = null) => {
    setError(msg);
    setErrorField(field);
  };
  const clearError = () => {
    setError(null);
    setErrorField(null);
  };

  const getLocation = async () => {
    setError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        fail('Location permission denied. You can continue without it.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      fail('Could not fetch location.');
    } finally {
      setLocating(false);
    }
  };

  const onSubmit = async () => {
    setError(null);
    setErrorField(null);
    if (!name.trim()) return fail('Please enter your name.', 'name');
    if (!/^\d{7,15}$/.test(mobile.trim())) return fail('Please enter a valid phone number.', 'mobile');
    if (password.length < MIN_PASSWORD) {
      return fail(`Password must be at least ${MIN_PASSWORD} characters.`, 'password');
    }

    setSubmitting(true);
    try {
      await signIn(
        await api.onboard({ role, name: name.trim(), mobile: mobile.trim(), password, location: coords })
      );
    } catch (e: any) {
      const msg: string = e?.message || 'Something went wrong. Is the backend running?';
      // "Already registered" is about the number.
      fail(msg, /registered/i.test(msg) ? 'mobile' : /password/i.test(msg) ? 'password' : null);
    } finally {
      setSubmitting(false);
    }
  };

  const hasLocation = coords.latitude != null && coords.longitude != null;

  return (
    <AuthScaffold variant="signup" title="Create account" subtitle="Join OneRoot and grow with confidence.">
      <AuthHeading title="Get started" subtitle="Tell us who you are. It takes a minute." />

      <Text style={[authStyles.label, { marginTop: 14 }]}>I am a</Text>
      {/* One role per line: full names fit, and it reads the same on any width. */}
      <View style={styles.roles} accessibilityRole="radiogroup">
        {ROLES.map((r) => (
          <AuthChoice
            key={r.key}
            label={r.label}
            hint={r.hint}
            icon={r.icon}
            selected={role === r.key}
            onPress={() => setRole(r.key)}
          />
        ))}
      </View>

      <AuthField
        label="Full name"
        icon="person-outline"
        value={name}
        onChangeText={(t) => {
          setName(t);
          if (errorField === 'name') clearError();
        }}
        placeholder="Your full name"
        autoCapitalize="words"
        textContentType="name"
        autoComplete="name"
        returnKeyType="next"
        onSubmitEditing={() => phoneRef.current?.focus()}
        error={errorField === 'name'}
      />

      <AuthField
        inputRef={phoneRef}
        label="Phone number"
        icon="call-outline"
        value={mobile}
        onChangeText={(t) => {
          setMobile(t.replace(/[^\d]/g, ''));
          if (errorField === 'mobile') clearError();
        }}
        placeholder="Enter your phone number"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={15}
        returnKeyType={useDefaultPw ? 'done' : 'next'}
        onSubmitEditing={() => !useDefaultPw && passwordRef.current?.focus()}
        error={errorField === 'mobile'}
      />

      <AuthCheckbox
        checked={useDefaultPw}
        onChange={(next) => {
          setUseDefaultPw(next);
          setCustomPw('');
          if (errorField === 'password') clearError();
          if (!next) setTimeout(() => passwordRef.current?.focus(), 50);
        }}
        label="Use default password"
        sub="Oneroot@ followed by your phone number"
      />

      {/* Keyed on the mode so switching resets the field: the default is shown
          in plain text and locked; your own starts hidden, with the eye. */}
      {useDefaultPw ? (
        <AuthField
          key="default-pw"
          label="Password"
          icon="lock-closed-outline"
          value={mobile ? password : ''}
          placeholder="Oneroot@ + your phone number"
          editable={false}
          selectTextOnFocus
          error={errorField === 'password'}
          hint="Note this down. You will use it to sign in."
        />
      ) : (
        <AuthField
          key="custom-pw"
          inputRef={passwordRef}
          secure
          label="Password"
          icon="lock-closed-outline"
          value={customPw}
          onChangeText={(t) => {
            setCustomPw(t);
            if (errorField === 'password') clearError();
          }}
          placeholder={`At least ${MIN_PASSWORD} characters`}
          textContentType="newPassword"
          autoComplete="password-new"
          returnKeyType="done"
          error={errorField === 'password'}
        />
      )}

      <Text style={[authStyles.label, { marginTop: 14 }]}>
        Location <Text style={{ color: AUTH.subtitle, fontWeight: '500' }}>(optional)</Text>
      </Text>
      <Pressable
        onPress={getLocation}
        disabled={locating}
        style={({ pressed }) => [
          styles.location,
          hasLocation
            ? { borderColor: Brand.secondary, backgroundColor: Brand.secondarySurface, borderStyle: 'solid' }
            : null,
          pressed && { opacity: 0.85 },
        ]}>
        <View
          style={[styles.locIcon, { backgroundColor: hasLocation ? Brand.secondary : Brand.primarySurface }]}>
          {locating ? (
            <ActivityIndicator size="small" color={hasLocation ? '#fff' : AUTH.btn} />
          ) : (
            <Ionicons
              name={hasLocation ? 'checkmark' : 'locate'}
              size={18}
              color={hasLocation ? '#fff' : AUTH.btn}
            />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.locTitle}>
            {locating ? 'Finding you…' : hasLocation ? 'Location added' : 'Use my current location'}
          </Text>
          <Text style={styles.locSub} numberOfLines={1}>
            {hasLocation
              ? `${coords.latitude!.toFixed(4)}, ${coords.longitude!.toFixed(4)} · tap to refresh`
              : 'Helps us connect you with nearby support'}
          </Text>
        </View>
      </Pressable>

      <AuthError message={error} />

      <AuthButton label="Create account" onPress={onSubmit} loading={submitting} />

      <AuthSwitch prompt="Already have an account?" action="Sign in" onPress={() => router.replace('/login')} />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  roles: { gap: 10 },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: AUTH.btn,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#fff',
  },
  locIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  locTitle: { fontSize: 15, fontWeight: '700', color: AUTH.heading },
  locSub: { fontSize: 12, color: AUTH.subtitle, marginTop: 1 },
});
