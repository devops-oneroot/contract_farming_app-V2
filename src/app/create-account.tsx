import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInput as RNTextInput,
} from 'react-native';
import { Text } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';

import {
  AuthButton,
  AuthCheckbox,
  AuthChoice,
  AuthError,
  AuthField,
  authStyles,
} from '@/components/auth-scaffold';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, defaultPasswordFor, isSenior, type AccountRole } from '@/lib/api';

type Field = 'name' | 'mobile' | 'password';

/** Matches the server's minimum. */
const MIN_PASSWORD = 6;
/** The longest password the sign-in screen takes: Oneroot@ + a 10-digit number. */
const MAX_PASSWORD = 18;

const ROLES: { key: AccountRole; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'agronomist', label: 'Agronomist', hint: 'Visits & advises farms', icon: 'flask' },
  { key: 'senior_agronomist', label: 'Senior Agronomist', hint: 'Leads the agronomy team', icon: 'ribbon' },
];

/**
 * Create account - a senior agronomist adds a field agent (or another senior).
 *
 * There is no sign-up in the app any more: people get their account from a
 * senior, who hands them the number and password to sign in with. The new
 * person is not signed in here; the senior stays signed in as themselves.
 */
export default function CreateAccountScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useColorScheme();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : Brand.surface;

  const [role, setRole] = useState<AccountRole>('agronomist');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [useDefaultPw, setUseDefaultPw] = useState(true);
  const [customPw, setCustomPw] = useState('');
  const password = useDefaultPw ? defaultPasswordFor(mobile) : customPw;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<Field | null>(null);
  const phoneRef = useRef<RNTextInput>(null);
  const passwordRef = useRef<RNTextInput>(null);

  const fail = (msg: string, field: Field | null = null) => {
    setError(msg);
    setErrorField(field);
  };
  const clearError = () => {
    setError(null);
    setErrorField(null);
  };

  const reset = () => {
    setName('');
    setMobile('');
    setCustomPw('');
    setUseDefaultPw(true);
    setRole('agronomist');
  };

  const onSubmit = async () => {
    clearError();
    if (!name.trim()) return fail('Please enter their name.', 'name');
    if (!/^\d{10}$/.test(mobile)) return fail('Enter a 10-digit mobile number.', 'mobile');
    if (password.length < MIN_PASSWORD) return fail(`Password must be at least ${MIN_PASSWORD} characters.`, 'password');

    setSubmitting(true);
    try {
      const made = await api.createAccount({
        role,
        name: name.trim(),
        mobile,
        password,
        location: { latitude: null, longitude: null },
      });
      const label = ROLES.find((r) => r.key === role)?.label ?? 'Agronomist';
      Alert.alert(
        'Account created ✓',
        `${made.name} (${label}) can now sign in.\n\nMobile: ${mobile}\nPassword: ${password}\n\nShare these with them.`,
        [
          { text: 'Create another', onPress: reset },
          { text: 'Done', onPress: () => router.back() },
        ]
      );
    } catch (e: any) {
      const msg: string = e?.message || 'Could not create the account.';
      fail(msg, /registered|mobile|number/i.test(msg) ? 'mobile' : /password/i.test(msg) ? 'password' : null);
    } finally {
      setSubmitting(false);
    }
  };

  // Only a senior may create accounts (the server checks too).
  if (!isSenior(user?.role)) {
    return (
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <ScreenHeader onBack={() => router.back()} title="Create account" />
          <View style={styles.denied}>
            <Ionicons name="lock-closed-outline" size={32} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
              Only a senior agronomist can create accounts.
            </ThemedText>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScreenHeader onBack={() => router.back()} title="Create account" />
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary">
              Add a team member. They sign in with the mobile number and password you set here.
            </ThemedText>

            <Text style={[authStyles.label, { marginTop: 14 }]}>Role</Text>
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
              placeholder="Their full name"
              autoCapitalize="words"
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
              error={errorField === 'name'}
            />

            <AuthField
              inputRef={phoneRef}
              label="Mobile number"
              icon="call-outline"
              value={mobile}
              onChangeText={(t) => {
                setMobile(t.replace(/[^\d]/g, '').slice(0, 10));
                if (errorField === 'mobile') clearError();
              }}
              placeholder="10-digit mobile number"
              keyboardType="phone-pad"
              maxLength={10}
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
              sub="Oneroot@ followed by their mobile number"
            />

            {useDefaultPw ? (
              <AuthField
                key="default-pw"
                label="Password"
                icon="lock-closed-outline"
                value={mobile ? password : ''}
                placeholder="Oneroot@ + their mobile number"
                editable={false}
                selectTextOnFocus
                error={errorField === 'password'}
                hint="Share this with them. They use it to sign in."
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
                placeholder={`${MIN_PASSWORD} to ${MAX_PASSWORD} characters`}
                maxLength={MAX_PASSWORD}
                returnKeyType="done"
                error={errorField === 'password'}
              />
            )}

            <AuthError message={error} />
            <AuthButton label="Create account" onPress={onSubmit} loading={submitting} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  roles: { gap: 10 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.five },
});
