import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import type { TextInput as RNTextInput } from 'react-native';

import {
  AuthButton,
  AuthError,
  AuthField,
  AuthHeading,
  AuthScaffold,
  AuthSwitch,
} from '@/components/auth-scaffold';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';

export default function LoginScreen() {
  const router = useRouter();
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
    if (!/^\d{7,15}$/.test(mobile.trim())) return fail('Please enter a valid phone number.', 'mobile');
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
          setMobile(t.replace(/[^\d]/g, ''));
          if (errorField === 'mobile') clearError();
        }}
        placeholder="Enter your phone number"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={15}
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
        returnKeyType="go"
        onSubmitEditing={onSignIn}
        error={errorField === 'password'}
        hint="Default password: Oneroot@ followed by your phone number (Eg: Oneroot@9876543210)"
      />

      <AuthError message={error} />

      <AuthButton label="Sign In" onPress={onSignIn} loading={submitting} />

      <AuthSwitch prompt="New to OneRoot?" action="Create account" onPress={() => router.replace('/signup')} />
    </AuthScaffold>
  );
}
