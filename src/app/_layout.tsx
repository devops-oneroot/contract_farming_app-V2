import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { PostHogProvider } from 'posthog-react-native';
import { useEffect } from 'react';
import { LogBox, useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/context/auth';
import { registerForPush } from '@/lib/push';

// PostHog analytics (public client key — safe to ship).
const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

// Benign dev-only rejection from expo-keep-awake when the app is briefly backgrounded
// (e.g. while the camera is open). Harmless; not present in production builds. See expo/expo#23390.
LogBox.ignoreLogs(['Unable to activate keep awake']);

SplashScreen.preventAutoHideAsync();

function RootNavigation() {
  const { user, loading, onboarded } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    SplashScreen.hideAsync();

    const seg = segments[0];
    const inAuthScreen = seg === 'login' || seg === 'signup';
    const inOnboarding = seg === 'onboarding';

    if (user) {
      // Not bounced out of onboarding: Profile's "View intro again" opens it deliberately.
      if (inAuthScreen) router.replace('/');
    } else if (!onboarded) {
      if (!inOnboarding) router.replace('/onboarding');
    } else if (!inAuthScreen) {
      router.replace('/login');
    }
  }, [user, loading, onboarded, segments, router]);

  // Register this device for push notifications once signed in.
  useEffect(() => {
    if (user?._id) registerForPush(user._id);
  }, [user?._id]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const app = (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RootNavigation />
      </AuthProvider>
    </ThemeProvider>
  );

  // Wrap in PostHog analytics when a key is configured (autocaptures screens + taps).
  if (!POSTHOG_KEY) return app;
  return (
    <PostHogProvider apiKey={POSTHOG_KEY} options={{ host: POSTHOG_HOST }} autocapture>
      {app}
    </PostHogProvider>
  );
}
