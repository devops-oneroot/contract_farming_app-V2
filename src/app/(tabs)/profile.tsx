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
  useWindowDimensions,
  View,
} from 'react-native';
import { TextInput } from '@/components/exo-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SafeAreaView, TOP_GAP } from '@/components/safe-area-view';

import { ThemedText } from '@/components/themed-text';
import { NotificationBell } from '@/components/notification-bell';
import { ThemedView } from '@/components/themed-view';
import { Brand, CardShadow, LogoAspect, Logos, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { api, Role } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { PHOTO_CREDITS } from '@/constants/photos';
import { appVersion, lastUpdatedDate, versionWithDate } from '@/lib/app-version';

const GREEN = Brand.primary;

/**
 * Which JavaScript bundle this app is actually running: the one baked into the
 * build, or an over-the-air update on top of it.
 *
 * Shown in the footer so an OTA can be confirmed from the phone itself — a
 * colour change tells you something arrived, this tells you exactly what. All
 * values are null in development, where expo-updates is disabled.
 */
/** Which code is running: the base build, or an over-the-air update and its id. */
function bundleLabel() {
  if (__DEV__) return 'dev';
  if (Updates.isEmbeddedLaunch) return 'base build';
  // First segment of the update UUID is plenty to tell two updates apart.
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : null;
  return ['update', id].filter(Boolean).join(' ');
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
  if (role === 'attendance_staff') return 'Attendance & Tracking';
  return 'Farmer';
}

function roleIcon(role?: Role): keyof typeof Ionicons.glyphMap {
  if (role === 'senior_agronomist') return 'ribbon';
  if (role === 'agronomist') return 'flask';
  if (role === 'attendance_staff') return 'finger-print';
  return 'leaf';
}

/** Icon colours for the menu: one family per kind of thing. */
const TINTS = {
  orange: Brand.primary,
  green: Brand.secondary,
  gold: Brand.accent,
  blue: '#2F7BD8',
} as const;

/** "Pradeep R" -> "PR", "Teja" -> "TE". */
function initials(name?: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


/** One menu line: tinted icon, title and an optional second line, chevron. */
function MenuRow({
  icon,
  tint,
  title,
  sub,
  onPress,
  danger,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  sub?: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.backgroundElement },
        pressed && { opacity: 0.6 },
      ]}>
      <View style={[styles.rowIcon, { backgroundColor: `${tint}1F` }]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="small" style={[styles.menuTitle, danger && { color: Brand.danger }]}>
          {title}
        </ThemedText>
        {sub ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.menuSub}>
            {sub}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={danger ? Brand.danger : theme.textSecondary} />
    </Pressable>
  );
}

/**
 * Height of everything in the orange header except the avatar and the safe
 * area: top bar 40, gaps, avatar ring 8, name 28, role 22, mobile + location
 * chip 26, bottom padding 20, plus a little slack for the font.
 */
const HEADER_FIXED = 40 + 8 + 8 + 8 + 28 + 6 + 22 + 10 + 26 + 20 + 10;

