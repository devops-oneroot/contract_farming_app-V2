import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { api, DiseaseReport, isSenior } from '@/lib/api';

const GREEN = Brand.primary;
const AMBER = Brand.accent;
const GREEN_SURFACE = Brand.surface;

function ago(s: string) {
  const mins = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

/**
 * One screen, two audiences.
 *
 * A senior agronomist sees every report waiting for advice and can answer it.
 * Everyone else sees the reports they sent, and the replies they got back.
 */
export default function DiseaseReportsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const keyboardHeight = useKeyboardHeight();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const senior = isSenior(user?.role);

  const [reports, setReports] = useState<DiseaseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [openOnly, setOpenOnly] = useState(true);
  const [answering, setAnswering] = useState<DiseaseReport | null>(null);
  const [advice, setAdvice] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      // A senior sees what was addressed to them plus anything sent to whoever
      // is free; anyone else sees only the reports they raised.
      const list = await api.listDiseaseReports(
        senior
          ? { seniorId: user._id, ...(openOnly ? { status: 'open' as const } : {}) }
          : { reporterId: user._id }
      );
      setReports(list);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [user, senior, openOnly]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const sendAdvice = async () => {
    if (!user || !answering) return;
    if (!advice.trim()) {
      Alert.alert('Write your advice', 'Tell the agent what to do about this crop.');
      return;
    }
    setSending(true);
    try {
      await api.replyToDiseaseReport(answering._id, user._id, advice.trim());
      setAnswering(null);
      setAdvice('');
      await load();
      Alert.alert('Sent ✓', 'The field agent has been notified.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">
            {senior ? 'Disease reports' : 'My disease reports'}
          </ThemedText>
          {/* Raising a report should not require finding the farmer first. */}
          <Pressable onPress={() => router.push('/report-disease' as never)} hitSlop={10}>
            <Ionicons name="add-circle" size={26} color={GREEN} />
          </Pressable>
        </View>

        {/* A senior works a queue, so let them clear it and still look back. */}
        {senior && (
          <View style={styles.filterRow}>
            {[
              { key: true, label: 'Waiting' },
              { key: false, label: 'All' },
            ].map((f) => {
              const on = openOnly === f.key;
              return (
                <Pressable
                  key={String(f.key)}
                  onPress={() => setOpenOnly(f.key)}
                  style={[
                    styles.filterChip,
                    { backgroundColor: on ? GREEN : theme.backgroundElement },
                  ]}>
                  <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '700' }}>
                    {f.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
            {reports.length === 0 ? (
              <ThemedView type="backgroundElement" style={styles.empty}>
                <Ionicons name="leaf-outline" size={36} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  {senior
                    ? 'Nothing waiting. Reports appear here the moment a field agent sends one.'
                    : 'You have not reported any crop disease yet. Open a farmer and tap “Report disease”.'}
                </ThemedText>
              </ThemedView>
            ) : (
              reports.map((r) => (
                <ThemedView key={r._id} type="backgroundElement" style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">
                        {r.cropName || 'Crop'}
                        {r.farmerName ? ` · ${r.farmerName}` : ''}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {senior ? `${r.reporterName || 'Field agent'} · ` : ''}
                        {ago(r.createdAt)}
                        {/* Whose it is: an agent needs to know who to chase. */}
                        {!senior ? ` · to ${r.sentToName || 'any senior'}` : ''}
                        {senior && r.sentTo ? ' · to you' : ''}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: r.status === 'open' ? Brand.accentSurface : Brand.primarySurface },
                      ]}>
                      <ThemedText
                        type="small"
                        style={{ color: r.status === 'open' ? AMBER : GREEN, fontWeight: '700' }}>
                        {r.status === 'open' ? 'Waiting' : 'Answered'}
                      </ThemedText>
                    </View>
                  </View>

                  {r.photos.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: Spacing.two }}>
                      <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                        {r.photos.map((p) => (
                          <RNImage key={p} source={{ uri: p }} style={styles.photo} resizeMode="cover" />
                        ))}
                      </View>
                    </ScrollView>
                  )}

                  {r.note ? (
                    <ThemedText type="small" style={{ marginTop: Spacing.two }}>
                      {r.note}
                    </ThemedText>
                  ) : null}

                  {/* The advice, which is the whole point of the thread. */}
                  {r.replies.map((rep, i) => (
                    <View key={i} style={[styles.reply, { borderLeftColor: GREEN }]}>
                      <ThemedText type="smallBold" style={{ color: GREEN }}>
                        {rep.seniorName || 'Senior agronomist'}
                      </ThemedText>
                      <ThemedText type="small">{rep.advice}</ThemedText>
                    </View>
                  ))}

                  {senior && (
                    <Pressable
                      onPress={() => {
                        setAnswering(r);
                        setAdvice('');
                      }}
                      style={styles.replyBtn}>
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" />
                      <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                        {r.replies.length ? 'Add advice' : 'Reply with advice'}
                      </ThemedText>
                    </Pressable>
                  )}
                </ThemedView>
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Answer sheet */}
      <Modal visible={!!answering} transparent animationType="slide" onRequestClose={() => setAnswering(null)}>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { backgroundColor: screenBg, paddingBottom: keyboardHeight }]}>
            <View style={styles.sheetBar}>
              <Pressable onPress={() => setAnswering(null)} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
              <ThemedText type="smallBold">
                Advice · {answering?.cropName || 'crop'}
              </ThemedText>
              <View style={{ width: 24 }} />
            </View>

            <View style={styles.sheetBody}>
              <ThemedText type="small" themeColor="textSecondary">
                {answering?.reporterName} will get this as a notification.
              </ThemedText>
              <TextInput
                value={advice}
                onChangeText={setAdvice}
                placeholder="What should they do? Name the product, dose and timing."
                placeholderTextColor={theme.textSecondary}
                multiline
                autoFocus
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable
                onPress={sendAdvice}
                disabled={sending}
                style={[styles.sendBtn, { opacity: sending ? 0.6 : 1 }]}>
                {sending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Send advice
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  filterRow: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  filterChip: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  empty: { padding: Spacing.five, borderRadius: Spacing.four, alignItems: 'center', gap: Spacing.two },
  card: { padding: Spacing.three, borderRadius: Spacing.four, marginBottom: Spacing.three },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Spacing.five },
  photo: { width: 110, height: 110, borderRadius: Spacing.three, backgroundColor: '#d8d8d8' },
  reply: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.three,
    marginTop: Spacing.three,
    gap: 2,
  },
  replyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: GREEN,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    marginTop: Spacing.three,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: Spacing.five, borderTopRightRadius: Spacing.five },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  sheetBody: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    minHeight: 110,
    textAlignVertical: 'top',
    marginTop: Spacing.two,
  },
  sendBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.three,
  },
});
