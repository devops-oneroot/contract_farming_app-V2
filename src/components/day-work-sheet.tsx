import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, DayReport, DayReportRow, DayWritten } from '@/lib/api';

const GREEN = Brand.primary;

/** What the agent wrote, as label/value rows, leaving out anything left blank. */
function writtenRows(r: DayWritten): [string, string][] {
  const rows: [string, string][] = [
    ['What I did today', r.dailyReport],
    ['Food expense', r.foodExpense ? `₹${r.foodExpense.toLocaleString('en-IN')}` : ''],
    ["Today's expenses", r.dailyExpenses],
    [
      'Kilometres travelled',
      r.meterEnd ? `${r.totalKm} km (meter ${r.meterStart} → ${r.meterEnd})` : '',
    ],
    ["Tomorrow's expenses", r.expectedExpensesTomorrow],
    ['Plan for tomorrow', r.planOfActionTomorrow],
  ];
  return rows.filter(([, v]) => v && v.trim());
}

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const time = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

type Section = {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  rows: DayReportRow[];
  empty: string;
  amount?: boolean;
  extra?: (r: DayReportRow) => string | undefined;
};

/**
 * The day's work, over the report form rather than instead of it.
 *
 * A sheet and not a pushed screen on purpose: an agent opens this halfway
 * through writing their report, and anything that navigates away from a
 * half-filled form feels like losing it. The form stays visible behind.
 */