export default function ProfileScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  // The orange header aims for at most 38% of the screen's height. Nothing in
  // it is ever clipped: instead the avatar takes whatever room is left after
  // the fixed rows (top bar, name, role, mobile + location), between 44 and 76.
  const { height: screenH } = useWindowDimensions();
  const headerMax = Math.round(screenH * 0.38);
  const fixedRows = insets.top + TOP_GAP + HEADER_FIXED;
  const avatarSize = Math.max(44, Math.min(76, headerMax - fixedRows));
  const router = useRouter();
  const { user, updateUser, signOut } = useAuth();

  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;
  // Attendance staff are not farmers: no farm boundary section for them.
  const isFarmer = user?.role === 'farmer';

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

  /** Shown in the header, under the name. */
  const locationText = hasLocation
    ? `${user!.location.latitude!.toFixed(3)}, ${user!.location.longitude!.toFixed(3)}`
    : 'Location not set';


  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {/* Header: brand colour with soft circles for depth, the person in the middle. */}
      <View style={[styles.headerBand, { paddingTop: insets.top + TOP_GAP }]}>
        <View pointerEvents="none" style={[styles.blob, styles.blobA]} />
        <View pointerEvents="none" style={[styles.blob, styles.blobB]} />
        <View pointerEvents="none" style={[styles.blob, styles.blobC]} />
        <View style={styles.topRow}>
          <Image source={Logos.horizontalWhite} style={styles.brandLogo} contentFit="contain" accessibilityLabel="OneRoot" />
          <View style={{ flex: 1 }} />
          <NotificationBell light />
        </View>

        {/* Avatar on top, then the name, the role, and mobile + location - centred. */}
        <View style={styles.heroRow}>
          <Pressable onPress={openEdit} accessibilityLabel="Edit profile" style={styles.avatarRing}>
            <View style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
              <ThemedText
                style={[styles.avatarText, { fontSize: Math.round(avatarSize * 0.37), lineHeight: Math.round(avatarSize * 0.45) }]}>
                {initials(user?.name)}
              </ThemedText>
            </View>
            <View style={styles.avatarBadge}>
              <Ionicons name="pencil" size={10} color="#fff" />
            </View>
          </Pressable>
          <View style={styles.heroText}>
            {/* Line 1: who - the name, and the role beside it. */}
            <View style={styles.heroLine}>
              <ThemedText type="subtitle" style={styles.heroName} numberOfLines={1}>
                {user?.name ?? 'User'}
              </ThemedText>
              <View style={styles.rolePill}>
                <Ionicons name={roleIcon(user?.role)} size={11} color={GREEN_DARK} />
                <ThemedText style={styles.roleText}>{roleName(user?.role).toUpperCase()}</ThemedText>
              </View>
            </View>
            {/* Line 2: how to reach them - mobile and location. */}
            <View style={styles.heroMeta}>
              {user?.mobile ? (
                <View style={styles.infoChip}>
                  <Ionicons name="call" size={11} color="#fff" />
                  <ThemedText style={styles.infoChipText}>{user.mobile}</ThemedText>
                </View>
              ) : null}
              <View style={[styles.infoChip, { flexShrink: 1 }]}>
                <Ionicons name="location" size={11} color="#fff" />
                <ThemedText style={styles.infoChipText} numberOfLines={1}>
                  {locationText}
                </ThemedText>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* The menu scrolls between the header and the fixed bottom bar. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>

        {/* Things to do: the farm boundary for a farmer, team accounts for a senior. */}
        {(isFarmer || user?.role === 'senior_agronomist') && (
          <>
            <ThemedText type="smallBold" style={[styles.sectionTitle, styles.sectionGap]}>
              {isFarmer ? 'MY FARM' : 'TEAM'}
            </ThemedText>
            <ThemedView style={styles.card}>
              {isFarmer && (
                <MenuRow
                  icon="map-outline"
                  tint={TINTS.green}
                  title="Farm boundary (Geofence)"
                  sub={geofenceCount >= 3 ? `${geofenceCount} corners marked` : 'Not set — tap to draw'}
                  onPress={() => router.push('/geofence')}
                  last
                />
              )}
              {/* Accounts are made here, by a senior agronomist - there is no sign-up. */}
              {user?.role === 'senior_agronomist' && (
                <MenuRow
                  icon="person-add-outline"
                  tint={TINTS.green}
                  title="Create account"
                  sub="Add an agronomist or senior agronomist"
                  onPress={() => router.push('/create-account' as never)}
                  last
                />
              )}
            </ThemedView>
          </>
        )}

        <ThemedText type="smallBold" style={[styles.sectionTitle, styles.sectionGap]}>
          HELP & INFO
        </ThemedText>
        <ThemedView style={styles.card}>
          <MenuRow
            icon="headset-outline"
            tint={TINTS.blue}
            title="Help & Support"
            sub="Call 9606031878"
            onPress={() => Linking.openURL('tel:9606031878').catch(() => {})}
          />
          <MenuRow
            icon="play-circle-outline"
            tint={TINTS.gold}
            title="View intro again"
            sub="Replay the welcome slides"
            onPress={() => router.push('/onboarding')}
          />
          <MenuRow
            icon="information-circle-outline"
            tint={TINTS.orange}
            title="About OneRoot"
            sub={`Version ${appVersion}`}
            onPress={() =>
              Alert.alert(
                'OneRoot',
                `OneRoot — contract farming, simplified.\n\nSupport: 9606031878\nVersion ${appVersion}${lastUpdatedDate() ? ` (updated ${lastUpdatedDate()})` : ''}\n\nPhotos:\n${PHOTO_CREDITS.join('\n')}`
              )
            }
            last
          />
        </ThemedView>

        {/* Log out: the last menu item, in red so it is never tapped by mistake. */}
        <Pressable
          onPress={confirmSignOut}
          accessibilityRole="button"
          accessibilityLabel="Log out"
          style={({ pressed }) => [styles.logoutBtn, styles.sectionGap, pressed && { opacity: 0.75 }]}>
          <Ionicons name="log-out-outline" size={18} color={Brand.danger} />
          <ThemedText style={styles.logoutText}>Log out</ThemedText>
        </Pressable>
      </ScrollView>

      {/* Always at the bottom: the brand and the version running. */}
      <View style={styles.footer}>
        <Image source={Logos.horizontal} style={styles.footerLogo} contentFit="contain" />
        <ThemedText type="small" themeColor="textSecondary">
          OneRoot · Contract farming, simplified
        </ThemedText>
        <ThemedText type="small" style={styles.version}>
          {versionWithDate()} · {bundleLabel()}
        </ThemedText>
      </View>

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
    paddingBottom: Spacing.three + Spacing.one,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
  },
  // Stacked and centred: avatar, then name, role, and mobile + location.
  heroRow: { alignItems: 'center', gap: Spacing.two, width: '100%', marginTop: Spacing.two },
  heroText: { alignItems: 'center', width: '100%' },
  // Soft light circles behind the header, for depth.
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.09)' },
  blobA: { width: 220, height: 220, top: -80, right: -60 },
  blobB: { width: 160, height: 160, bottom: -70, left: -50 },
  blobC: { width: 90, height: 90, top: 40, left: '45%', backgroundColor: 'rgba(255,255,255,0.05)' },
  // A soft ring around the avatar, so it lifts off the orange.
  avatarRing: { padding: 4, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.18)' },
  // Name on its own line, the role under it.
  heroLine: { alignItems: 'center', gap: 6, width: '100%' },
  menuTitle: { fontWeight: '700', fontSize: 15, lineHeight: 20 },
  menuSub: { fontSize: 13, lineHeight: 18 },
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Spacing.four,
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  infoChipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Brand.secondary,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMeta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: Spacing.two, marginTop: 10 },
  sectionTitle: { flex: 1, fontSize: 13, letterSpacing: 0.8, opacity: 0.6 },
  sectionGap: { marginTop: 2, marginLeft: 2 },
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
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarText: { color: GREEN_DARK, fontSize: 28, fontWeight: '800', lineHeight: 34 },
  heroName: { color: '#fff', fontSize: 22, lineHeight: 28, textAlign: 'center' },
  // White pill with the deep orange text: the role reads first after the name.
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Spacing.four,
  },
  roleText: { color: GREEN_DARK, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  body: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  card: { borderRadius: Radius.lg, paddingHorizontal: Spacing.three, ...CardShadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 10 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: 11,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Brand.danger,
    backgroundColor: Brand.dangerSurface,
  },
  logoutText: { color: Brand.danger, fontSize: 15, fontWeight: '800' },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,127,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { alignItems: 'center', gap: 3, paddingTop: Spacing.two, paddingBottom: Spacing.three },
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
