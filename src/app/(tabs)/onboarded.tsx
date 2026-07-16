import { Ionicons } from '@expo/vector-icons';
import { Linking } from 'react-native';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
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
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Aggregator, api, Farmer } from '@/lib/api';
import { callFarmer } from '@/lib/call';

const GREEN = '#2e9e5b';
const GREEN_SURFACE = '#E7F5EC';

type TabKey = 'farmers' | 'aggregators';

// Matches a name or a phone number. Digits-only comparison for the number so that a search for
// "9900" still finds "+91 99007 68505" however it was typed in.
const digits = (s: string) => s.replace(/\D/g, '');

function matches(query: string, ...fields: (string | undefined | null)[]) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qDigits = digits(q);
  return fields.some((f) => {
    if (!f) return false;
    if (f.toLowerCase().includes(q)) return true;
    return qDigits.length > 0 && digits(f).includes(qDigits);
  });
}

export default function OnboardedScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [tab, setTab] = useState<TabKey>('farmers');
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [aggregators, setAggregators] = useState<Aggregator[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [f, a] = await Promise.all([
        api.listAgronomistFarmers(user._id).catch(() => []),
        api.listAggregators(user._id).catch(() => []),
      ]);
      setFarmers(f);
      setAggregators(a);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const call = (mobile: string) => Linking.openURL(`tel:${mobile}`).catch(() => {});

  const shownFarmers = useMemo(
    () => farmers.filter((f) => matches(query, f.name, f.mobile)),
    [farmers, query]
  );
  const shownAggregators = useMemo(
    () => aggregators.filter((a) => matches(query, a.name, a.mobile, a.company)),
    [aggregators, query]
  );

  const list = tab === 'farmers' ? shownFarmers : shownAggregators;
  const searching = query.trim().length > 0;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle" style={{ fontSize: 22 }}>
            Onboarded
          </ThemedText>
        </View>

        {/* Search by name or number */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or number"
            placeholderTextColor={theme.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[styles.searchInput, { color: theme.text }]}
          />
          {searching && (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Segmented control — counts follow the search so the number always matches the list. */}
        <View style={styles.segment}>
          {(['farmers', 'aggregators'] as TabKey[]).map((k) => {
            const on = tab === k;
            const count = k === 'farmers' ? shownFarmers.length : shownAggregators.length;
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                style={[styles.segBtn, on && { backgroundColor: GREEN }]}>
                <ThemedText type="smallBold" style={{ color: on ? '#fff' : theme.textSecondary, textTransform: 'capitalize' }}>
                  {k} ({count})
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : list.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.empty}>
              <Ionicons name="people-outline" size={40} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {searching ? `No ${tab} match “${query.trim()}”.` : `No ${tab} onboarded yet.`}
              </ThemedText>
            </ThemedView>
          ) : tab === 'farmers' ? (
            shownFarmers.map((f) => (
              // Opens the farmer detail screen: farm boundary, edit info, and their crops.
              <Pressable
                key={f._id}
                onPress={() => router.push({ pathname: '/farmer', params: { farmerId: f._id, name: f.name } })}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
                <View style={styles.avatar}>
                  <ThemedText style={styles.avatarText}>{f.name?.charAt(0)?.toUpperCase() ?? '?'}</ThemedText>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {f.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {f.mobile}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => callFarmer(user, { _id: f._id, name: f.name, mobile: f.mobile })}
                  hitSlop={8}
                  style={styles.callBtn}>
                  <Ionicons name="call" size={16} color="#fff" />
                </Pressable>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </Pressable>
            ))
          ) : (
            shownAggregators.map((a) => (
              <View key={a._id} style={styles.card}>
                <View style={styles.aggIcon}>
                  <Ionicons name="business" size={20} color={GREEN} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {a.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {[a.company, a.mobile].filter(Boolean).join(' · ')}
                  </ThemedText>
                </View>
                {a.mobile ? (
                  <Pressable onPress={() => call(a.mobile)} hitSlop={8} style={styles.callBtn}>
                    <Ionicons name="call" size={16} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: '#fff',
    borderRadius: Spacing.four,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.three, fontSize: 15 },
  segment: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.04)',
    padding: 4,
    borderRadius: Spacing.five,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.five },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two },
  empty: {
    marginTop: Spacing.four,
    padding: Spacing.five,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: Spacing.three,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  aggIcon: {
    width: 44,
    height: 44,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(46,158,91,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
