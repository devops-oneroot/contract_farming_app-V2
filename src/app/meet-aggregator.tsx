import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useState } from 'react';
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
import { Aggregator, api } from '@/lib/api';

// Aggregators are the buyer/market side of the app, not crops — terracotta.
const CLAY = Brand.secondary;
const GREEN_SURFACE = Brand.surface;

function formatDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MeetAggregatorScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [aggregators, setAggregators] = useState<Aggregator[]>([]);
  const [selected, setSelected] = useState<Aggregator | null>(null);
  const [manualName, setManualName] = useState('');
  const [notes, setNotes] = useState('');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) api.listAggregators(user._id).then(setAggregators).catch(() => {});
  }, [user]);

  const onDateChange = (event: { type: string }, sel?: Date) => {
    if (Platform.OS !== 'ios') setShowPicker(false);
    if (event.type === 'set' && sel) setScheduledAt(sel);
  };

  const submit = async (mode: 'now' | 'schedule') => {
    if (!user) return;
    const aggregatorName = selected?.name ?? manualName.trim();
    if (!aggregatorName) {
      setError('Select an aggregator or enter a name.');
      return;
    }
    if (mode === 'schedule' && !scheduledAt) {
      setError('Pick a date & time to schedule.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createMeeting({
        agronomistId: user._id,
        aggregatorId: selected?._id ?? null,
        aggregatorName,
        title: mode === 'now' ? 'Meeting' : 'Scheduled meeting',
        scheduledAt: mode === 'schedule' ? scheduledAt!.toISOString() : null,
        notes: notes.trim(),
      });
      posthog?.capture('meeting_created', { mode, from_list: !!selected });
      router.back();
    } catch (e: any) {
      setError(e?.message || 'Could not create meeting.');
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
            title="Meet Aggregator"
          />

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Choose aggregator
            </ThemedText>
            {aggregators.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                No aggregators yet — enter a name below.
              </ThemedText>
            ) : (
              <View style={{ gap: Spacing.two, marginTop: Spacing.two }}>
                {aggregators.map((a) => {
                  const on = selected?._id === a._id;
                  return (
                    <Pressable
                      key={a._id}
                      onPress={() => setSelected(on ? null : a)}
                      style={[
                        styles.aggRow,
                        { backgroundColor: theme.backgroundElement, borderColor: on ? CLAY : 'transparent' },
                      ]}>
                      <View style={styles.aggIcon}>
                        <Ionicons name="business" size={18} color={CLAY} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="smallBold">{a.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {[a.company, a.mobile].filter(Boolean).join(' · ')}
                        </ThemedText>
                      </View>
                      {on && <Ionicons name="checkmark-circle" size={20} color={CLAY} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Or enter a name
            </ThemedText>
            <TextInput
              value={manualName}
              onChangeText={(t) => {
                setManualName(t);
                if (t) setSelected(null);
              }}
              placeholder="Aggregator name"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Notes (optional)
            </ThemedText>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Agenda / notes"
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, minHeight: 70, textAlignVertical: 'top' }]}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Schedule for later (optional)
            </ThemedText>
            <Pressable
              onPress={() => setShowPicker(true)}
              style={[styles.input, styles.dateBtn, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={{ color: scheduledAt ? theme.text : theme.textSecondary }}>
                {scheduledAt ? formatDateTime(scheduledAt) : '📅 Pick date & time'}
              </ThemedText>
            </Pressable>
            {showPicker && (
              <DateTimePicker
                value={scheduledAt ?? new Date()}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onDateChange}
              />
            )}
            {Platform.OS === 'ios' && showPicker && (
              <Pressable onPress={() => setShowPicker(false)} style={styles.cancelBtn}>
                <ThemedText type="linkPrimary">Done</ThemedText>
              </Pressable>
            )}

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <View style={styles.actions}>
              <Pressable
                onPress={() => submit('now')}
                disabled={saving}
                style={[styles.actBtn, { backgroundColor: CLAY, opacity: saving ? 0.6 : 1 }]}>
                {saving ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.actText}>Start now</ThemedText>}
              </Pressable>
              <Pressable
                onPress={() => submit('schedule')}
                disabled={saving}
                style={[styles.actBtn, styles.actBtnOutline, { opacity: saving ? 0.6 : 1 }]}>
                <ThemedText style={[styles.actText, { color: CLAY }]}>Schedule</ThemedText>
              </Pressable>
            </View>
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
  aggRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
  aggIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(217,119,66,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBtn: { justifyContent: 'center' },
  cancelBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three },
  error: { color: '#e5484d', marginTop: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.five },
  actBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.four, borderRadius: Spacing.three },
  actBtnOutline: { borderWidth: 1.5, borderColor: CLAY, backgroundColor: 'transparent' },
  actText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
