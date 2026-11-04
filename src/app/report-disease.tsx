import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
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
import { CameraCapture } from '@/components/camera-capture';
import { ThemedText } from '@/components/themed-text';
import { VoiceNote, VoiceNoteRecorder } from '@/components/voice-note';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { api, Crop } from '@/lib/api';
import { fileMeta } from '@/lib/onboarding-recorder';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;
const MAX_PHOTOS = 5;

async function shrink(uri: string) {
  try {
    const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
      compress: 0.6,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return out.uri;
  } catch {
    return uri;
  }
}

/**
 * A field agent photographs a crop that looks diseased and sends it to every
 * senior agronomist for advice. Reachable from a farmer's page, so the farmer
 * and crop come pre-filled.
 */
export default function ReportDiseaseScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const keyboardHeight = useKeyboardHeight();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const params = useLocalSearchParams<{ farmerId?: string; farmerName?: string }>();
  const farmerId = params.farmerId ?? '';

  const [crops, setCrops] = useState<Crop[]>([]);
  const [cropId, setCropId] = useState<string | null>(null);
  // Typed instead, when the report is raised without a farmer's crop list.
  const [cropName, setCropName] = useState('');
  const [seniors, setSeniors] = useState<{ _id: string; name: string; mobile: string }[]>([]);
  // Which senior is being asked. Null only until one is chosen — a report is
  // no longer allowed to go out addressed to nobody in particular.
  const [sentToId, setSentToId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  // The problem described by voice, for agents who would rather speak than type.
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const [noteFocused, setNoteFocused] = useState(false);

  /**
   * Bring "What are you seeing?" back above the keyboard.
   *
   * Deferred by a frame on purpose. Whichever way the room gets made — Android
   * grows the content by the keyboard's height, iOS shrinks the scroll view
   * under it — `scrollToEnd` computes its target from the layout it can see,
   * and asking on the same tick as the keyboard event measures the layout from
   * before that change, landing short by exactly the keyboard's height.
   */
  const revealNote = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (noteFocused && keyboardHeight > 0) revealNote();
  }, [noteFocused, keyboardHeight, revealNote]);

  useEffect(() => {
    // Nothing is chosen for the agent, not even when only one senior exists.
    // Who is being asked is their decision to make, and a pre-filled answer is
    // one they can send without having read it.
    api.listSeniorAgronomists().then(setSeniors).catch(() => {});
  }, []);

  useEffect(() => {
    if (!farmerId) return;
    api
      .listCrops(farmerId)
      .then((cs) => {
        setCrops(cs);
        if (cs.length === 1) setCropId(cs[0]._id);
      })
      .catch(() => {});
  }, [farmerId]);

  // Where the problem was seen. Best-effort: a missing fix must not block it.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({});
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // no location — the report is still valid
      }
    })();
  }, []);

  const send = async () => {
    if (!user) return;
    if (photos.length === 0) {
      setError('Take at least one photo of the affected crop.');
      return;
    }
    /**
     * A named senior is required.
     *
     * Sending to everyone looked faster but left the report owned by nobody:
     * each senior could reasonably assume another was handling it, and there
     * was no one to chase when nothing came back. Naming one makes the answer
     * somebody's job.
     */
    if (!sentToId) {
      setError(
        seniors.length === 0
          ? 'No senior agronomist has signed up yet, so there is nobody to send this to.'
          : 'Choose which senior agronomist should answer this.'
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sized = await Promise.all(
        photos.map(async (p, i) => ({
          uri: await shrink(p),
          name: `disease_${i}.jpg`,
          type: 'image/jpeg',
        }))
      );
      await api.createDiseaseReport({
        reporterId: user._id,
        farmerId: farmerId || null,
        cropId,
        cropName: cropId ? undefined : cropName.trim(),
        sentToId,
        note: note.trim(),
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        photos: sized,
        voiceNote: voiceNote
          ? { uri: voiceNote.uri, ...fileMeta(voiceNote.uri, 'disease-voice'), seconds: voiceNote.seconds }
          : null,
      });
      posthog?.capture('disease_reported', {
        photos: photos.length,
        hasCrop: !!cropId,
        directed: !!sentToId,
        voiceNote: !!voiceNote,
      });
      const to = seniors.find((s) => s._id === sentToId);
      Alert.alert(
        'Sent ✓',
        `${to?.name ?? 'The senior agronomist'} has been notified. You will get a notification when they reply.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (e: any) {
      setError(e?.message || 'Could not send the report.');
    } finally {
      setSaving(false);
    }
  };

  const crop = crops.find((c) => c._id === cropId);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScreenHeader
            onBack={() => router.back()}
            title="Report crop disease"
          />

          <ScrollView
            ref={scrollRef}
            /*
              Android only. The keyboard draws over the screen there rather than
              resizing it, so the space it takes has to be added to the content
              for the last fields to be reachable at all.

              iOS must NOT get this: the KeyboardAvoidingView above already
              shrinks the scroll view by the keyboard's height, and adding the
              same height again as padding leaves a second keyboard's worth of
              blank space below the button, which `scrollToEnd` then scrolls to
              — parking the note field off the top of the screen.
            */
            contentContainerStyle={[
              styles.body,
              { paddingBottom: Spacing.six + (Platform.OS === 'android' ? keyboardHeight : 0) },
            ]}
            // Android makes room by growing the content, so this fires at the
            // one moment the new height is real and a scroll can land on it.
            onContentSizeChange={() => noteFocused && revealNote()}
            keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary">
              {params.farmerName ? `${params.farmerName}'s farm` : 'This farm'} · answered by the
              senior agronomist you choose
            </ThemedText>

            {crops.length > 0 ? (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  Which crop
                </ThemedText>
                <View style={styles.chipWrap}>
                  {crops.map((c) => {
                    const on = cropId === c._id;
                    return (
                      <Pressable
                        key={c._id}
                        onPress={() => setCropId(on ? null : c._id)}
                        style={[styles.chip, { backgroundColor: on ? GREEN : theme.backgroundElement }]}>
                        <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                          {c.name}
                          {c.variety ? ` · ${c.variety}` : ''}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : (
              // Raised without a farmer's crop list, so the name has to be typed.
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  Crop name
                </ThemedText>
                <TextInput
                  value={cropName}
                  onChangeText={setCropName}
                  placeholder="e.g. Turmeric"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.nameInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
              </>
            )}

            {/* Who answers. One named senior, always: see `send` for why the
                old "any senior" broadcast was removed. */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Send to <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
            </ThemedText>
            <View style={styles.chipWrap}>
              {seniors.map((s) => {
                const on = sentToId === s._id;
                return (
                  <Pressable
                    key={s._id}
                    // No toggle off. Tapping the chosen one again would leave
                    // the report addressed to nobody, which is the state this
                    // screen no longer has.
                    onPress={() => setSentToId(s._id)}
                    style={[styles.chip, { backgroundColor: on ? GREEN : theme.backgroundElement }]}>
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'person-circle-outline'}
                      size={14}
                      color={on ? '#fff' : theme.textSecondary}
                    />
                    <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                      {s.name}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            {seniors.length === 0 && (
              <ThemedText type="small" style={{ fontSize: 11, marginTop: Spacing.one, color: Brand.danger }}>
                No senior agronomist has signed up yet, so there is nobody to send this to.
              </ThemedText>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Photos <ThemedText style={{ color: Brand.danger }}>*</ThemedText> ({photos.length}/
              {MAX_PHOTOS})
            </ThemedText>
            <View style={styles.photoWrap}>
              {photos.map((p, i) => (
                <View key={`${p}-${i}`}>
                  <RNImage source={{ uri: p }} style={styles.photo} resizeMode="cover" />
                  <Pressable
                    onPress={() => setPhotos((ps) => ps.filter((_, n) => n !== i))}
                    hitSlop={8}
                    style={styles.removeBtn}>
                    <Ionicons name="close-circle" size={20} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <Pressable onPress={() => setCameraOpen(true)} style={styles.addPhoto}>
                  <Ionicons name="camera-outline" size={24} color={GREEN} />
                  <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                    Add
                  </ThemedText>
                </Pressable>
              )}
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11, marginTop: Spacing.one }}>
              Close-ups of the affected leaves help most.
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              What are you seeing?
            </ThemedText>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Yellow spots spreading on lower leaves for 3 days"
              placeholderTextColor={theme.textSecondary}
              multiline
              onFocus={() => setNoteFocused(true)}
              onBlur={() => setNoteFocused(false)}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.orLabel}>
              or describe it by voice
            </ThemedText>
            <VoiceNoteRecorder value={voiceNote} onChange={setVoiceNote} />

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <Pressable
              onPress={send}
              disabled={saving || !sentToId}
              style={[styles.sendBtn, { opacity: saving || !sentToId ? 0.6 : 1 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={18} color="#fff" />
                  {/* Named on the button, so it is clear who is about to be
                      asked without scrolling back up to check. */}
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    {sentToId
                      ? `Ask ${seniors.find((x) => x._id === sentToId)?.name ?? 'senior agronomist'}`
                      : 'Choose a senior agronomist'}
                  </ThemedText>
                </>
              )}
            </Pressable>
            {crop ? (
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', marginTop: Spacing.two }}>
                About {crop.name}
              </ThemedText>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {cameraOpen && (
        <CameraCapture
          onCapture={(uri) => {
            setPhotos((ps) => [...ps, uri]);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  fieldLabel: { marginTop: Spacing.four },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  nameInput: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.two,
  },
  photoWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  photo: { width: 96, height: 96, borderRadius: Spacing.three, backgroundColor: '#d8d8d8' },
  removeBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
  },
  addPhoto: {
    width: 96,
    height: 96,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    minHeight: 90,
    textAlignVertical: 'top',
    marginTop: Spacing.one,
  },
  orLabel: { fontSize: 12, textAlign: 'center', marginVertical: Spacing.two },
  error: { color: Brand.danger, marginTop: Spacing.two },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    marginTop: Spacing.five,
  },
});
