import { useRef, useState } from 'react';
import { StyleSheet, type TextInput as RNTextInput } from 'react-native';
import { Text } from '@/components/exo-text';

import { AUTH, AuthButton, AuthError, AuthField, AuthHeading, AuthScaffold } from '@/components/auth-scaffold';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';

/** Oneroot@ + a 10-digit number: the longest password anyone is given. */
const MAX_PASSWORD = 18;

function AuthNote({ text }: { text: string }) {
  return <Text style={styles.note}>{text}</Text>;
}

export default function LoginScreen() {
  const { signIn } = useAuth();

  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which field the error is about, so only that one turns red.
  const [errorField, setErrorField] = useState<'mobile' | 'password' | null>(null);
  const passwordRef = useRef<RNTextInput>(null);

  const fail = (msg: string, field: 'mobile' | 'password' | null = null) => {
    setError(msg);
    setErrorField(field);
  };
  const clearError = () => {
    setError(null);
    setErrorField(null);
  };

  const onSignIn = async () => {
    clearError();
    if (!/^\d{10}$/.test(mobile.trim())) return fail('Enter your 10-digit phone number.', 'mobile');
    if (!password) return fail('Please enter your password.', 'password');

    setSubmitting(true);
    try {
      await signIn(await api.login(mobile.trim(), password));
      // RootNavigation redirects to home once user is set.
    } catch (e: any) {
      const msg: string = e?.message || 'Could not sign in. Is the backend running?';
      fail(msg, /password/i.test(msg) ? 'password' : /number|registered/i.test(msg) ? 'mobile' : null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold variant="signin" title="Welcome back" subtitle="Sign in to manage your farms and field work.">
      <AuthHeading title="Sign in" subtitle="Use the phone number you registered with." />

      <AuthField
        label="Phone number"
        icon="call-outline"
        value={mobile}
        onChangeText={(t) => {
          setMobile(t.replace(/[^\d]/g, '').slice(0, 10));
          if (errorField === 'mobile') clearError();
        }}
        placeholder="10-digit phone number"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={10}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        error={errorField === 'mobile'}
      />

      <AuthField
        inputRef={passwordRef}
        secure
        label="Password"
        icon="lock-closed-outline"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          if (errorField === 'password') clearError();
        }}
        placeholder="Enter your password"
        textContentType="password"
        autoComplete="password"
        // The default password is Oneroot@ + 10 digits: 18 characters.
        maxLength={MAX_PASSWORD}
        returnKeyType="go"
        onSubmitEditing={onSignIn}
        error={errorField === 'password'}
        hint="Default password: Oneroot@ followed by your phone number (Eg: Oneroot@9876543210)"
      />

      <AuthError message={error} />

      <AuthButton label="Sign In" onPress={onSignIn} loading={submitting} />

      {/* No sign-up: accounts are created by a senior agronomist. */}
      <AuthNote text="New to OneRoot? Ask your senior agronomist to create your account." />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: 18, textAlign: 'center', fontSize: 13, color: AUTH.subtitle },
});
