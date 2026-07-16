import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, PackageOfPractices, PopStep } from '@/lib/api';

const CATEGORY: Record<string, { emoji: string; color: string }> = {
  sowing: { emoji: '🌱', color: '#2e9e5b' },
  weed: { emoji: '🌿', color: '#0d9488' },
  irrigation: { emoji: '💧', color: '#1e88e5' },
  monitoring: { emoji: '🔍', color: '#64748b' },
  fertilizer: { emoji: '🧪', color: '#f59e0b' },
  pest: { emoji: '🐛', color: '#e04f1a' },
  disease: { emoji: '🦠', color: '#7c3aed' },
  growth: { emoji: '📈', color: '#2e9e5b' },
  harvest: { emoji: '🌾', color: '#b45309' },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(base: Date, n: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}
function fmt(d: Date) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

type Status = 'done' | 'current' | 'upcoming' | 'none';

export default function PracticesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { cropId, crop, dop, variety } = useLocalSearchParams<{
    cropId?: string;
    crop: string;
    dop?: string;
    variety?: string;
  }>();

  const [pop, setPop] = useState<PackageOfPractices | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setPop(await api.getPractices(crop));
      } catch (e: any) {
        setError(e?.message || 'Could not load package of practices.');
      } finally {
        setLoading(false);
      }
    })();
  }, [crop]);

  const base = dop ? new Date(dop) : null;
  const todayDay = base ? Math.floor((Date.now() - base.getTime()) / DAY_MS) + 1 : null;

  const scheduleStatus = (step: PopStep): Status => {
    if (todayDay == null) return 'none';
    if (todayDay > step.day[1]) return 'done';
    if (todayDay >= step.day[0]) return 'current';
    return 'upcoming';
  };

  const dayLabel = (step: PopStep) => {
    const [s, e] = step.day;
    const range = s === e ? `Day ${s}` : `Day ${s}–${e}`;
    if (!base) return range;
    const d1 = fmt(addDays(base, s - 1));
    return s === e ? `${range} · ${d1}` : `${range} · ${d1} – ${fmt(addDays(base, e - 1))}`;
  };

  // Tapping a day opens that day's detail (what to do + products).
  const openDay = (step: PopStep) =>
    router.push({
      pathname: '/products',
      params: {
        cropId: cropId ?? '',
        crop,
        dop: dop ?? '',
        stepStart: String(step.day[0]),
        stepEnd: String(step.day[1]),
        stepLabel: step.operation,
        stepDetails: step.details,
        stepCategory: step.category,
        stepProducts: JSON.stringify(step.products ?? []),
      },
    });

  const header = (
    <View style={styles.headerCard}>
      <ThemedText type="subtitle">{crop}</ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        {variety ? `Variety: ${variety}` : 'Package of Practices'}
        {base ? ` · Planted ${fmt(base)}` : ''}
      </ThemedText>
      {pop && (
        <View style={styles.progressWrap}>
          <View style={[styles.progressTrack, { backgroundColor: theme.backgroundElement }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: theme.text,
                  width: `${Math.min(100, Math.max(0, ((todayDay ?? 0) / pop.durationDays) * 100))}%`,
                },
              ]}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {todayDay != null
              ? todayDay < 1
                ? 'Not planted yet'
                : todayDay > pop.durationDays
                  ? 'Cycle complete'
                  : `Day ${todayDay} of ${pop.durationDays}`
              : `${pop.durationDays}-day cycle`}
          </ThemedText>
        </View>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">Package of Practices</ThemedText>
          <View style={{ width: 26 }} />
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.text} />
        ) : error ? (
          <ThemedView type="backgroundElement" style={styles.errorCard}>
            <ThemedText type="small" style={{ color: '#e5484d' }}>
              {error}
            </ThemedText>
          </ThemedView>
        ) : (
          <FlatList
            data={pop?.steps ?? []}
            keyExtractor={(_, i) => String(i)}
            ListHeaderComponent={header}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const cat = CATEGORY[item.category] ?? { emoji: '📋', color: theme.textSecondary };
              const status = scheduleStatus(item);
              return (
                <Pressable onPress={() => openDay(item)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
                  <ThemedView
                    type="backgroundElement"
                    style={[
                      styles.stepCard,
                      { borderLeftColor: cat.color, opacity: status === 'done' ? 0.6 : 1 },
                    ]}>
                    <ThemedText style={styles.stepEmoji}>{cat.emoji}</ThemedText>
                    <View style={{ flex: 1 }}>
                      <View style={styles.stepTop}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {dayLabel(item)}
                        </ThemedText>
                        {status === 'current' ? (
                          <View style={[styles.badge, { backgroundColor: cat.color }]}>
                            <ThemedText type="small" style={styles.badgeText}>
                              NOW
                            </ThemedText>
                          </View>
                        ) : status === 'done' ? (
                          <Ionicons name="checkmark-circle" size={16} color="#2e9e5b" />
                        ) : null}
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </ThemedView>
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  headerCard: { paddingVertical: Spacing.three, gap: Spacing.one },
  progressWrap: { marginTop: Spacing.two, gap: Spacing.one },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  errorCard: { margin: Spacing.three, padding: Spacing.four, borderRadius: Spacing.three },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderLeftWidth: 4,
  },
  stepEmoji: { fontSize: 24, alignSelf: 'flex-start' },
  stepTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: 2 },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: 10 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  details: { marginTop: 2 },
});
