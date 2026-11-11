import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Updates from 'expo-updates';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { TextInput } from '@/components/exo-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SafeAreaView, TOP_GAP } from '@/components/safe-area-view';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, CardShadow, LogoAspect, Logos, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, isAgronomist, Role } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { PHOTO_CREDITS } from '@/constants/photos';

const GREEN = Brand.primary;

/**
 * Which JavaScript bundle this app is actually running: the one baked into the
 * build, or an over-the-air update on top of it.
 *
 * Shown in the footer so an OTA can be confirmed from the phone itself — a
 * colour change tells you something arrived, this tells you exactly what. All
 * values are null in development, where expo-updates is disabled.
 */
function bundleLabel() {
  if (__DEV__) return 'dev';
  if (Updates.isEmbeddedLaunch) return 'base build';
  const when = Updates.createdAt
    ? Updates.createdAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null;
  // First segment of the update UUID is plenty to tell two updates apart.
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : null;
  return ['update', when, id].filter(Boolean).join(' · ');
}
// The header band: the brand's deep orange, so white text reads on it.
const GREEN_DARK = Brand.primaryDark;
const GREEN_SURFACE = Brand.surface;

/**
 * What the badge says. Read from the role itself rather than "farmer or not":
 * a senior agronomist was showing as a plain agronomist, which hid the one
 * thing that distinguishes them — they answer everyone else's disease reports.
 */
function roleName(role?: Role) {
  if (role === 'senior_agronomist') return 'Senior agronomist';
  if (role === 'agronomist') return 'Agronomist';
  return 'Farmer';
}

function roleLabel(role?: Role) {
  if (role === 'senior_agronomist') return '⭐ SENIOR AGRONOMIST';
  if (role === 'agronomist') return '👨‍🌾 AGRONOMIST';
  return '🌱 FARMER';
}

