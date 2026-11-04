import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

// Aggregators are the buyer/market side of the app, not crops — terracotta.
const CLAY = Brand.secondary;
const GREEN_SURFACE = Brand.surface;

export default function OnboardAggregatorScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!user) return;
    if (!name.trim() || !mobile.trim()) {
      setError('Name and mobile are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createAggregator(user._id, {
        name: name.trim(),
        mobile: mobile.trim(),
        company: company.trim(),
        notes: notes.trim(),
      });
      posthog?.capture('aggregator_onboarded', { has_company: !!company.trim() });
      router.back();
    } catch (e: any) {
      setError(e?.message || 'Could not save aggregator.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScreenHeader
            onBack={() => router.back()}
            title="Onboard Aggregator"
          />

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Name <ThemedText style={{ color: '#e5484d' }}>*</ThemedText>
            </ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Aggregator name"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Mobile <ThemedText style={{ color: '#e5484d' }}>*</ThemedText>
            </ThemedText>
            <TextInput
              value={mobile}
              onChangeText={setMobile}
              keyboardType="phone-pad"
              placeholder="10-digit mobile"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Company (optional)
            </ThemedText>
            <TextInput
              value={company}
              onChangeText={setCompany}
              placeholder="e.g. AgriTrade Pvt Ltd"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Notes (optional)
            </ThemedText>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything to remember"
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]}
            />

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  Save aggregator
                </ThemedText>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  fieldLabel: { marginTop: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  error: { color: '#e5484d', marginTop: Spacing.two },
  saveBtn: {
    backgroundColor: CLAY,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
});
