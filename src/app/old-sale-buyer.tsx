import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, Farmer, Fpo } from '@/lib/api';
import { limitSearch } from '@/lib/mobile';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

/** Long enough that typing a name is one request, not eight. */
const SEARCH_DEBOUNCE_MS = 350;
const PAGE_SIZE = 20;

type Kind = 'farmer' | 'fpo';

/**
 * Who an old, unrecorded sale went to.
 *
 * The other ways into the sale screen already know their buyer — they are
 * reached from a farmer's page or an FPO's card. A sale being entered weeks
 * late starts from the other end: the agent remembers a name, not a screen, so
 * this asks for the buyer first and then hands over to the same sale flow
 * everything else uses.
 *
 * Farmers and FPOs are one search with a switch rather than two screens. An
 * agent filling a backlog does not want to guess which list a name is in.
 */
export default function OldSaleBuyerScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useColorScheme();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [kind, setKind] = useState<Kind>('farmer');
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<(Farmer | Fpo)[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const page = useRef(1);
  // Every load stamps this; a reply from an older keystroke is dropped rather
  // than allowed to overwrite the list the agent is looking at.
  const run = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async (nextPage: number) => {
      const mine = ++run.current;
      if (nextPage === 1) setLoading(true);
      else setMore(true);
      try {
        const res =
          kind === 'farmer'
            ? await api.listAllFarmersPage({ search: term || undefined, page: nextPage, limit: PAGE_SIZE })
            : await api.listFposPage({ search: term || undefined, page: nextPage, limit: PAGE_SIZE });
        if (mine !== run.current) return;
        setRows((prev) => (nextPage === 1 ? res.items : [...prev, ...res.items]));
        setHasMore(res.hasMore);
        page.current = nextPage;
      } catch {
        if (mine === run.current && nextPage === 1) setRows([]);
      } finally {
        if (mine === run.current) {
          setLoading(false);
          setMore(false);
        }
      }
    },
    [kind, term]
  );

  useEffect(() => {
    load(1);
  }, [load]);

  /**
   * Hand the buyer to the sale screen, flagged as an old record.
   *
   * `replace`, not `push`: going back from the sale should return to the list
   * of what has been given, not to this picker with a buyer already chosen.
   */
  const choose = (row: Farmer | Fpo) => {
    if (kind === 'fpo') {
      const f = row as Fpo;
      router.replace({
        pathname: '/give-product',
        params: {
          fpoId: f._id,
          fpoName: f.name,
          fpoCrops: (f.crops ?? []).join(','),
          backdate: '1',
        },
      } as never);
      return;
    }
    const f = row as Farmer;
    router.replace({
      pathname: '/give-product',
      params: { farmerId: f._id, farmerName: f.name ?? '', backdate: '1' },
    } as never);
  };

  const renderRow = ({ item }: { item: Farmer | Fpo }) => {
    const name = (item as Farmer).name || (item as Fpo).name || 'Unnamed';
    const photo = (item as Farmer).photoUrl || (item as Fpo).photoUrl;
    const where =
      kind === 'farmer'
        ? [(item as Farmer).farmAddress?.taluk, (item as Farmer).farmAddress?.district]
            .filter(Boolean)
            .join(', ')
        : [(item as Fpo).address?.taluk, (item as Fpo).address?.district].filter(Boolean).join(', ');

    return (
      <Pressable onPress={() => choose(item)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
        <ThemedView type="background" style={styles.row}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons
                name={kind === 'fpo' ? 'business' : 'person'}
                size={18}
                color={theme.textSecondary}
              />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {name}
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {[item.mobile, where].filter(Boolean).join(' · ')}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        </ThemedView>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">Who got the products?</ThemedText>
          <View style={{ width: 26 }} />
        </View>

        <View style={styles.tools}>
          {/* One line saying what this screen is for. Without it the picker
              looks like any other list and the "old" part is easy to miss. */}
          <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.two }}>
            Pick who you sold to. You will choose the date on the next screen.
          </ThemedText>

          <View style={[styles.switch, { backgroundColor: theme.backgroundElement }]}>
            {(['farmer', 'fpo'] as Kind[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => {
                  if (k === kind) return;
                  setRows([]);
                  setKind(k);
                }}
                style={[styles.switchBtn, kind === k && { backgroundColor: GREEN }]}>
                <ThemedText
                  type="small"
                  style={{ fontWeight: '700', color: kind === k ? '#fff' : theme.textSecondary }}>
                  {k === 'farmer' ? 'Farmers' : 'FPOs'}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <TextInput
              value={query}
              onChangeText={(v) => setQuery(limitSearch(v))}
              placeholder={kind === 'farmer' ? 'Farmer name or number' : 'FPO name or number'}
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.text }]}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={GREEN} />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item._id}
            renderItem={renderRow}
            contentContainerStyle={{ padding: Spacing.four, gap: Spacing.two, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (hasMore && !more) load(page.current + 1);
            }}
            ListEmptyComponent={
              <ThemedText type="small" style={{ color: theme.textSecondary, textAlign: 'center', marginTop: 40 }}>
                {term ? 'Nobody matches that.' : 'Nothing here yet.'}
              </ThemedText>
            }
            ListFooterComponent={
              more ? <ActivityIndicator color={GREEN} style={{ marginVertical: Spacing.four }} /> : null
            }
          />
        )}
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
    paddingVertical: Spacing.three,
  },
  tools: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three, gap: Spacing.two },
  switch: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 3 },
  switchBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 14,
    padding: Spacing.three,
  },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
