import { Ionicons } from '@expo/vector-icons';
import { Linking } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { BottomTabInset, Brand, CardShadow, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Aggregator, api, Farmer } from '@/lib/api';
import { callFarmer } from '@/lib/call';

const GREEN = Brand.primary;
const CLAY = Brand.secondary; // aggregators — the buyer/market side
const GREEN_SURFACE = Brand.surface;

type TabKey = 'farmers' | 'aggregators';

// Wait this long after the last keystroke before asking the server, so typing a
// name doesn't fire a request per character.
const SEARCH_DEBOUNCE_MS = 300;

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
  const [search, setSearch] = useState('');

  // Debounce the box; `search` is what actually gets sent to the server.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Responses can land out of order once typing outruns the network, so only the
  // newest request is allowed to write to state.
  const reqId = useRef(0);

  const load = useCallback(
    async (q: string) => {
      if (!user) return;
      const id = ++reqId.current;
      try {
        const [f, a] = await Promise.all([
          api.listAgronomistFarmers(user._id, q).catch(() => []),
          api.listAggregators(user._id, q).catch(() => []),
        ]);
        if (id !== reqId.current) return; // a newer search already superseded this one
        setFarmers(f);
        setAggregators(a);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [user]
  );

  // Runs on focus and again whenever the debounced search changes while focused.
  useFocusEffect(
    useCallback(() => {
      load(search);
    }, [load, search])
  );

  const call = (mobile: string) => Linking.openURL(`tel:${mobile}`).catch(() => {});

  // Already filtered by the server — these are exactly what the query returned.
  const list = tab === 'farmers' ? farmers : aggregators;
  const searching = search.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <ThemedText style={styles.headerTitle}>Onboarded</ThemedText>
          {/* Farmers removed from this list are not gone — they wait here. */}
          <Pressable
            onPress={() => router.push('/farmer-trash' as never)}
            hitSlop={10}
            style={({ pressed }) => [styles.trashLink, pressed && { opacity: 0.7 }]}>
            <Ionicons name="trash-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '700' }}>
              Trash
            </ThemedText>
          </Pressable>
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
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Segmented control — counts follow the search so the number always matches the list. */}
        <View style={styles.segment}>
          {(['farmers', 'aggregators'] as TabKey[]).map((k) => {
            const on = tab === k;
            const count = k === 'farmers' ? farmers.length : aggregators.length;
            // Farmers are green (crops), aggregators terracotta (the buyer side).
            const tint = k === 'farmers' ? GREEN : CLAY;
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                style={[styles.segBtn, on && { backgroundColor: tint }]}>
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
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(search)} />}>
          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : list.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.empty}>
              <Ionicons name="people-outline" size={40} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {searching ? `No ${tab} match “${search}”.` : `No ${tab} onboarded yet.`}
              </ThemedText>
            </ThemedView>
          ) : tab === 'farmers' ? (
            farmers.map((f) => (
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
                  {/* Did this agronomist register them, or were they handed over? */}
                  {(() => {
                    const mine = !!f.onboardedBy && f.onboardedBy === user?._id;
                    return (
                      <View
                        style={[
                          styles.originChip,
                          { borderColor: mine ? GREEN : Brand.secondary },
                        ]}>
                        <Ionicons
                          name={mine ? 'person-add-outline' : 'swap-horizontal-outline'}
                          size={11}
                          color={mine ? GREEN : Brand.secondary}
                        />
                        <ThemedText
                          type="small"
                          style={{ color: mine ? GREEN : Brand.secondary, fontWeight: '700', fontSize: 11 }}>
                          {mine ? 'Onboarded by you' : 'Assigned to you'}
                        </ThemedText>
                      </View>
                    );
                  })()}
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
            aggregators.map((a) => (
              <View key={a._id} style={styles.card}>
                <View style={styles.aggIcon}>
                  <Ionicons name="business" size={20} color={CLAY} />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  trashLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
    ...CardShadow,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
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
    borderRadius: Radius.lg,
    ...CardShadow,
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
  // Outline chip — states the farmer's origin without competing with their name.
  originChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Spacing.four,
    borderWidth: 1,
  },
  aggIcon: {
    width: 44,
    height: 44,
    borderRadius: Spacing.three,
    backgroundColor: Brand.secondarySurface,
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
