import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { api, Crop } from '@/lib/api';

export default function HomeScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();

  const [crops, setCrops] = useState<Crop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [cropName, setCropName] = useState('Turmeric');
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const data = await api.listCrops(user._id);
      setCrops(data);
    } catch (e: any) {
      setError(e?.message || 'Could not load crops.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const saveCrop = async () => {
    if (!user || !cropName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.addCrop(user._id, {
        name: cropName.trim(),
        quantity: quantity ? Number(quantity) : null,
      });
      setCrops((prev) => [created, ...prev]);
      setModalOpen(false);
      setCropName('Turmeric');
      setQuantity('');
    } catch (e: any) {
      setError(e?.message || 'Could not add crop.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <ThemedText type="subtitle">Hi, {user?.name?.split(' ')[0] ?? 'there'} 👋</ThemedText>
            <ThemedText themeColor="textSecondary" type="small">
              {user?.role === 'aggregator' ? 'Aggregator' : 'Farmer'} · {user?.mobile}
            </ThemedText>
          </View>
          <Pressable onPress={signOut}>
            <ThemedText type="linkPrimary">Sign out</ThemedText>
          </Pressable>
        </View>

        <View style={styles.cropsHeader}>
          <ThemedText type="smallBold">My Crops</ThemedText>
          <Pressable
            onPress={() => setModalOpen(true)}
            style={[styles.addBtn, { backgroundColor: theme.text }]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              + Add Crop
            </ThemedText>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} color={theme.text} />
        ) : (
          <FlatList
            data={crops}
            keyExtractor={(item) => item._id}
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText themeColor="textSecondary" type="small">
                  No crops yet. Tap “+ Add Crop” to add Turmeric.
                </ThemedText>
                {error && (
                  <ThemedText type="small" style={styles.error}>
                    {error}
                  </ThemedText>
                )}
              </ThemedView>
            }
            renderItem={({ item }) => (
              <ThemedView type="backgroundElement" style={styles.cropCard}>
                <ThemedText style={styles.cropEmoji}>🌱</ThemedText>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{item.name}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {item.quantity != null ? `${item.quantity} ${item.unit}` : 'Quantity not set'}
                  </ThemedText>
                </View>
              </ThemedView>
            )}
          />
        )}
      </SafeAreaView>

      {/* Add crop modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ThemedView style={styles.modalSheet}>
            <ThemedText type="smallBold">Add Crop</ThemedText>

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Crop name
            </ThemedText>
            <TextInput
              value={cropName}
              onChangeText={setCropName}
              placeholder="Turmeric"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Quantity (kg, optional)
            </ThemedText>
            <TextInput
              value={quantity}
              onChangeText={setQuantity}
              placeholder="e.g. 500"
              placeholderTextColor={theme.textSecondary}
              keyboardType="numeric"
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            {error && (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            )}

            <View style={styles.modalActions}>
              <Pressable onPress={() => setModalOpen(false)} style={styles.cancelBtn}>
                <ThemedText type="small">Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={saveCrop}
                disabled={saving}
                style={[styles.saveBtn, { backgroundColor: theme.text, opacity: saving ? 0.6 : 1 }]}>
                {saving ? (
                  <ActivityIndicator color={theme.background} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Save
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  cropsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  addBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  list: { gap: Spacing.two, paddingBottom: BottomTabInset + Spacing.four },
  empty: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
  },
  cropCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  cropEmoji: { fontSize: 28 },
  error: { color: '#e5484d' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    padding: Spacing.four,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    gap: Spacing.one,
    paddingBottom: Spacing.six,
  },
  fieldLabel: { marginTop: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  modalActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.four },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
