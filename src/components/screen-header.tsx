import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CardShadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The top of every pushed screen: a round back button, the screen's name, and
 * an optional action on the right. One component, so every screen's header
 * sits at the same height with the same tap target - 40pt, comfortably more
 * than a bare chevron, which matters for a thumb in the field.
 */
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: ReactNode;
  onBack: () => void;
  right?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [styles.back, { backgroundColor: theme.card }, pressed && { opacity: 0.7 }]}>
        <Ionicons name="chevron-back" size={22} color={theme.text} />
      </Pressable>
      <ThemedText style={styles.title} numberOfLines={1}>
        {title}
      </ThemedText>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...CardShadow,
  },
  title: { flex: 1, fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
