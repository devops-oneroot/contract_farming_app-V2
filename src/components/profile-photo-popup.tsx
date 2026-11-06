import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A person's profile photo, enlarged over the screen - the popup a contact
 * list opens when you tap someone's picture.
 *
 * Deliberately not the full-screen PhotoViewer: this is a quick look at who
 * someone is, closed with a tap anywhere, not a proof photo to zoom into.
 * Renders nothing while `person` is null.
 */
export function ProfilePhotoPopup({
  person,
  onClose,
}: {
  person: { name?: string; mobile?: string; photoUrl: string } | null;
  onClose: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal visible={!!person} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {person && (
          <Pressable style={[styles.card, { backgroundColor: theme.background }]} onPress={() => {}}>
            <Image source={{ uri: person.photoUrl }} style={styles.photo} contentFit="cover" transition={150} />
            <View style={styles.footer}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {person.name || 'Farmer'}
                </ThemedText>
                {!!person.mobile && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {person.mobile}
                  </ThemedText>
                )}
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close photo">
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: { width: '100%', maxWidth: 320, borderRadius: Radius.lg, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: '#e5e7eb' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
});