export function DayWorkSheet({
  visible,
  userId,
  date,
  onClose,
}: {
  visible: boolean;
  userId: string | undefined;
  /** Which day. Absent means today, which is the usual case. */
  date?: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const sheetBg = scheme === 'dark' ? theme.background : '#fff';

  const [report, setReport] = useState<DayReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setReport(await api.getDayReport(userId, date));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load your day.');
    } finally {
      setLoading(false);
    }
  }, [userId, date]);

  // Fetched when opened rather than on mount: a sheet that is never opened
  // should not cost a request, and one opened twice should show today twice.
  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const download = () => {
    if (!userId) return;
    // Built on the server and opened in the browser. Making a PDF on the phone
    // needs a native module, which would mean a new app install for every
    // agent instead of an update they get without noticing.
    Linking.openURL(api.dayReportPdfUrl(userId, date)).catch(() =>
      Alert.alert('Could not open', 'Check your connection and try again.')
    );
  };

  const sections: Section[] = report
    ? [
        {
          key: 'new',
          title: 'New farmers onboarded',
          icon: 'person-add',
          tint: GREEN,
          rows: report.onboarded,
          empty: 'You did not register anyone today.',
        },
        {
          key: 'met',
          title: 'Existing farmers met',
          icon: 'people',
          tint: Brand.secondary,
          rows: report.metExisting,
          empty: 'You did not meet any existing farmer today.',
        },
        {
          key: 'visits',
          title: 'Farm visits',
          icon: 'map',
          tint: Brand.accent,
          rows: report.visits,
          empty: 'No visits logged today.',
          extra: (r) => r.notes,
        },
        {
          key: 'sales',
          title: 'Products given',
          icon: 'cube',
          tint: Brand.primary,
          rows: report.sales,
          empty: 'You did not hand over any product today.',
          amount: true,
          extra: (r) => r.products?.join(', '),
        },
      ]
    : [];

  const s = report?.stats;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area is the fastest way out of a sheet. */}
        <Pressable style={{ flex: 1 }} onPress={onClose} />

        <View style={[styles.sheet, { backgroundColor: sheetBg }]}>
          <View style={styles.handle} />

          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" style={{ fontSize: 17 }}>
                My day
              </ThemedText>
              {report ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                  {new Date(report.date).toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                  {report.agent?.name ? ` · ${report.agent.name}` : ''}
                </ThemedText>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: Spacing.six }} color={GREEN} />
          ) : error ? (
            <View style={styles.middle}>
              <Ionicons name="cloud-offline-outline" size={32} color={theme.textSecondary} />
              <ThemedText type="small" style={{ color: Brand.danger, textAlign: 'center' }}>
                {error}
              </ThemedText>
              <Pressable onPress={load} style={styles.retry}>
                <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                  Try again
                </ThemedText>
              </Pressable>
            </View>
          ) : report ? (
            <>
              <ScrollView
                style={{ flexGrow: 0 }}
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}>
                {/* Only the sales total. Distance and tracked time belong to
                    My Day, and the section badges below already carry every
                    other count — repeating them here said nothing new. */}
                {s && s.salesTotal > 0 && (
                  <View style={[styles.stat, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="smallBold" style={{ fontSize: 15 }}>
                      {money(s.salesTotal)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                      Sales today
                    </ThemedText>
                  </View>
                )}

                {report.report &&
                  writtenRows(report.report).length > 0 && (
                    <View style={{ marginTop: Spacing.four }}>
                      <View style={styles.sectionHead}>
                        <View style={[styles.sectionIcon, { backgroundColor: `${GREEN}1A` }]}>
                          <Ionicons name="document-text" size={14} color={GREEN} />
                        </View>
                        <ThemedText type="small" style={{ fontWeight: '700', flex: 1 }}>
                          Daily report
                        </ThemedText>
                      </View>
                      {writtenRows(report.report).map(([label, value]) => (
                          <View
                            key={label}
                            style={[styles.written, { backgroundColor: theme.backgroundElement }]}>
                            <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                              {label}
                            </ThemedText>
                            <ThemedText type="small">{value.trim()}</ThemedText>
                          </View>
                        ))}
                    </View>
                  )}

                {sections.map((sec) => (
                  <View key={sec.key} style={{ marginTop: Spacing.four }}>
                    <View style={styles.sectionHead}>
                      <View style={[styles.sectionIcon, { backgroundColor: `${sec.tint}1A` }]}>
                        <Ionicons name={sec.icon} size={14} color={sec.tint} />
                      </View>
                      <ThemedText type="small" style={{ fontWeight: '700', flex: 1 }}>
                        {sec.title}
                      </ThemedText>
                      {/* The count as a badge, so scanning the sheet answers
                          "how many" before any row is read. */}
                      <View style={[styles.badge, { backgroundColor: `${sec.tint}1A` }]}>
                        <ThemedText type="small" style={{ color: sec.tint, fontWeight: '800' }}>
                          {sec.rows.length}
                        </ThemedText>
                      </View>
                    </View>

                    {sec.rows.length ? (
                      sec.rows.map((r) => {
                        const extra = sec.extra?.(r);
                        return (
                          <View
                            key={r.id}
                            style={[styles.row, { borderLeftColor: sec.tint }]}>
                            <View style={{ flex: 1 }}>
                              <View style={styles.nameRow}>
                                <ThemedText
                                  type="small"
                                  style={{ fontWeight: '700', flex: 1 }}
                                  numberOfLines={1}>
                                  {r.name || (r.toFpo ? 'Unnamed FPO' : 'Unnamed farmer')}
                                </ThemedText>
                                {/* A sale to an FPO, marked so the day's record
                                    does not read as another farmer visit. */}
                                {r.toFpo ? (
                                  <View style={styles.fpoTag}>
                                    <ThemedText type="small" style={styles.fpoTagText}>
                                      FPO
                                    </ThemedText>
                                  </View>
                                ) : null}
                              </View>
                              <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
                                {[
                                  r.mobile || 'no number',
                                  // Their whole holding, not the area worked
                                  // today — said in full at the foot.
                                  r.acres > 0 ? `${r.acres} acres` : 'no area',
                                  r.cropNames?.length ? r.cropNames.join(', ') : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </ThemedText>
                              {extra ? (
                                <ThemedText
                                  type="small"
                                  themeColor="textSecondary"
                                  numberOfLines={2}
                                  style={styles.small}>
                                  {extra}
                                </ThemedText>
                              ) : null}
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              {sec.amount && r.total ? (
                                <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                                  {money(r.total)}
                                </ThemedText>
                              ) : null}
                              {r.at ? (
                                <ThemedText
                                  type="small"
                                  themeColor="textSecondary"
                                  style={styles.small}>
                                  {time(r.at)}
                                </ThemedText>
                              ) : null}
                            </View>
                          </View>
                        );
                      })
                    ) : (
                      // Said rather than left blank: an empty gap reads as a
                      // sheet that failed to load, not as a quiet morning.
                      <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                        {sec.empty}
                      </ThemedText>
                    )}
                  </View>
                ))}

                <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                  Acreage is each farmer&apos;s total recorded land, not the area worked today.
                </ThemedText>
              </ScrollView>

              {/* Pinned, so it is reachable without scrolling to the end of a
                  forty-farmer day. */}
              <SafeAreaView edges={['bottom']} style={styles.footer}>
                <Pressable
                  onPress={download}
                  style={({ pressed }) => [styles.pdfBtn, pressed && { opacity: 0.85 }]}>
                  <Ionicons name="download-outline" size={18} color="#fff" />
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Download as PDF
                  </ThemedText>
                </Pressable>
              </SafeAreaView>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    // Never full height: what it covers should stay recognisable behind it.
    maxHeight: '88%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignSelf: 'center',
    marginTop: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  closeBtn: { padding: Spacing.one },
  middle: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  retry: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.four },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.four },
  stat: { flex: 1, borderRadius: Spacing.three, paddingVertical: Spacing.three, alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fpoTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
    backgroundColor: Brand.secondarySurface,
  },
  fpoTagText: { color: Brand.secondary, fontWeight: '800', fontSize: 9 },
  small: { fontSize: 11, marginTop: 1 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  sectionIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { minWidth: 24, alignItems: 'center', borderRadius: Spacing.five, paddingHorizontal: 7, paddingVertical: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    // A coloured edge ties each row to its section without repeating the icon.
    borderLeftWidth: 3,
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.two,
  },
  empty: { fontSize: 12, paddingBottom: Spacing.two },
  written: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    gap: 2,
  },
  footnote: { fontSize: 11, marginTop: Spacing.four, textAlign: 'center' },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
  },
});
