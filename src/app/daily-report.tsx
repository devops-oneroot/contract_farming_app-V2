import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { TextInput } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { DayWorkSheet } from '@/components/day-work-sheet';
import { CameraCapture } from '@/components/camera-capture';
import { api, DayReport, DayStats } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

/**
 * How long the written report may run.
 *
 * Counted in words, not characters, because that is the limit an agent was
 * given — and a character cap cuts a sentence off mid-word, which reads as the
 * app losing what they typed rather than as a limit. Counted across all the
 * points of the daily report together.
 */
const MAX_WORDS = 300;

const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const countAll = (pts: string[]) => pts.reduce((n, p) => n + countWords(p), 0);

/** Keep the first `max` words of `t` and drop the rest. */
function limitWords(t: string, max: number) {
  const words = t.trim().split(/\s+/);
  if (countWords(t) <= max) return t;
  return words.slice(0, Math.max(0, max)).join(' ');
}

/** Points are filed as one bulleted block, one point per line. */
const toBullets = (pts: string[]) =>
  pts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `• ${p}`)
    .join('\n');

/** A typed amount or reading: digits and one decimal point only. */
const cleanNumber = (t: string) => {
  const s = t.replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  return i === -1 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
};

type WriteMode = 'para' | 'points';

/** Points → paragraph: one point per line, so nothing typed is lost. */
const pointsToText = (pts: string[]) =>
  pts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n');

