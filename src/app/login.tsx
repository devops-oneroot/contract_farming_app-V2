import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput } from 'react-native';

import { AUTH, AuthScaffold, authStyles } from '@/components/auth-scaffold';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [mobile, setMobile] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    setError(null);
    if (!/^\d{7,15}$/.test(mobile.trim())) return setError('Please enter a valid phone number.');

    setSubmitting(true);
    try {
      const user = await api.login(mobile.trim());
      await signIn(user);
      // RootNavigation redirects to home once user is set.
    } catch (e: any) {
      setError(e?.message || 'Could not sign in. Is the backend running?');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold title="Welcome back" subtitle="Sign in to manage your farms.">
      <Text style={authStyles.cardTitle}>Account</Text>
      <Text style={authStyles.cardSub}>Sign in with your phone number.</Text>

      <Text style={authStyles.label}>Phone Number</Text>
      <TextInput
        value={mobile}
        onChangeText={setMobile}
        placeholder="Enter your phone number"
        placeholderTextColor={AUTH.subtitle}
        keyboardType="phone-pad"
        style={authStyles.input}
      />

      {error && <Text style={authStyles.error}>{error}</Text>}

      <Pressable
        onPress={onSignIn}
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

      <Pressable onPress={() => router.replace('/signup')} style={authStyles.link}>
        <Text style={{ color: AUTH.subtitle, fontSize: 15 }}>
          New user? <Text style={{ color: AUTH.btn, fontWeight: '700' }}>Create account</Text>
        </Text>
      </Pressable>
    </AuthScaffold>
  );
}