export default function ProfileScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateUser, signOut } = useAuth();

  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;
  const isFarmer = !isAgronomist(user?.role);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const openEdit = () => {
    setEditName(user?.name ?? '');
    setEditMobile(user?.mobile ?? '');
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!user || !editName.trim()) return;
    const mobile = editMobile.trim();
    if (!/^\d{7,15}$/.test(mobile)) {
      Alert.alert('Invalid number', 'Please enter a valid phone number.');
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await api.updateProfile(user._id, {
        name: editName.trim(),
        ...(mobile !== user.mobile ? { mobile } : {}),
      });
      await updateUser(updated);
      setEditOpen(false);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSavingEdit(false);
    }
  };

  const geofenceCount = user?.geofence?.length ?? 0;

  const confirmSignOut = () =>
    confirmAction({
      title: 'Sign out',
      message: 'Are you sure you want to sign out?',
      confirmText: 'Sign out',
      destructive: true,
      onConfirm: () => {
        signOut().catch(() => {});
      },
    });

  const hasLocation = user?.location?.latitude != null && user?.location?.longitude != null;

  const infoRows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [
    { icon: 'call-outline', label: 'Mobile', value: user?.mobile ?? '—' },
    { icon: 'person-outline', label: 'Role', value: roleName(user?.role) },
    {
      icon: 'location-outline',
      label: 'Location',
      value: hasLocation
        ? `${user!.location.latitude!.toFixed(3)}, ${user!.location.longitude!.toFixed(3)}`
        : 'Not set',
    },
  ];

  const divider = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.backgroundElement };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {/* Curved green header */}
      <View style={[styles.headerBand, { paddingTop: insets.top + TOP_GAP + Spacing.two }]}>
        <View style={styles.topRow}>
          <Image source={Logos.horizontalWhite} style={styles.brandLogo} contentFit="contain" accessibilityLabel="OneRoot" />
          {/* At the top, in red: easy to find, and clearly not a normal action. */}
          <Pressable
            onPress={confirmSignOut}
            hitSlop={6}
            accessibilityLabel="Log out"
            style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.85 }]}>
            <Ionicons name="log-out-outline" size={16} color="#fff" />
            <ThemedText style={styles.signOutText}>Log Out</ThemedText>
          </Pressable>
        </View>
        <View style={styles.avatar}>
          <ThemedText style={styles.avatarText}>{user?.name?.charAt(0)?.toUpperCase() ?? '?'}</ThemedText>
        </View>
        <ThemedText type="subtitle" style={styles.heroName}>
          {user?.name ?? 'User'}
        </ThemedText>
        <View style={styles.rolePill}>
          <ThemedText style={styles.roleText}>{roleLabel(user?.role)}</ThemedText>
        </View>
      </View>

      {/* Scrolls so a short phone can still reach the footer; `flexGrow`
          keeps it pinned to the bottom when the content is short. */}
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Account details, with Edit right above the values it changes. */}
        <View style={styles.sectionHead}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            Account details
          </ThemedText>
          <Pressable
            onPress={openEdit}
            hitSlop={8}
            accessibilityLabel="Edit profile"
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="create-outline" size={15} color={GREEN} />
            <ThemedText style={styles.editText}>Edit</ThemedText>
          </Pressable>
        </View>
        <ThemedView style={[styles.card, { marginTop: -Spacing.two }]}>
          {infoRows.map((r, i) => (
            <View key={r.label} style={[styles.row, i < infoRows.length - 1 && divider]}>
              <View style={styles.rowIcon}>
                <Ionicons name={r.icon} size={16} color={GREEN} />
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={{ width: 82 }}>
                {r.label}
              </ThemedText>
              <ThemedText type="small" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
                {r.value}
              </ThemedText>
            </View>
          ))}
        </ThemedView>

        {/* Actions */}
        <ThemedView style={styles.card}>
          {isFarmer && (
            <Pressable
              onPress={() => router.push('/geofence')}
              style={({ pressed }) => [styles.row, divider, pressed && { opacity: 0.6 }]}>
              <View style={styles.rowIcon}>
                <Ionicons name="map-outline" size={16} color={GREEN} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="small" style={{ fontWeight: '600' }}>
                  Farm boundary (Geofence)
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {geofenceCount >= 3 ? `${geofenceCount} corners marked` : 'Not set — tap to draw'}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
          <Pressable
            onPress={() => router.push('/onboarding')}
            style={({ pressed }) => [styles.row, divider, pressed && { opacity: 0.6 }]}>
            <View style={styles.rowIcon}>
              <Ionicons name="play-circle-outline" size={16} color={GREEN} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="small" style={{ fontWeight: '600' }}>
                View intro again
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Replay the welcome slides
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL('tel:9606031878').catch(() => {})}
            style={({ pressed }) => [styles.row, divider, pressed && { opacity: 0.6 }]}>
            <View style={styles.rowIcon}>
              <Ionicons name="headset-outline" size={16} color={GREEN} />
            </View>
            <ThemedText type="small" style={{ flex: 1, fontWeight: '600' }}>
              Help & Support
            </ThemedText>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() =>
              Alert.alert(
                'OneRoot',
                `OneRoot — contract farming, simplified.\n\nSupport: 9606031878\nVersion 1.0.0\n\nPhotos:\n${PHOTO_CREDITS.join('\n')}`
              )
            }
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
            <View style={styles.rowIcon}>
              <Ionicons name="information-circle-outline" size={16} color={GREEN} />
            </View>
            <ThemedText type="small" style={{ flex: 1, fontWeight: '600' }}>
              About OneRoot
            </ThemedText>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </Pressable>
        </ThemedView>

        {/* Footer pinned to bottom */}
        <View style={styles.footer}>
          <Image source={Logos.horizontal} style={styles.footerLogo} contentFit="contain" />
          <ThemedText type="small" themeColor="textSecondary">
            OneRoot · Contract farming, simplified
          </ThemedText>
          <ThemedText type="small" style={styles.version}>
            v1.0.0 · {bundleLabel()}
          </ThemedText>
        </View>
      </ScrollView>

      {/* Edit profile — full screen */}
      <Modal
        visible={editOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setEditOpen(false)}>
        <View style={[styles.container, { backgroundColor: screenBg }]}>
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.editTopBar}>
              <Pressable onPress={() => setEditOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={26} color={theme.text} />
              </Pressable>
              <ThemedText type="smallBold">Edit profile</ThemedText>
              <View style={{ width: 26 }} />
            </View>

            <View style={styles.editBody}>
              <ThemedText type="small" themeColor="textSecondary">
                Name
              </ThemedText>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                placeholder="Your name"
                placeholderTextColor={theme.textSecondary}
                autoFocus
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
                Mobile
              </ThemedText>
              <TextInput
                value={editMobile}
                onChangeText={setEditMobile}
                placeholder="Mobile number"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
                maxLength={15}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                This is your login — sign in with the new number next time.
              </ThemedText>

              <Pressable
                onPress={saveEdit}
                disabled={savingEdit}
                style={[styles.editSaveBtn, { opacity: savingEdit ? 0.6 : 1 }]}>
                {savingEdit ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>
                    Save
                  </ThemedText>
                )}
              </Pressable>
            </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBand: {
    backgroundColor: GREEN_DARK,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  brandLogo: { height: 22, width: 22 * LogoAspect.horizontal },
  sectionHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.one },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Brand.primarySurface,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.four,
  },
  editText: { color: GREEN, fontSize: 13, fontWeight: '700' },
  signOutText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  avatarText: { color: GREEN_DARK, fontSize: 32, fontWeight: '700' },
  heroName: { color: '#fff', marginTop: Spacing.two },
  rolePill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: Spacing.three,
    paddingVertical: 4,
    borderRadius: Spacing.four,
    marginTop: Spacing.one,
  },
  roleText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  body: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  card: { borderRadius: Radius.lg, paddingHorizontal: Spacing.three, ...CardShadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,127,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same shape as Edit beside it, in the danger red.
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Brand.danger,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.four,
  },
  footer: { alignItems: 'center', gap: 3, marginTop: 'auto', paddingTop: Spacing.four },
  footerLogo: { height: 18, width: 18 * LogoAspect.horizontal, marginBottom: 4 },
  version: { color: '#9aa0a6' },
  editTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  editBody: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three },
  editSaveBtn: {
    backgroundColor: GREEN,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    marginTop: Spacing.five,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  modalSheet: { borderRadius: Spacing.four, padding: Spacing.four },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  modalActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.four },
  modalCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three },
  modalSave: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: GREEN,
  },
});
