import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useState } from 'react';
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
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { DayWorkSheet } from '@/components/day-work-sheet';
import { api, DayReport, DayStats } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

type Field = {
  key: 'dailyReport' | 'dailyExpenses' | 'expectedExpensesTomorrow' | 'planOfActionTomorrow';
  label: string;
  placeholder: string;
  icon: keyof typeof Ionicons.glyphMap;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric';
};

/**
 * How long the written report may run.
 *
 * Counted in words, not characters, because that is the limit an agent was
 * given — and a character cap cuts a sentence off mid-word, which reads as the
 * app losing what they typed rather than as a limit.
 */
const MAX_WORDS = 300;

const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/**
 * Keep the first `MAX_WORDS` words and drop the rest.
 *
 * The trailing space is preserved when the text ends in one, so typing does
 * not feel like it is fighting back on the word that takes you to the limit.
 */
function limitWords(t: string) {
  const words = t.trim().split(/\s+/);
  if (words.length <= MAX_WORDS) return t;
  return words.slice(0, MAX_WORDS).join(' ');
}

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
  // The measured half of the report: distance from the tracked route, farmers
  // from what was recorded. Shown so the agent sees what is being filed with it.
  const [stats, setStats] = useState<DayStats | null>(null);
  /** The records behind the counts: who, their number, how much land. */
  const [report, setReport] = useState<DayReport | null>(null);
  const [dayOpen, setDayOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.getDayStats(user._id).then(setStats).catch(() => {});
    // Detail is extra: its failure must not take the counts or the form with it.
    api.getDayReport(user._id).then(setReport).catch(() => {});
  }, [user]);

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
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScreenHeader
            onBack={() => router.back()}
            title="Daily Report"
          />

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle" style={{ fontSize: 20 }}>
              {today}
            </ThemedText>
            {/* Measured, not typed — filed automatically with the report. */}
            {stats && (
              <View style={styles.statGrid}>
                {[
                  { label: 'Distance', value: `${stats.distanceKm} km` },
                  { label: 'Tracked', value: `${Math.floor(stats.trackedMinutes / 60)}h ${stats.trackedMinutes % 60}m` },
                  { label: 'New onboarded', value: String(stats.newFarmers) },
                  { label: 'Existing met', value: String(stats.oldFarmers) },
                  { label: 'Visits', value: String(stats.visits) },
                  { label: 'Sales', value: `₹${stats.salesTotal.toLocaleString('en-IN')}` },
                ].map((s) => (
                  <View key={s.label} style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                      {s.value}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                      {s.label}
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.two, marginTop: Spacing.three }}>
              These numbers are recorded automatically and sent with your report.
            </ThemedText>
            {FIELDS.map((f) => (
              <View key={f.key} style={{ marginTop: Spacing.three }}>
                <View style={styles.labelRow}>
                  <Ionicons name={f.icon} size={16} color={GREEN} />
                  <ThemedText type="smallBold">{f.label}</ThemedText>
                  {/* Only counted where there is a limit, and only once there
                      is something to count — a "0/300" on an empty box reads
                      as a demand rather than a guide. */}
                  {f.key === 'dailyReport' && countWords(values[f.key]) > 0 ? (
                    <ThemedText
                      type="small"
                      style={[
                        styles.wordCount,
                        {
                          color:
                            countWords(values[f.key]) >= MAX_WORDS ? Brand.danger : theme.textSecondary,
                        },
                      ]}>
                      {countWords(values[f.key])}/{MAX_WORDS} words
                    </ThemedText>
                  ) : null}
                </View>
                <TextInput
                  value={values[f.key]}
                  onChangeText={(t) => set(f.key, f.key === 'dailyReport' ? limitWords(t) : t)}
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

            {/* Below Submit, at the very end of the page.
                The counts near the top say how much was done; this says who,
                and it is a place to look rather than something to fill in — so
                it sits after the form instead of interrupting it on the way
                down to the writing. */}
            {report && (
              <Pressable
                onPress={() => setDayOpen(true)}
                style={({ pressed }) => [styles.viewBtn, pressed && { opacity: 0.85 }]}>
                <Ionicons name="list-outline" size={18} color={GREEN} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                    View my day in full
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                    {[
                      `${report.onboarded.length} onboarded`,
                      `${report.metExisting.length} existing met`,
                      `${report.visits.length} visits`,
                      `${report.sales.length} sales`,
                    ].join(' · ')}
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={GREEN} />
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Over the form, not instead of it: the half-written report stays
          visible behind, so opening this never feels like leaving it. */}
      <DayWorkSheet
        visible={dayOpen}
        userId={user?._id}
        onClose={() => setDayOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.three },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: GREEN,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginTop: Spacing.four,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  wordCount: { marginLeft: 'auto', fontSize: 11 },
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
