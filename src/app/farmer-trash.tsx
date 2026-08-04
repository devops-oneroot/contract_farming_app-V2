import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, TrashedFarmer } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * Farmers this agronomist removed. Nothing here has been deleted — each row can
 * be put back exactly as it was, with its crops, visits and calls intact.
 */
export default function FarmerTrashScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [rows, setRows] = useState<TrashedFarmer[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // The farmer whose permanent-delete confirmation is open, and the name typed
  // to confirm it. Deleting is irreversible, so it takes a deliberate act:
  // tapping is not enough, the agronomist has to write the name out.
  const [deleteFor, setDeleteFor] = useState<TrashedFarmer | null>(null);
  const [typedName, setTypedName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setRows(await api.listTrashedFarmers(user._id));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const confirmRestore = (f: TrashedFarmer) => {
    if (!user || restoringId) return;
    Alert.alert(
      `Restore ${f.name}?`,
      f.cropCount > 0
        ? `They come back to your farmer list with their ${f.cropCount} crop${
            f.cropCount > 1 ? 's' : ''
          } and all their history.`
        : 'They come back to your farmer list with all their history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setRestoringId(f._id);
            try {
              await api.restoreFarmer(user._id, f._id);
              // Drop the row immediately rather than waiting for the refetch.
              setRows((prev) => prev.filter((r) => r._id !== f._id));
            } catch (e: any) {
              Alert.alert('Could not restore', e?.message || 'Please try again.');
            } finally {
              setRestoringId(null);
            }
          },
        },
      ]
    );
  };

  const nameMatches =
    !!deleteFor && typedName.trim().toLowerCase() === deleteFor.name.trim().toLowerCase();

  const deleteForever = async () => {
    if (!user || !deleteFor || !nameMatches || deleting) return;
    setDeleting(true);
    try {
      const res = await api.deleteFarmerForever(user._id, deleteFor._id, typedName.trim());
      setRows((prev) => prev.filter((r) => r._id !== deleteFor._id));
      setDeleteFor(null);
      setTypedName('');
      Alert.alert(
        'Deleted permanently',
        `${res.name} and ${res.cropsDeleted} crop${res.cropsDeleted === 1 ? '' : 's'} were removed. Their visits, calls and sales were kept as records.`
      );
    } catch (e: any) {
      Alert.alert('Could not delete', e?.message || 'Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">Trash</ThemedText>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          {loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
          ) : rows.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.empty}>
              <Ionicons name="trash-outline" size={40} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                Nothing here. Farmers you remove land in this trash, and you can put them back.
              </ThemedText>
            </ThemedView>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.blurb}>
                These farmers are hidden from your lists. Nothing of theirs was deleted — restore
                one and their crops, visits and calls come back with them.
              </ThemedText>

              {rows.map((f) => (
                <View key={f._id} style={styles.card}>
                  <View style={styles.avatar}>
                    <ThemedText style={styles.avatarText}>
                      {f.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {f.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {f.mobile}
                      {f.cropCount > 0 ? ` · ${f.cropCount} crop${f.cropCount > 1 ? 's' : ''}` : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                      Removed {ago(f.deletedAt)}
                    </ThemedText>
                  </View>
                  <View style={styles.rowActions}>
                    <Pressable
                      onPress={() => confirmRestore(f)}
                      disabled={restoringId === f._id}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.restoreBtn,
                        (pressed || restoringId === f._id) && { opacity: 0.7 },
                      ]}>
                      {restoringId === f._id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="arrow-undo" size={14} color="#fff" />
                          <ThemedText type="small" style={styles.restoreText}>
                            Restore
                          </ThemedText>
                        </>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setTypedName('');
                        setDeleteFor(f);
                      }}
                      hitSlop={8}
                      style={({ pressed }) => [styles.deleteLink, pressed && { opacity: 0.6 }]}>
                      <Ionicons name="trash-outline" size={12} color={Brand.danger} />
                      <ThemedText type="small" style={styles.deleteText}>
                        Delete forever
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/*
        Permanent deletion. Deliberately not an Alert: this is the one action in
        the app that cannot be undone, so it spells out what goes and what
        stays, and the button stays disabled until the name has been typed out.
        The server checks that same name again before deleting anything.
      */}
      <Modal
        visible={!!deleteFor}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteFor(null)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => !deleting && setDeleteFor(null)}>
            <Pressable
              style={[styles.confirmSheet, { backgroundColor: theme.background }]}
              onPress={() => {}}>
              <View style={styles.confirmIcon}>
                <Ionicons name="warning" size={24} color={Brand.danger} />
              </View>

              <ThemedText type="smallBold" style={styles.confirmTitle}>
                Delete {deleteFor?.name} forever?
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.confirmBody}>
                This cannot be undone. There is no way to bring them back afterwards.
              </ThemedText>

              <View style={styles.factRow}>
                <Ionicons name="close-circle" size={14} color={Brand.danger} />
                <ThemedText type="small" style={{ flex: 1 }}>
                  Their record
                  {deleteFor && deleteFor.cropCount > 0
                    ? ` and ${deleteFor.cropCount} crop${deleteFor.cropCount > 1 ? 's' : ''}`
                    : ''}{' '}
                  will be erased
                </ThemedText>
              </View>
              <View style={styles.factRow}>
                <Ionicons name="checkmark-circle" size={14} color={GREEN} />
                <ThemedText type="small" style={{ flex: 1 }}>
                  Visits, calls and sales are kept as records
                </ThemedText>
              </View>

              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ marginTop: Spacing.three }}>
                Type <ThemedText type="smallBold">{deleteFor?.name}</ThemedText> to confirm
              </ThemedText>
              <TextInput
                value={typedName}
                onChangeText={setTypedName}
                placeholder={deleteFor?.name ?? ''}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
                style={[
                  styles.confirmInput,
                  { color: theme.text, backgroundColor: theme.backgroundElement },
                ]}
              />

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setDeleteFor(null)}
                  disabled={deleting}
                  style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}>
                  <ThemedText type="smallBold">Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={deleteForever}
                  disabled={!nameMatches || deleting}
                  style={({ pressed }) => [
                    styles.dangerBtn,
                    (!nameMatches || deleting) && { opacity: 0.4 },
                    pressed && nameMatches && { opacity: 0.85 },
                  ]}>
                  {deleting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: '#fff' }}>
                      Delete forever
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
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
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.two },
  blurb: { marginBottom: Spacing.two },
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
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Brand.ink, fontSize: 18, fontWeight: '700' },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: GREEN,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
  },
  restoreText: { color: '#fff', fontWeight: '700' },
  rowActions: { alignItems: 'flex-end', gap: Spacing.one },
  deleteLink: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
  deleteText: { color: Brand.danger, fontWeight: '700', fontSize: 11 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  confirmSheet: { borderRadius: Spacing.four, padding: Spacing.four },
  confirmIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Brand.dangerSurface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  confirmTitle: { fontSize: 17, textAlign: 'center' },
  confirmBody: { textAlign: 'center', marginTop: Spacing.one, marginBottom: Spacing.three },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  confirmInput: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    marginTop: Spacing.one,
  },
  confirmActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.four },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  dangerBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: Brand.danger,
  },
});
