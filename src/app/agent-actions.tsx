import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

type Action = {
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  /** Green for farmer/crop work, terracotta for the aggregator/buyer side. */
  tint: string;
  well: string;
};

const FARMER = { tint: Brand.primary, well: Brand.primarySurface };
const AGGREGATOR = { tint: Brand.secondary, well: Brand.secondarySurface };

const ACTIONS: Action[] = [
  { label: 'Onboard Aggregator', desc: 'Register new aggregators', icon: 'business-outline', route: '/onboard-aggregator', ...AGGREGATOR },
  { label: 'Onboard Farmer', desc: 'Register new farmers', icon: 'person-add-outline', route: '/onboard-farmer', ...FARMER },
];

export default function AgentActionsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { role, label } = useLocalSearchParams<{ role?: string; label?: string }>();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">{label ?? 'Actions'}</ThemedText>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle" style={styles.heading}>
            What would you like to do?
          </ThemedText>

          {ACTIONS.map((a) => (
            <Pressable
              key={a.route}
              onPress={() => router.push({ pathname: a.route, params: { role } } as never)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
              <View style={[styles.cardIcon, { backgroundColor: a.well }]}>
                <Ionicons name={a.icon} size={24} color={a.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                  {a.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {a.desc}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
            </Pressable>
          ))}

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            My Day
          </ThemedText>
          <Pressable
            onPress={() => router.push('/tracking' as never)}
            style={({ pressed }) => [styles.taskLink, pressed && { opacity: 0.85 }]}>
            <View style={styles.cardIcon}>
              <Ionicons name="navigate-outline" size={24} color={GREEN} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                Start / end tracking
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Record your route and see today's distance
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
          </Pressable>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            My Assigned Tasks
          </ThemedText>
          <Pressable
            onPress={() => router.push('/pending' as never)}
            style={({ pressed }) => [styles.taskLink, pressed && { opacity: 0.85 }]}>
            <View style={styles.cardIcon}>
              <Ionicons name="list-outline" size={24} color={GREEN} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                Upcoming tasks
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                View farmers' scheduled POP tasks to verify
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
          </Pressable>
        </ScrollView>
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
  backBtn: { padding: 2 },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.three },
  heading: { fontSize: 20, marginTop: Spacing.one, marginBottom: Spacing.one },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(46,158,91,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: 16, marginTop: Spacing.three },
  taskLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
});
