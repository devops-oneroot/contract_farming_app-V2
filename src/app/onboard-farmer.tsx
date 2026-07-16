import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, CatalogCrop } from '@/lib/api';

const GREEN = '#2e9e5b';
const GREEN_SURFACE = '#E7F5EC';

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function OnboardFarmerScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [catalog, setCatalog] = useState<CatalogCrop[]>([]);
  const [selectedCrop, setSelectedCrop] = useState<CatalogCrop | null>(null);
  const [variety, setVariety] = useState('');
  const [varietyOpen, setVarietyOpen] = useState(false);
  const [dop, setDop] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCropCatalog().then(setCatalog).catch(() => {});
  }, []);

  const pickCrop = (c: CatalogCrop) => {
    setSelectedCrop((prev) => (prev?._id === c._id ? null : c));
    setVariety('');
    setVarietyOpen(false);
  };

  const onDateChange = (event: { type: string }, selected?: Date) => {
    if (Platform.OS !== 'ios') setShowDatePicker(false);
    if (event.type === 'set' && selected) setDop(selected);
  };

  const save = async () => {
    if (!user) return;
    if (!name.trim() || !mobile.trim()) {
      setError('Name and mobile are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.onboardFarmer(user._id, {
        name: name.trim(),
        mobile: mobile.trim(),
        crop: selectedCrop?.name,
        variety: variety.trim(),
        dop: dop ? dop.toISOString() : null,
      });
      posthog?.capture('farmer_onboarded', {
        crop: selectedCrop?.name ?? '',
        variety: variety.trim(),
        has_planting_date: !!dop,
      });
      const farmerId = res.farmer?._id;
      const farmerName = res.farmer?.name ?? name.trim();
      // Offer to draw the farm boundary right away for the newly-onboarded farmer.
      Alert.alert('Farmer onboarded ✓', 'Mark this farmer’s farm boundary now?', [
        { text: 'Later', style: 'cancel', onPress: () => router.back() },
        {
          text: 'Draw boundary',
          onPress: () =>
            farmerId
              ? router.replace({ pathname: '/geofence', params: { userId: farmerId, name: farmerName } })
              : router.back(),
        },
      ]);
    } catch (e: any) {
      setError(e?.message || 'Could not onboard farmer.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">Onboard Farmer</ThemedText>
            <View style={{ width: 26 }} />
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Farmer name <ThemedText style={{ color: '#e5484d' }}>*</ThemedText>
            </ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Full name"
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

            {/* Optional crop */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Crop (optional)
            </ThemedText>
            {catalog.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                No crops available.
              </ThemedText>
            ) : (
              <View style={styles.chipWrap}>
                {catalog.map((c) => {
                  const on = selectedCrop?._id === c._id;
                  return (
                    <Pressable
                      key={c._id}
                      onPress={() => pickCrop(c)}
                      style={[
                        styles.chip,
                        { backgroundColor: on ? GREEN : theme.backgroundElement },
                      ]}>
                      {c.imageUrl ? (
                        <Image source={{ uri: c.imageUrl }} style={styles.chipImg} contentFit="cover" />
                      ) : null}
                      <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                        {c.name}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Variety dropdown (when crop selected & has varieties) */}
            {selectedCrop && selectedCrop.varieties.length > 0 && (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  Variety
                </ThemedText>
                <Pressable
                  onPress={() => setVarietyOpen((o) => !o)}
                  style={[styles.input, styles.dateBtn, { backgroundColor: theme.backgroundElement }]}>
                  <View style={styles.dropdownRow}>
                    <ThemedText style={{ color: variety ? theme.text : theme.textSecondary }}>
                      {variety || 'Select variety'}
                    </ThemedText>
                    <Ionicons
                      name={varietyOpen ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={theme.textSecondary}
                    />
                  </View>
                </Pressable>
                {varietyOpen && (
                  <View style={[styles.dropdown, { backgroundColor: theme.backgroundElement }]}>
                    {selectedCrop.varieties.map((v) => (
                      <Pressable
                        key={v}
                        onPress={() => {
                          setVariety(v);
                          setVarietyOpen(false);
                        }}
                        style={styles.dropdownItem}>
                        <ThemedText type="small">{v}</ThemedText>
                        {variety === v && <Ionicons name="checkmark" size={16} color={GREEN} />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* D.O.P — optional here */}
            {selectedCrop && (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  D.O.P (Date of Planting)
                </ThemedText>
                <Pressable
                  onPress={() => setShowDatePicker(true)}
                  style={[styles.input, styles.dateBtn, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={{ color: dop ? theme.text : theme.textSecondary }}>
                    {dop ? formatDate(dop) : '📅 Select date'}
                  </ThemedText>
                </Pressable>
                {showDatePicker && (
                  <DateTimePicker
                    value={dop ?? new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={onDateChange}
                  />
                )}
                {Platform.OS === 'ios' && showDatePicker && (
                  <Pressable onPress={() => setShowDatePicker(false)} style={styles.cancelBtn}>
                    <ThemedText type="linkPrimary">Done</ThemedText>
                  </Pressable>
                )}
              </>
            )}

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  Onboard farmer
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
  fieldLabel: { marginTop: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  chipImg: { width: 22, height: 22, borderRadius: 11 },
  dateBtn: { justifyContent: 'center' },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdown: { borderRadius: Spacing.two, marginTop: Spacing.one, overflow: 'hidden' },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  cancelBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three },
  error: { color: '#e5484d', marginTop: Spacing.two },
  saveBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
});
