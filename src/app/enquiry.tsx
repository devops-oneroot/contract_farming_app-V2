import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { blankEnquiry, EnquiryFields, enquiryChanged, enquiryOf, enquirySummary } from '@/components/enquiry-fields';
import { TextInput } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Enquiry, type EnquiryHistoryItem, type Farmer } from '@/lib/api';

const GREEN = Brand.primary;

/** "26 Nov 2026, 3:15 pm". */
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Quick actions > Enquiry: search any farmer, then record what they are
 * interested in - tractor implements, drip irrigation, insurance, KCC low
 * cost. Opening a farmer shows what was saved before, so it can be updated.
 */
export default function EnquiryScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : Brand.surface;

  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [farmersLoading, setFarmersLoading] = useState(true);
  const [farmersFailed, setFarmersFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [loadingEnquiry, setLoadingEnquiry] = useState(false);
  /** What is saved for this farmer, to tell whether anything changed. */
  const [saved, setSaved] = useState<Enquiry>(blankEnquiry());
  const [enquiry, setEnquiry] = useState<Enquiry>(blankEnquiry());
  const [saving, setSaving] = useState(false);
  /** Every enquiry saved for this farmer, newest first. */
  const [history, setHistory] = useState<EnquiryHistoryItem[]>([]);

  useEffect(() => {
    api
      .listAllFarmers()
      .then((list) => setFarmers([...(list ?? [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''))))
      .catch(() => setFarmersFailed(true))
      .finally(() => setFarmersLoading(false));
  }, []);

  /** Pick a farmer and load what they already answered. */
  const pick = async (f: Farmer) => {
    setPickerOpen(false);
    setFarmer(f);
    setLoadingEnquiry(true);
    setHistory([]);
    try {
      const res = await api.getFarmerEnquiry(user?._id ?? '', f._id);
      const e = enquiryOf(res.enquiry);
      setSaved(e);
      setEnquiry(e);
      setHistory(res.history ?? []);
    } catch {
      setSaved(blankEnquiry());
      setEnquiry(blankEnquiry());
    } finally {
      setLoadingEnquiry(false);
    }
  };

  const dirty = enquiryChanged(enquiry, saved);

  const save = async () => {
    if (!user || !farmer) return;
    setSaving(true);
    try {
      const res = await api.setFarmerEnquiry(user._id, farmer._id, enquiry);
      const e = enquiryOf(res.enquiry);
      setSaved(e);
      setEnquiry(e);
      setHistory(res.history ?? []);
      Alert.alert('Enquiry saved ✓', `${farmer.name || 'This farmer'}'s enquiry is saved.`, [
        { text: 'Another farmer', onPress: () => setPickerOpen(true) },
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader onBack={() => router.back()} title="Enquiry" bell={false} />

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Step 1: the farmer */}
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            Farmer <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
          </ThemedText>
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => [
              styles.farmerBtn,
              { backgroundColor: theme.backgroundElement, borderColor: farmer ? `${GREEN}55` : 'transparent' },
              pressed && { opacity: 0.85 },
            ]}>
            <View style={[styles.avatar, { backgroundColor: farmer ? GREEN : Brand.primarySurface }]}>
              {farmer ? (
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  {(farmer.name || '?').trim().charAt(0).toUpperCase()}
                </ThemedText>
              ) : (
                <Ionicons name="search" size={18} color={GREEN} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {farmer ? farmer.name || 'No name' : 'Search a farmer'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }} numberOfLines={1}>
                {farmer
                  ? [farmer.mobile, farmer.farmAddress?.village].filter(Boolean).join(' · ')
                  : 'By name or mobile number'}
              </ThemedText>
            </View>
            <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
              {farmer ? 'Change' : 'Choose'}
            </ThemedText>
          </Pressable>

          {/* Step 2: the enquiry */}
          {farmer ? (
            loadingEnquiry ? (
              <ActivityIndicator style={{ marginTop: Spacing.five }} color={GREEN} />
            ) : (
              <>
                <EnquiryFields value={enquiry} onChange={setEnquiry} />
                <Pressable
                  onPress={save}
                  disabled={saving || !dirty}
                  style={[styles.saveBtn, { opacity: saving || !dirty ? 0.5 : 1 }]}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: '#fff' }}>
                      {dirty ? 'Save enquiry' : 'No changes to save'}
                    </ThemedText>
                  )}
                </Pressable>

                {/* Every enquiry saved for this farmer, newest first. */}
                <ThemedText type="smallBold" style={styles.historyTitle}>
                  Enquiry history{history.length ? ` (${history.length})` : ''}
                </ThemedText>
                {history.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    No enquiry saved for this farmer yet.
                  </ThemedText>
                ) : (
                  history.map((h, i) => {
                    const lines = enquirySummary(enquiryOf(h.enquiry));
                    return (
                      <View key={h._id} style={[styles.historyCard, { backgroundColor: theme.backgroundElement }]}>
                        <View style={styles.historyHead}>
                          <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
                          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1, fontSize: 12 }}>
                            {fmtWhen(h.createdAt)}
                            {h.recordedByName ? ` · ${h.recordedByName}` : ''}
                          </ThemedText>
                          {i === 0 ? (
                            <View style={styles.latest}>
                              <ThemedText style={styles.latestText}>Latest</ThemedText>
                            </View>
                          ) : null}
                        </View>
                        {lines.length === 0 ? (
                          <ThemedText type="small" themeColor="textSecondary">
                            Nothing answered
                          </ThemedText>
                        ) : (
                          lines.map((l) => (
                            <ThemedText key={l} type="small" style={{ color: theme.text }}>
                              {l}
                            </ThemedText>
                          ))
                        )}
                      </View>
                    );
                  })
                )}
              </>
            )
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Choose the farmer first, then mark what they are interested in.
            </ThemedText>
          )}
        </ScrollView>
      </SafeAreaView>

      <FarmerPicker
        open={pickerOpen}
        farmers={farmers}
        loading={farmersLoading}
        failed={farmersFailed}
        selected={farmer?._id}
        onPick={pick}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

