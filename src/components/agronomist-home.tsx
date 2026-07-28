import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CallFab } from '@/components/call-fab';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { StaffRole } from '@/lib/api';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;
const LOGO = require('@/assets/images/logo.png');

const ROLES: { key: StaffRole; label: string; desc: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'field_guy', label: 'Field Guy', desc: 'Track visits & tasks in field', icon: 'walk-outline' },
  { key: 'agronomist', label: 'Agronomist', desc: 'Analyze crops & give recommendations', icon: 'leaf-outline' },
  { key: 'junior_agronomist', label: 'Junior Agronomist', desc: 'Analyze crops & give recommendations', icon: 'school-outline' },
  { key: 'senior_agronomist', label: 'Senior Agronomist', desc: 'Analyze crops & give recommendations', icon: 'star-outline' },
];

export function AgronomistHome() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [selectedRole, setSelectedRole] = useState<StaffRole>('agronomist');

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const openRole = (role: (typeof ROLES)[number]) => {
    setSelectedRole(role.key);
    router.push({ pathname: '/agent-actions', params: { role: role.key, label: role.label } } as never);
  };

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.avatarRing}>
              <View style={styles.avatar}>
                <ThemedText style={styles.avatarText}>{user?.name?.charAt(0)?.toUpperCase() ?? '?'}</ThemedText>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.welcome}>Welcome</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {today}
              </ThemedText>
            </View>
            <View style={styles.logoPill}>
              <Image source={LOGO} style={styles.logoImg} contentFit="contain" />
              <ThemedText style={styles.logoText}>OneRoot</ThemedText>
            </View>
          </View>

          {/* Farm visits — daily core action */}
          <Pressable
            onPress={() => router.push('/farm-visits' as never)}
            style={({ pressed }) => [styles.visitsCard, pressed && { opacity: 0.9 }]}>
            <View style={styles.visitsIcon}>
              <Ionicons name="map" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.visitsTitle}>Farm Visits</ThemedText>
              <ThemedText type="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
                Visit your farmers · nearest first
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#fff" />
          </Pressable>

          <View style={styles.sectionRow}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Select Your Role
            </ThemedText>
            <Pressable
              onPress={() => router.push('/daily-report' as never)}
              style={({ pressed }) => [styles.reportBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="document-text-outline" size={16} color="#fff" />
              <ThemedText type="small" style={styles.reportBtnText}>
                Daily Report
              </ThemedText>
            </Pressable>
          </View>

          {ROLES.map((r) => {
            const on = selectedRole === r.key;
            return (
              <Pressable
                key={r.key}
                onPress={() => openRole(r)}
                style={({ pressed }) => [
                  styles.roleCard,
                  { borderColor: on ? GREEN : 'transparent' },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={styles.roleIcon}>
                  <Ionicons name={r.icon} size={22} color={GREEN} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                    {r.label}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {r.desc}
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      <CallFab />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: 120, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.two },
  avatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(46,158,91,0.15)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: GREEN, fontSize: 18, fontWeight: '800' },
  welcome: { fontSize: 22, fontWeight: '800', color: GREEN },
  logoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: Spacing.four,
  },
  logoImg: { width: 18, height: 18 },
  logoText: { fontWeight: '800', fontSize: 13 },
  visitsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: GREEN,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    marginTop: Spacing.one,
  },
  visitsIcon: {
    width: 46,
    height: 46,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitsTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
    gap: Spacing.two,
  },
  sectionTitle: { fontSize: 20 },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: GREEN,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  reportBtnText: { color: '#fff', fontWeight: '700' },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1.5,
  },
  roleIcon: {
    width: 52,
    height: 52,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(46,158,91,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