/** Paragraph → points: each line becomes a point (any bullet / number stripped). */
const textToPoints = (t: string) => {
  const pts = t
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[•\-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return pts.length ? pts : [''];
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

type BillKind = 'food' | 'expense';
/** How many bill photos each expense may carry (matches the server's limit). */
const MAX_BILLS: Record<BillKind, number> = { food: 3, expense: 5 };

const ALREADY_REPORTED ='Already reported for today. You can submit again tomorrow.';

export default function DailyReportScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  // Each written section can be typed as a paragraph or as a list of points.
  const [reportMode, setReportMode] = useState<WriteMode>('points');
  const [planMode, setPlanMode] = useState<WriteMode>('points');
  const [reportPoints, setReportPoints] = useState<string[]>(['']);
  const [planPoints, setPlanPoints] = useState<string[]>(['']);
  const [reportText, setReportText] = useState('');
  const [planText, setPlanText] = useState('');
  const [foodExpense, setFoodExpense] = useState('');
  const [dailyExpenses, setDailyExpenses] = useState('');
  const [expectedExpensesTomorrow, setExpectedExpensesTomorrow] = useState('');
  const [meterStart, setMeterStart] = useState('');
  const [meterEnd, setMeterEnd] = useState('');
  // Optional bill photos (local file URIs until submitted).
  const [bills, setBills] = useState<Record<BillKind, string[]>>({ food: [], expense: [] });
  const [cameraFor, setCameraFor] = useState<BillKind | null>(null);

  const addBill = async (uri: string) => {
    const kind = cameraFor;
    setCameraFor(null);
    if (!kind) return;
    let sized = uri;
    try {
      const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
        compress: 0.6,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      sized = out.uri;
    } catch {
      // never lose the shot because the resize failed
    }
    setBills((b) => ({ ...b, [kind]: [...b[kind], sized].slice(0, MAX_BILLS[kind]) }));
  };
  const removeBill = (kind: BillKind, i: number) =>
    setBills((b) => ({ ...b, [kind]: b[kind].filter((_, j) => j !== i) }));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Today's report is already filed: one per day, so the form is closed. */
  const [alreadyReported, setAlreadyReported] = useState(false);
  // The measured half of the report: distance from the tracked route, farmers
  // from what was recorded. Shown so the agent sees what is being filed with it.
  const [stats, setStats] = useState<DayStats | null>(null);
  /** The records behind the counts: who, their number, how much land. */
  const [report, setReport] = useState<DayReport | null>(null);
  const [dayOpen, setDayOpen] = useState(false);

  // ----- Toast -----
  const [toast, setToast] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastAnim.setValue(0);
    Animated.spring(toastAnim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
        setToast(null)
      );
    }, 3000);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (!user) return;
    api.getDayStats(user._id).then(setStats).catch(() => {});
    // Detail is extra: its failure must not take the counts or the form with it.
    api.getDayReport(user._id).then(setReport).catch(() => {});
    // Already filed today? Then say so up front instead of after they type it all.
    api
      .listDailyReports(user._id)
      .then((list) => {
        const now = new Date();
        if (list.some((r) => sameDay(new Date(r.date || r.createdAt), now))) {
          setAlreadyReported(true);
          showToast(ALREADY_REPORTED);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const startNum = meterStart ? Number(meterStart) : NaN;
  const endNum = meterEnd ? Number(meterEnd) : NaN;
  const meterBad = Number.isFinite(startNum) && Number.isFinite(endNum) && endNum < startNum;
  const totalKm =
    Number.isFinite(startNum) && Number.isFinite(endNum) && !meterBad
      ? Math.round((endNum - startNum) * 100) / 100
      : null;

  const reportWords = reportMode === 'points' ? countAll(reportPoints) : countWords(reportText);

  const submit = async () => {
    if (!user) return;
    if (alreadyReported) {
      showToast(ALREADY_REPORTED);
      return;
    }
    const dailyReport = reportMode === 'points' ? toBullets(reportPoints) : reportText.trim();
    const planOfActionTomorrow = planMode === 'points' ? toBullets(planPoints) : planText.trim();
    if (
      !dailyReport &&
      !planOfActionTomorrow &&
      !foodExpense.trim() &&
      !dailyExpenses.trim() &&
      !expectedExpensesTomorrow.trim() &&
      !meterEnd.trim() &&
      !bills.food.length &&
      !bills.expense.length
    ) {
      setError('Please fill at least one field.');
      return;
    }
    if (meterEnd && !meterStart) {
      setError('Enter the start meter reading too.');
      return;
    }
    if (meterBad) {
      setError('Stop meter reading cannot be less than the start reading.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createDailyReport({
        userId: user._id,
        userName: user.name,
        role: (user as any).role ?? '',
        dailyReport,
        dailyExpenses: dailyExpenses.trim(),
        expectedExpensesTomorrow: expectedExpensesTomorrow.trim(),
        planOfActionTomorrow,
        foodExpense: foodExpense ? Number(foodExpense) : 0,
        meterStart: meterStart ? Number(meterStart) : 0,
        meterEnd: meterEnd ? Number(meterEnd) : 0,
        foodBills: bills.food.map((uri, i) => ({ uri, name: `food-bill-${i + 1}.jpg`, type: 'image/jpeg' })),
        expenseBills: bills.expense.map((uri, i) => ({ uri, name: `expense-bill-${i + 1}.jpg`, type: 'image/jpeg' })),
      });
      posthog?.capture('daily_report_submitted');
      setAlreadyReported(true);
      Alert.alert('Submitted ✓', 'Your daily report has been sent to the admin.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      const msg: string = e?.message || 'Could not submit report.';
      if (/already reported/i.test(msg)) {
        setAlreadyReported(true);
        showToast(ALREADY_REPORTED);
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  /**
   * A written section with a Paragraph / Points switch.
   *
   * Switching carries the text across (points become lines, lines become
   * points), so changing your mind halfway never loses what was typed.
   */
  const renderWriting = (opts: {
    label: string;
    hint: string;
    icon: keyof typeof Ionicons.glyphMap;
    mode: WriteMode;
    setMode: (m: WriteMode) => void;
    text: string;
    setText: (t: string) => void;
    points: string[];
    setPoints: (p: string[]) => void;
    placeholder: string;
    limited: boolean;
  }) => {
    const { label, hint, icon, mode, setMode, text, setText, points, setPoints, placeholder, limited } = opts;
    const switchTo = (m: WriteMode) => {
      if (m === mode || alreadyReported) return;
      if (m === 'para') setText(pointsToText(points));
      else setPoints(textToPoints(text));
      setMode(m);
    };
    return (
      <View style={[styles.card, { borderColor: `${GREEN}33` }]}>
        <View style={styles.cardHead}>
          <View style={[styles.cardIcon, { backgroundColor: `${GREEN}1A` }]}>
            <Ionicons name={icon} size={16} color={GREEN} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {label}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }} numberOfLines={1}>
              {hint}
              {/* Only counted where there is a limit, and only once there is
                  something to count — a "0/300" on an empty box reads as a
                  demand rather than a guide. */}
              {limited && reportWords > 0 ? (
                <ThemedText
                  type="small"
                  style={{ fontSize: 11, color: reportWords >= MAX_WORDS ? Brand.danger : theme.textSecondary }}>
                  {`  ·  ${reportWords}/${MAX_WORDS} words`}
                </ThemedText>
              ) : null}
            </ThemedText>
          </View>

          {/* Paragraph | Points — a small pill at the right end of the header. */}
          <View style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
            {(
              [
                { m: 'para', text: 'Para', icon: 'reorder-three-outline' },
                { m: 'points', text: 'Points', icon: 'list-outline' },
              ] as const
            ).map((o) => {
              const on = mode === o.m;
              return (
                <Pressable
                  key={o.m}
                  onPress={() => switchTo(o.m)}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={o.m === 'para' ? 'Write as paragraph' : 'Write as points'}
                  accessibilityState={{ selected: on }}
                  style={[styles.segBtn, on && styles.segBtnOn]}>
                  <Ionicons name={o.icon} size={12} color={on ? '#fff' : theme.textSecondary} />
                  <ThemedText
                    type="small"
                    style={{ fontSize: 11, fontWeight: '700', color: on ? '#fff' : theme.textSecondary }}>
                    {o.text}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {mode === 'para' ? (
          <TextInput
            value={text}
            editable={!alreadyReported}
            onChangeText={(t) => setText(limited ? limitWords(t, MAX_WORDS) : t)}
            placeholder={placeholder}
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[inputStyle, { minHeight: 110, textAlignVertical: 'top', marginTop: Spacing.three }]}
          />
        ) : (
          renderPointList(points, setPoints, placeholder, limited)
        )}
      </View>
    );
  };

  /** A list of points, one input per point, with add / remove. */
  const renderPointList = (
    points: string[],
    setPoints: (p: string[]) => void,
    placeholder: string,
    limited: boolean
  ) => (
    <View>
      {points.map((p, i) => (
        <View key={i} style={styles.pointRow}>
          <View style={[styles.pointNo, { backgroundColor: GREEN }]}>
            <ThemedText type="small" style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>
              {i + 1}
            </ThemedText>
          </View>
          <TextInput
            value={p}
            editable={!alreadyReported}
            onChangeText={(t) => {
              const next = [...points];
              if (limited) {
                const others = countAll(points) - countWords(p);
                t = limitWords(t, MAX_WORDS - others);
              }
              next[i] = t;
              setPoints(next);
            }}
            placeholder={i === 0 ? placeholder : `Point ${i + 1}`}
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
            style={[inputStyle, styles.pointInput]}
          />
          {points.length > 1 && !alreadyReported ? (
            <Pressable
              hitSlop={8}
              accessibilityLabel={`Remove point ${i + 1}`}
              onPress={() => setPoints(points.filter((_, j) => j !== i))}>
              <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {!alreadyReported && (
        <Pressable
          onPress={() => setPoints([...points, ''])}
          style={({ pressed }) => [styles.addPoint, pressed && { opacity: 0.7 }]}>
          <Ionicons name="add-circle-outline" size={18} color={GREEN} />
          <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
            Add point
          </ThemedText>
        </Pressable>
      )}
    </View>
  );

  /** Optional bill photos under an expense field: thumbnails plus an add tile. */
  const renderBills = (kind: BillKind) => {
    const list = bills[kind];
    if (alreadyReported && !list.length) return null;
    return (
      <View style={styles.billRow}>
        {list.map((uri, i) => (
          <View key={uri} style={styles.billThumbWrap}>
            <Image source={{ uri }} style={styles.billThumb} contentFit="cover" />
            {!alreadyReported && (
              <Pressable
                hitSlop={6}
                accessibilityLabel={`Remove bill photo ${i + 1}`}
                onPress={() => removeBill(kind, i)}
                style={styles.billRemove}>
                <Ionicons name="close" size={12} color="#fff" />
              </Pressable>
            )}
          </View>
        ))}
        {!alreadyReported && list.length < MAX_BILLS[kind] && (
          <Pressable
            onPress={() => setCameraFor(kind)}
            accessibilityLabel="Add bill photo"
            style={({ pressed }) => [
              styles.billAdd,
              { borderColor: `${GREEN}80` },
              pressed && { opacity: 0.7 },
            ]}>
            <Ionicons name="camera-outline" size={18} color={GREEN} />
            <ThemedText type="small" style={{ fontSize: 10, color: GREEN, fontWeight: '700' }}>
              {list.length ? 'Add more' : 'Bill photo'}
            </ThemedText>
          </Pressable>
        )}
      </View>
    );
  };

  const renderField = (
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    value: string,
    onChange: (t: string) => void,
    placeholder: string,
    numeric = false
  ) => (
    <View style={{ marginTop: Spacing.three }}>
      <View style={styles.labelRow}>
        <Ionicons name={icon} size={16} color={GREEN} />
        <ThemedText type="smallBold">{label}</ThemedText>
      </View>
      <TextInput
        value={value}
        editable={!alreadyReported}
        onChangeText={(t) => onChange(numeric ? cleanNumber(t) : t)}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        style={inputStyle}
      />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScreenHeader onBack={() => router.back()} title="Daily Report" />

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle" style={{ fontSize: 20 }}>
              {today}
            </ThemedText>

            {alreadyReported && (
              <View style={styles.doneBanner}>
                <Ionicons name="checkmark-circle" size={18} color={GREEN} />
                <ThemedText type="small" style={{ flex: 1, color: GREEN, fontWeight: '700' }}>
                  Today&apos;s report is already submitted. Only one report per day.
                </ThemedText>
              </View>
            )}

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

            {renderWriting({
              label: "Today's Work",
              hint: 'What did you do today?',
              icon: 'document-text-outline',
              mode: reportMode,
              setMode: setReportMode,
              text: reportText,
              setText: setReportText,
              points: reportPoints,
              setPoints: setReportPoints,
              placeholder: 'e.g. Visited 12 farmers in Kottur…',
              limited: true,
            })}

            {renderField('Food Expense (₹)', 'fast-food-outline', foodExpense, setFoodExpense, 'e.g. 200', true)}
            {renderBills('food')}
            {renderField("Today's Expenses", 'cash-outline', dailyExpenses, setDailyExpenses, 'e.g. ₹500 fuel, ₹100 parking')}
            {renderBills('expense')}

            {/* Odometer: the agent types both readings; the difference is the day's km. */}
            <View style={{ marginTop: Spacing.three }}>
              <View style={styles.labelRow}>
                <Ionicons name="speedometer-outline" size={16} color={GREEN} />
                <ThemedText type="smallBold">Total Kilometres Travelled</ThemedText>
              </View>
              <View style={styles.meterRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                    Start meter
                  </ThemedText>
                  <TextInput
                    value={meterStart}
                    editable={!alreadyReported}
                    onChangeText={(t) => setMeterStart(cleanNumber(t))}
                    placeholder="e.g. 12450"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={inputStyle}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                    Stop meter
                  </ThemedText>
                  <TextInput
                    value={meterEnd}
                    editable={!alreadyReported}
                    onChangeText={(t) => setMeterEnd(cleanNumber(t))}
                    placeholder="e.g. 12520"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={[inputStyle, meterBad && { borderWidth: 1, borderColor: Brand.danger }]}
                  />
                </View>
              </View>
              <View style={[styles.kmBox, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  Stop − Start =
                </ThemedText>
                <ThemedText type="smallBold" style={{ fontSize: 16, color: meterBad ? Brand.danger : GREEN }}>
                  {meterBad ? 'Stop is less than start' : totalKm !== null ? `${totalKm} km` : '— km'}
                </ThemedText>
              </View>
            </View>

            {renderField(
              'Expected Expenses (Tomorrow)',
              'wallet-outline',
              expectedExpensesTomorrow,
              setExpectedExpensesTomorrow,
              'e.g. ₹800 travel'
            )}

            {renderWriting({
              label: 'Plan of Action (Tomorrow)',
              hint: 'What will you do tomorrow?',
              icon: 'calendar-outline',
              mode: planMode,
              setMode: setPlanMode,
              text: planText,
              setText: setPlanText,
              points: planPoints,
              setPoints: setPlanPoints,
              placeholder: 'e.g. Onboard 5 new farmers…',
              limited: false,
            })}

            {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

            <Pressable
              onPress={submit}
              disabled={saving}
              style={[
                styles.submitBtn,
                { opacity: saving ? 0.6 : 1 },
                alreadyReported && { backgroundColor: theme.textSecondary },
              ]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  {alreadyReported ? 'Already reported today' : 'Submit report'}
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
      <DayWorkSheet visible={dayOpen} userId={user?._id} onClose={() => setDayOpen(false)} />

      {/* Camera or gallery — a bill photo needn't be taken on the spot. */}
      {cameraFor && <CameraCapture onCapture={addBill} onClose={() => setCameraFor(null)} />}

      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastWrap,
            {
              opacity: toastAnim,
              transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }],
            },
          ]}>
          <View style={styles.toast} accessibilityRole="alert">
            <Ionicons name="information-circle" size={18} color="#fff" />
            <ThemedText type="small" style={{ color: '#fff', flex: 1, fontWeight: '600' }}>
              {toast}
            </ThemedText>
          </View>
        </Animated.View>
      )}
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
  card: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginTop: Spacing.four,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 2, alignSelf: 'center' },
  segBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  segBtnOn: { backgroundColor: GREEN },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  pointInput: {
    flex: 1,
    marginTop: 0,
    height: 44,
    paddingVertical: 0,
    fontSize: 15,
  },
  pointNo: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  addPoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: Spacing.two,
    paddingVertical: 4,
  },
  billRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  billThumbWrap: { width: 60, height: 60 },
  billThumb: { width: 60, height: 60, borderRadius: Spacing.two },
  billRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Brand.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billAdd: {
    width: 60,
    height: 60,
    borderRadius: Spacing.two,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  meterRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.one },
  kmBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
  },
  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: `${GREEN}1A`,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    marginTop: Spacing.three,
  },
  error: { color: '#e5484d', marginTop: Spacing.three },
  submitBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
  toastWrap: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.six, zIndex: 100, elevation: 100 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Brand.ink,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
