import { Image } from 'expo-image';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { Brand, LogoAspect, Logos } from '@/constants/theme';


// Branded auth palette (these screens are always light — no theme dependence).
// Warm neutrals rather than the old green tints, matching Brand.surface elsewhere.
export const AUTH = {
  bg: Brand.surface,
  card: '#ffffff',
  input: '#F2EDE6',
  btn: Brand.primary,
  gold: '#B8912E',
  heading: '#12212b',
  subtitle: '#67788a',
  label: '#1a1a1a',
  border: '#E2D9CD',
  danger: Brand.danger,
  green: Brand.primary,
  clay: Brand.secondary,
};

// Shared branded header (logo + "SINCE 1994" + title + subtitle) over a white card.
export function AuthScaffold({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.container, { backgroundColor: AUTH.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        {/*
          'padding' on Android too, despite the RN/Expo docs suggesting `undefined` there.
          That default assumes the manifest's adjustResize shrinks the window for the keyboard,
          but edge-to-edge (gradle.properties: edgeToEdgeEnabled, mandatory since SDK 54) makes
          the app draw behind the keyboard instead — so `undefined` leaves KeyboardAvoidingView
          inert and the keyboard covers the submit button. Don't "fix" this back to undefined.
        */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
            <Image source={Logos.stacked} style={styles.logo} contentFit="contain" accessibilityLabel="OneRoot" />

            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            <View style={styles.card}>{children}</View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// Reusable styles for the auth form controls.
export const authStyles = StyleSheet.create({
  cardTitle: { fontSize: 19, fontWeight: '700', color: AUTH.heading },
  cardSub: { color: AUTH.subtitle, marginTop: 2, fontSize: 13 },
  label: { fontSize: 13, fontWeight: '700', color: AUTH.label, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: AUTH.input,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
    color: '#1a1a1a',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: AUTH.btn,
    borderRadius: 12,
    paddingVertical: 15,
    marginTop: 18,
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: AUTH.danger, marginTop: 10 },
  link: { alignItems: 'center', marginTop: 14 },
  roleRow: { flexDirection: 'row', gap: 12 },
  roleBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1.5 },
  roleText: { fontSize: 15, fontWeight: '700' },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 24 },
  // The wordmark stands on its own - no tile behind it.
  logo: { alignSelf: 'center', width: 150, height: 150 / LogoAspect.stacked },
  title: { textAlign: 'center', fontSize: 26, fontWeight: '800', color: AUTH.heading, marginTop: 14 },
  subtitle: { textAlign: 'center', fontSize: 14, color: AUTH.subtitle, marginTop: 5 },
  card: {
    backgroundColor: AUTH.card,
    borderRadius: 20,
    padding: 18,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
});