/** Every farmer, searched on the phone by name or mobile. */
function FarmerPicker({
  open,
  farmers,
  loading,
  failed,
  selected,
  onPick,
  onClose,
}: {
  open: boolean;
  farmers: Farmer[];
  loading: boolean;
  failed: boolean;
  selected?: string;
  onPick: (f: Farmer) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [q, setQ] = useState('');

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return farmers;
    const digits = t.replace(/\D/g, '');
    return farmers.filter(
      (f) => (f.name || '').toLowerCase().includes(t) || (digits.length > 0 && (f.mobile || '').includes(digits))
    );
  }, [farmers, q]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetBar}>
            <ThemedText type="smallBold">
              {farmers.length ? `Choose a farmer · ${farmers.length.toLocaleString('en-IN')}` : 'Choose a farmer'}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <TextInput
              value={q}
              onChangeText={setQ}
              autoFocus
              placeholder="Search name or mobile"
              placeholderTextColor={theme.textSecondary}
              style={{ flex: 1, fontSize: 15, color: theme.text, paddingVertical: Spacing.three }}
            />
            {loading ? <ActivityIndicator size="small" color={GREEN} /> : null}
          </View>
          <FlatList
            data={items}
            keyExtractor={(f) => f._id}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            maxToRenderPerBatch={30}
            windowSize={10}
            contentContainerStyle={{ paddingBottom: Spacing.six }}
            ListEmptyComponent={
              loading ? null : (
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', padding: Spacing.four }}>
                  {failed ? 'Could not load farmers. Check your connection.' : 'No farmers match.'}
                </ThemedText>
              )
            }
            renderItem={({ item }) => {
              const on = item._id === selected;
              return (
                <Pressable
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [styles.option, on && { backgroundColor: Brand.primarySurface }, pressed && { opacity: 0.8 }]}>
                  <View style={[styles.avatar, { backgroundColor: on ? GREEN : Brand.primarySurface }]}>
                    <ThemedText type="smallBold" style={{ color: on ? '#fff' : GREEN }}>
                      {(item.name || '?').trim().charAt(0).toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontSize: 15 }} numberOfLines={1}>
                      {item.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.mobile}
                    </ThemedText>
                  </View>
                  {on && <Ionicons name="checkmark-circle" size={20} color={GREEN} />}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two },
  label: { marginTop: Spacing.three, marginBottom: Spacing.one },
  hint: { marginTop: Spacing.four, textAlign: 'center' },
  historyTitle: { marginTop: Spacing.five, marginBottom: Spacing.two, fontSize: 15 },
  historyCard: { borderRadius: Spacing.three, padding: Spacing.three, marginBottom: Spacing.two, gap: 2 },
  historyHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  latest: { backgroundColor: Brand.primarySurface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  latestText: { color: Brand.primary, fontSize: 11, fontWeight: '700' },
  farmerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  saveBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { height: '85%', borderTopLeftRadius: Spacing.five, borderTopRightRadius: Spacing.five, overflow: 'hidden' },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
});
