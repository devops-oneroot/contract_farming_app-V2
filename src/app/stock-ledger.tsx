import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area-view';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, StockLedger, StockLedgerEntry } from '@/lib/api';

const GREEN = Brand.primary;

const KIND: Record<StockLedgerEntry['kind'], { label: string; icon: keyof typeof Ionicons.glyphMap; tint: string }> = {
  opening: { label: 'Opening count', icon: 'clipboard-outline', tint: Brand.secondary },
  issue: { label: 'Received', icon: 'arrow-down-circle', tint: GREEN },
  return: { label: 'Returned', icon: 'arrow-up-circle', tint: Brand.accent },
  adjust: { label: 'Adjusted', icon: 'create-outline', tint: Brand.accent },
  sale: { label: 'Sold', icon: 'cart-outline', tint: Brand.danger },
};

const fmtQty = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}`;

function dayTitle(day: string) {
  const today = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

const time = (at: string) => new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/**
 * A field executive's own stock ledger: every product the office gave them,
 * took back or corrected, and everything they sold - day by day, each with
 * what is left of that product afterwards. In hand at the top.
 */
export default function StockLedgerScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : Brand.surface;

  const [ledger, setLedger] = useState<StockLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLedger(await api.myStockLedger(user._id, 60));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load your stock.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // Fresh on every visit: the office may have handed over stock since.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const inHand = (ledger?.lines ?? []).filter((l) => l.inHand !== 0);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader
          onBack={() => router.back()}
          title="My Stock"
        />

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load();
                }}
              />
            }>
            {error ? (
              <ThemedText type="small" style={{ color: Brand.danger }}>
                {error}
              </ThemedText>
            ) : null}

            {ledger && !ledger.since ? (
              <ThemedView type="card" style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">
                  No stock has been recorded for you yet. Once the office hands you products, they appear here.
                </ThemedText>
              </ThemedView>
            ) : null}

            {ledger?.since ? (
              <>
                <ThemedText type="smallBold" style={styles.section}>
                  In hand now
                </ThemedText>
                <ThemedView type="card" style={styles.card}>
                  {inHand.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      Nothing in hand.
                    </ThemedText>
                  ) : (
                    inHand.map((l) => (
                      <View key={`${l.product}:${l.variant ?? ''}`} style={styles.lineRow}>
                        <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                          {l.name}
                          {l.unit ? ` · ${l.unit}` : ''}
                        </ThemedText>
                        <ThemedText type="smallBold" style={{ color: l.inHand < 0 ? Brand.danger : theme.text }}>
                          {l.inHand}
                        </ThemedText>
                      </View>
                    ))
                  )}
                </ThemedView>

                <ThemedText type="smallBold" style={styles.section}>
                  Ledger
                </ThemedText>
                {ledger.days.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    No stock movement in the last 60 days.
                  </ThemedText>
                ) : null}
                {ledger.days.map((d) => (
                  <ThemedView key={d.day} type="card" style={[styles.card, { marginBottom: Spacing.three }]}>
                    <View style={styles.dayHead}>
                      <ThemedText type="smallBold" style={{ flex: 1 }}>
                        {dayTitle(d.day)}
                      </ThemedText>
                      {d.received ? (
                        <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>
                          +{d.received} received
                        </ThemedText>
                      ) : null}
                      {d.sold ? (
                        <ThemedText type="small" style={{ color: Brand.danger, fontWeight: '700', marginLeft: Spacing.two }}>
                          {d.sold} sold
                        </ThemedText>
                      ) : null}
                    </View>
                    {d.entries.map((e, i) => {
                      const k = KIND[e.kind];
                      return (
                        <View key={i} style={[styles.entry, i > 0 && { borderTopColor: theme.backgroundSelected, borderTopWidth: StyleSheet.hairlineWidth }]}>
                          <Ionicons name={k.icon} size={18} color={k.tint} style={{ marginTop: 2 }} />
                          <View style={{ flex: 1 }}>
                            <ThemedText type="small" numberOfLines={1}>
                              {e.name}
                              {e.unit ? ` · ${e.unit}` : ''}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }} numberOfLines={2}>
                              {k.label} · {time(e.at)}
                              {e.note ? ` · ${e.note}` : ''}
                            </ThemedText>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <ThemedText type="smallBold" style={{ color: e.qty < 0 ? Brand.danger : GREEN }}>
                              {fmtQty(e.qty)}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                              left {e.balance}
                            </ThemedText>
                          </View>
                        </View>
                      );
                    })}
                  </ThemedView>
                ))}
              </>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  section: { marginTop: Spacing.three, marginBottom: Spacing.two },
  card: { borderRadius: Radius.lg, padding: Spacing.three },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.one, gap: Spacing.two },
  dayHead: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.one },
  entry: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.two },
});
