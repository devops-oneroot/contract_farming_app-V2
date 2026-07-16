import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

const GREEN = '#2e9e5b';
const GREEN_SURFACE = '#E7F5EC';

type Field = {
  key: 'dailyReport' | 'dailyExpenses' | 'expectedExpensesTomorrow' | 'planOfActionTomorrow';
  label: string;
  placeholder: string;
  icon: keyof typeof Ionicons.glyphMap;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric';
};

const FIELDS: Field[] = [
  { key: 'dailyReport', label: 'Daily Report', placeholder: 'What did you do today?', icon: 'document-text-outline', multiline: true },
  { key: 'dailyExpenses', label: "Today's Expenses", placeholder: 'e.g. ₹500 fuel, ₹200 food', icon: 'cash-outline' },
  { key: 'expectedExpensesTomorrow', label: 'Expected Expenses (Tomorrow)', placeholder: 'e.g. ₹800 travel', icon: 'wallet-outline' },
  { key: 'planOfActionTomorrow', label: 'Plan of Action (Tomorrow)', placeholder: 'What will you do tomorrow?', icon: 'calendar-outline', multiline: true },
];

export default function DailyReportScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [values, setValues] = useState<Record<Field['key'], string>>({
    dailyReport: '',
    dailyExpenses: '',
    expectedExpensesTomorrow: '',
    planOfActionTomorrow: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: Field['key'], v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const submit = async () => {
    if (!user) return;
    if (!Object.values(values).some((v) => v.trim())) {
      setError('Please fill at least one field.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createDailyReport({
        userId: user._id,
        userName: user.name,
        role: (user as any).role ?? '',
        dailyReport: values.dailyReport.trim(),
        dailyExpenses: values.dailyExpenses.trim(),
        expectedExpensesTomorrow: values.expectedExpensesTomorrow.trim(),
        planOfActionTomorrow: values.planOfActionTomorrow.trim(),
      });
      posthog?.capture('daily_report_submitted');
      Alert.alert('Submitted ✓', 'Your daily report has been sent to the admin.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      setError(e?.message || 'Could not submit report.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">Daily Report</ThemedText>
            <View style={{ width: 26 }} />
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle" style={{ fontSize: 20 }}>
              {today}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.two }}>
              Fill your end-of-day report. The admin sees this on the dashboard.
            </ThemedText>

            {FIELDS.map((f) => (
              <View key={f.key} style={{ marginTop: Spacing.three }}>
                <View style={styles.labelRow}>
                  <Ionicons name={f.icon} size={16} color={GREEN} />
                  <ThemedText type="smallBold">{f.label}</ThemedText>
                </View>
                <TextInput
                  value={values[f.key]}
                  onChangeText={(t) => set(f.key, t)}
                  placeholder={f.placeholder}
                  placeholderTextColor={theme.textSecondary}
                  multiline={f.multiline}
                  keyboardType={f.keyboardType ?? 'default'}
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundElement },
                    f.multiline && { minHeight: 90, textAlignVertical: 'top' },
                  ]}
                />
              </View>
            ))}

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, { opacity: saving ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  Submit report
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  error: { color: '#e5484d', marginTop: Spacing.three },
  submitBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
});
