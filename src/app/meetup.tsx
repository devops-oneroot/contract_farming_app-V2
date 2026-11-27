import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TextInput } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Meetup, type MeetupFarmer, type MeetupPlace } from '@/lib/api';

const VIOLET = '#7C3AED';
const VIOLET_SURFACE = '#F3E8FF';

/** 'YYYY-MM-DD' as "Sat, 28 Nov", without a time zone moving the day. */
const fmtDay = (ymd: string | null) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

const blank = { name: '', mobile: '', acres: '', village: '', taluk: '', district: '' };


/**
 * Quick actions > Farmer Meetup: pick an upcoming meetup, then register
 * farmers for it - name, mobile and their village. Typing the village
 * suggests villages in the meetup areas (Chamarajanagar district, Gokak and
 * Mudalagi taluks); picking one fills in the taluk and district.
 */
export default function MeetupScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : Brand.surface;

  const [meetups, setMeetups] = useState<Meetup[]>([]);
  const [meetupsLoading, setMeetupsLoading] = useState(true);
  const [meetupsFailed, setMeetupsFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [meetup, setMeetup] = useState<Meetup | null>(null);

  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [mine, setMine] = useState<MeetupFarmer[]>([]);

  const set = (k: keyof typeof blank) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api
      .upcomingMeetups()
      .then((r) => {
        setMeetups(r.items);
        // Only one coming up: choose it already.
        if (r.items.length === 1) setMeetup(r.items[0]);
      })
      .catch(() => setMeetupsFailed(true))
      .finally(() => setMeetupsLoading(false));
  }, []);

  // The farmers this user already registered for the chosen meetup.
  useEffect(() => {
    if (!meetup || !user?._id) return setMine([]);
    let live = true;
    api
      .myMeetupFarmers(user._id, meetup._id)
      .then((r) => live && setMine(r.items))
      .catch(() => live && setMine([]));
    return () => {
      live = false;
    };
  }, [meetup, user?._id]);

  const mobile = form.mobile.replace(/\D/g, '');
  const acres = Number(form.acres);
  const acresOk = form.acres.trim() !== '' && Number.isFinite(acres) && acres > 0;
  const valid =
    !!meetup &&
    form.name.trim().length > 0 &&
    /^[6-9]\d{9}$/.test(mobile) &&
    acresOk &&
    !!form.village.trim() &&
    !!form.taluk.trim() &&
    !!form.district.trim();

  const save = async () => {
    if (!user || !meetup || !valid) return;
    setSaving(true);
    try {
      const { farmer } = await api.addMeetupFarmer(user._id, meetup._id, {
        name: form.name.trim(),
        mobile,
        village: form.village.trim(),
        taluk: form.taluk.trim(),
        district: form.district.trim(),
        acres,
      });
      setMine((list) => [farmer, ...list]);
      // Ready for the next farmer, probably from the same village.
      setForm((f) => ({ ...blank, village: f.village, taluk: f.taluk, district: f.district }));
      Alert.alert('Farmer registered ✓', `${farmer.name} is registered for ${meetup.name}.`, [
        { text: 'Add another', style: 'default' },
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }];

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader onBack={() => router.back()} title="Farmer Meetup" bell={false} />

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* The meetup */}
          <Label text="Meetup" required />
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => [
              styles.pickBtn,
              { backgroundColor: theme.backgroundElement, borderColor: meetup ? `${VIOLET}55` : 'transparent' },
              pressed && { opacity: 0.85 },
            ]}>
            <View style={[styles.icon, { backgroundColor: meetup ? VIOLET : VIOLET_SURFACE }]}>
              <Ionicons name="people" size={18} color={meetup ? '#fff' : VIOLET} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {meetup ? meetup.name : meetupsLoading ? 'Loading meetups…' : 'Choose a meetup'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }} numberOfLines={1}>
                {meetup
                  ? [fmtDay(meetup.meetupDate), meetup.village].filter(Boolean).join(' · ')
                  : meetupsFailed
                    ? 'Could not load meetups. Check your connection.'
                    : `${meetups.length} upcoming`}
              </ThemedText>
            </View>
            <Ionicons name="chevron-down" size={18} color={VIOLET} />
          </Pressable>

          {!meetupsLoading && !meetupsFailed && meetups.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              No upcoming meetups. They are added from the dashboard.
            </ThemedText>
          ) : null}

          {meetup ? (
            <>
              <Label text="Farmer name" required />
              <TextInput
                value={form.name}
                onChangeText={set('name')}
                placeholder="Full name"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                style={inputStyle}
              />

              <Label text="Mobile number" required />
              <TextInput
                value={form.mobile}
                onChangeText={(v) => set('mobile')(v.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
                maxLength={10}
                style={inputStyle}
              />
              {form.mobile.length > 0 && !/^[6-9]\d{9}$/.test(mobile) ? (
                <ThemedText type="small" style={styles.error}>
                  Enter a valid 10-digit mobile number
                </ThemedText>
              ) : null}

              <Label text="Acres" required />
              <TextInput
                value={form.acres}
                // Digits and one decimal point, e.g. 2.5
                onChangeText={(v) => set('acres')(v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 7))}
                placeholder="Land in acres, e.g. 2.5"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={inputStyle}
              />
              {form.acres.length > 0 && !acresOk ? (
                <ThemedText type="small" style={styles.error}>
                  Enter the acres (more than 0)
                </ThemedText>
              ) : null}

              <Label text="Village" required />
              <VillageInput
                value={form.village}
                onChange={(village) => setForm((f) => ({ ...f, village }))}
                onPick={(p) => setForm((f) => ({ ...f, village: p.village, taluk: p.taluk, district: p.district }))}
              />

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Label text="Taluk" required />
                  <TextInput
                    value={form.taluk}
                    onChangeText={set('taluk')}
                    placeholder="Taluk"
                    placeholderTextColor={theme.textSecondary}
                    style={inputStyle}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Label text="District" required />
                  <TextInput
                    value={form.district}
                    onChangeText={set('district')}
                    placeholder="District"
                    placeholderTextColor={theme.textSecondary}
                    style={inputStyle}
                  />
                </View>
              </View>

              <Pressable onPress={save} disabled={saving || !valid} style={[styles.saveBtn, { opacity: saving || !valid ? 0.5 : 1 }]}>
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Register farmer
                  </ThemedText>
                )}
              </Pressable>

              {/* Who this user registered for this meetup. */}
              <ThemedText type="smallBold" style={styles.listTitle}>
                Registered by you{mine.length ? ` (${mine.length})` : ''}
              </ThemedText>
              {mine.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No farmers registered yet.
                </ThemedText>
              ) : (
                mine.map((f) => (
                  <View key={f._id} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="smallBold">{f.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                      {[f.mobile, f.acres != null ? `${f.acres} acres` : '', f.village, f.taluk, f.district]
                        .filter(Boolean)
                        .join(' · ')}
                    </ThemedText>
                  </View>
                ))
              )}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <MeetupPicker
        open={pickerOpen}
        meetups={meetups}
        loading={meetupsLoading}
        selected={meetup?._id}
        onPick={(m) => {
          setPickerOpen(false);
          setMeetup(m);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
      {text}
      {required ? <ThemedText style={{ color: Brand.danger }}> *</ThemedText> : null}
    </ThemedText>
  );
}

/**
 * The village box: as the user types (2+ letters), villages in the meetup
 * areas appear underneath; tapping one fills the village, taluk and district.
 * A village not in the list can still be typed in by hand.
 */
function VillageInput({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (p: MeetupPlace) => void;
}) {
  const theme = useTheme();
  const [hits, setHits] = useState<MeetupPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const search = useCallback((q: string) => {
    const n = ++seq.current;
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .searchMeetupPlaces(q.trim())
      // Only the newest search's answer counts: an older one may arrive later.
      .then((r) => n === seq.current && setHits(r.places))
      .catch(() => n === seq.current && setHits([]))
      .finally(() => n === seq.current && setLoading(false));
  }, []);

  // Wait for a short pause in typing before asking the server.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(value), 250);
    return () => clearTimeout(t);
  }, [value, open, search]);

  return (
    <View>
      <View style={[styles.villageBox, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="location-outline" size={18} color={theme.textSecondary} />
        <TextInput
          value={value}
          onChangeText={(v) => {
            onChange(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Type the village name"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          style={{ flex: 1, fontSize: 15, color: theme.text, paddingVertical: Spacing.three }}
        />
        {loading ? <ActivityIndicator size="small" color={VIOLET} /> : null}
      </View>
      {open && value.trim().length >= 2 && !loading ? (
        <View style={[styles.suggestions, { backgroundColor: theme.background, borderColor: theme.backgroundElement }]}>
          {hits.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={{ padding: Spacing.three }}>
              No village found in Chamarajanagar, Gokak or Mudalagi. You can type the taluk and district yourself.
            </ThemedText>
          ) : (
            hits.slice(0, 8).map((p) => (
              <Pressable
                key={`${p.district}-${p.taluk}-${p.village}`}
                onPress={() => {
                  onPick(p);
                  setOpen(false);
                  setHits([]);
                }}
                style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: VIOLET_SURFACE }]}>
                <Ionicons name="location" size={16} color={VIOLET} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontSize: 15 }}>{p.village}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                    {p.taluk}, {p.district}
                  </ThemedText>
                </View>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

/** The upcoming meetups, soonest first. */
function MeetupPicker({
  open,
  meetups,
  loading,
  selected,
  onPick,
  onClose,
}: {
  open: boolean;
  meetups: Meetup[];
  loading: boolean;
  selected?: string;
  onPick: (m: Meetup) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetBar}>
            <ThemedText type="smallBold">Upcoming meetups</ThemedText>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <FlatList
            data={meetups}
            keyExtractor={(m) => m._id}
            contentContainerStyle={{ paddingBottom: Spacing.six }}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator style={{ marginTop: Spacing.five }} color={VIOLET} />
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', padding: Spacing.four }}>
                  No upcoming meetups.
                </ThemedText>
              )
            }
            renderItem={({ item }) => {
              const on = item._id === selected;
              return (
                <Pressable
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [styles.option, on && { backgroundColor: VIOLET_SURFACE }, pressed && { opacity: 0.8 }]}>
                  <View style={[styles.icon, { backgroundColor: on ? VIOLET : VIOLET_SURFACE }]}>
                    <Ionicons name="calendar" size={17} color={on ? '#fff' : VIOLET} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontSize: 15 }} numberOfLines={1}>
                      {item.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                      {[fmtDay(item.meetupDate), [item.village, item.taluk].filter(Boolean).join(', '), item.description].filter(Boolean).join(' · ')}
                    </ThemedText>
                  </View>
                  {on && <Ionicons name="checkmark-circle" size={20} color={VIOLET} />}
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
  error: { color: Brand.danger, marginTop: 4, fontSize: 12 },
  row: { flexDirection: 'row', gap: Spacing.three },
  input: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 15 },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  villageBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  suggestions: { marginTop: 4, borderRadius: Spacing.three, borderWidth: 1, overflow: 'hidden' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  saveBtn: { backgroundColor: VIOLET, borderRadius: Spacing.three, paddingVertical: Spacing.four, alignItems: 'center', marginTop: Spacing.five },
  listTitle: { marginTop: Spacing.five, marginBottom: Spacing.two, fontSize: 15 },
  card: { borderRadius: Spacing.three, padding: Spacing.three, marginBottom: Spacing.two, gap: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { height: '70%', borderTopLeftRadius: Spacing.five, borderTopRightRadius: Spacing.five, overflow: 'hidden' },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  
  
  
  
});
