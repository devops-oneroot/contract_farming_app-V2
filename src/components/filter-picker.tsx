import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { TextInput } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

const GREEN = Brand.primary;
const GREEN_SURFACE = Brand.surface;

export type FilterOption = {
  /** What goes back to the caller. A product id, a crop name — its choice. */
  value: string;
  label: string;
  imageUrl?: string;
};

/**
 * Pick one value from a catalogue, or clear back to "all".
 *
 * A sheet rather than a row of chips because these lists are catalogues: a few
 * dozen products will not fit on a phone's width, and a filter you have to
 * scroll sideways to find is one that never gets used.
 */
export function FilterPicker({
  visible,
  title,
  allLabel,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** Wording for the clear-the-filter row, e.g. "All products". */
  allLabel: string;
  options: FilterOption[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const sheetBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const choose = (value: string | null) => {
    onSelect(value);
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area is the fastest way out of a sheet. */}
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: sheetBg }]}>
          <SafeAreaView edges={['bottom']}>
            <View style={styles.bar}>
              <ThemedText type="smallBold">{title}</ThemedText>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>

            {/* Only worth a search box when the list is long enough to hunt through. */}
            {options.length > 8 && (
              <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="search" size={18} color={theme.textSecondary} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search ${title.toLowerCase()}`}
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.searchInput, { color: theme.text }]}
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                  </Pressable>
                ) : null}
              </View>
            )}

            <FlatList
              data={shown}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListHeaderComponent={
                <Pressable onPress={() => choose(null)} style={styles.row}>
                  <View style={[styles.thumb, styles.thumbEmpty]}>
                    <Ionicons name="apps-outline" size={16} color={theme.textSecondary} />
                  </View>
                  <ThemedText type="small" style={{ flex: 1, fontWeight: '600' }}>
                    {allLabel}
                  </ThemedText>
                  {selected === null && <Ionicons name="checkmark" size={18} color={GREEN} />}
                </Pressable>
              }
              ListEmptyComponent={
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={{ textAlign: 'center', paddingVertical: Spacing.four }}>
                  Nothing matches “{query}”.
                </ThemedText>
              }
              renderItem={({ item }) => {
                const on = selected === item.value;
                return (
                  <Pressable onPress={() => choose(item.value)} style={styles.row}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.thumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbEmpty]}>
                        <Ionicons name="cube-outline" size={16} color={theme.textSecondary} />
                      </View>
                    )}
                    <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                      {item.label}
                    </ThemedText>
                    {on && <Ionicons name="checkmark" size={18} color={GREEN} />}
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    // Never a full-height sheet: what it covers should stay recognisable.
    maxHeight: '75%',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginHorizontal: Spacing.four,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.two, fontSize: 15 },
  list: { paddingHorizontal: Spacing.four, marginTop: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  thumb: { width: 32, height: 32, borderRadius: Spacing.two, backgroundColor: '#d8d8d8' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
});
