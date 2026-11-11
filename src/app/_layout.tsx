import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { PostHogProvider } from 'posthog-react-native';
import { useEffect } from 'react';
import { LogBox, Platform, StyleSheet, View } from 'react-native';

import { AppSplash } from '@/components/app-splash';
import { LocationGate } from '@/components/location-gate';
import { ExoFontFiles } from '@/constants/fonts';
import { Brand, MaxContentWidth } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/context/auth';
import { applyPendingUpdate } from '@/lib/ota';
import { registerForPush } from '@/lib/push';
// Imported for its side effect: the background location task must be defined
// before the OS can deliver a fix to it, including on a cold start into the
// background. Registering it inside a screen would be too late.
import '@/lib/tracking';

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

  // Restart into a newer OTA as soon as one is found, not on the next launch.
  useEffect(() => {
    applyPendingUpdate();
  }, []);

  // Register this device for push notifications once signed in.
  useEffect(() => {
    if (user?._id) registerForPush(user._id);
  }, [user?._id]);

  return (
    // On a tablet or a desktop browser the app is a centred column, not phone
    // screens stretched edge to edge. A phone is narrower than the cap, so
    // nothing changes there.
    <View style={styles.frame}>
      <View style={styles.column}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="login" />
          <Stack.Screen name="signup" />
        </Stack>
        {/* Location must stay on while signed in - it records visits and the day's distance. */}
        {user && Platform.OS !== 'web' ? <LocationGate key={user._id} role={user.role} /> : null}
      </View>
      {/* Over everything, the full window wide, until the app is ready. */}
      <AppSplash ready={!loading} />
    </View>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Exo is bundled with the JS, so it ships over OTA without a native rebuild.
  // The native splash stays up until it is ready (RootNavigation hides it), so
  // no screen flashes in the system font first. A load failure falls back to
  // the system font rather than holding the app on the splash.
  const [fontsLoaded, fontError] = useFonts(ExoFontFiles);
  if (!fontsLoaded && !fontError) return null;

  // Always provide a PostHog client so usePostHog() has one; with no key configured
  // the SDK is disabled (no network, no tracking). Autocaptures screens + taps when on.
  return (
    <PostHogProvider
      apiKey={POSTHOG_KEY || 'phc_disabled'}
      options={{ host: POSTHOG_HOST, disabled: !POSTHOG_KEY }}
      autocapture={!!POSTHOG_KEY}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <RootNavigation />
        </AuthProvider>
      </ThemeProvider>
    </PostHogProvider>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: Brand.surface },
  column: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
