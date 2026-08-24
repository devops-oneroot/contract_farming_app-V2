import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DateRange } from '@/lib/api';

const GREEN = Brand.primary;

/** A chosen window, with the words to describe it on the filter chip. */
export type DateFilter = { label: string } & DateRange;

export const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The windows worth one tap. Deliberately few: an agent filtering a list in the
 * field wants today, yesterday, or roughly the last week — anything more
 * specific is what the exact-day picker below is for.
 */
export const DATE_PRESETS: { key: string; label: string; build: () => DateFilter }[] = [
  {
    key: 'today',
    label: 'Today',
    build: () => ({ label: 'Today', from: startOfDay(new Date()), to: endOfDay(new Date()) }),
  },
  {
    key: 'yesterday',
    label: 'Yesterday',
    build: () => ({ label: 'Yesterday', from: startOfDay(daysAgo(1)), to: endOfDay(daysAgo(1)) }),
  },
  {
    key: 'week',
    label: 'Last 7 days',
    build: () => ({ label: 'Last 7 days', from: startOfDay(daysAgo(6)), to: endOfDay(new Date()) }),
  },
  {
    key: 'month',
    label: 'Last 30 days',
    build: () => ({ label: 'Last 30 days', from: startOfDay(daysAgo(29)), to: endOfDay(new Date()) }),
  },
];

/**
 * Narrow a list to a period — the same sheet, wording and behaviour wherever a
 * screen offers it.
 *
 * Written once because two screens had already grown their own copy, and a
 * third would have guaranteed they drifted: an agent who learns this on People
 * should not find it behaving differently on Products Given.
 *
 * The window is always local midnight to local midnight. A bare `YYYY-MM-DD`
 * would be read as UTC — 05:30 in IST — so "today" would drop everything
 * recorded before dawn.
 */
export function DateFilterSheet({
  visible,
  value,
  onChange,
  onClose,
  /** What one day of this list contains, e.g. "every sale made on one date". */
  dayHint,
}: {
  visible: boolean;
  value: DateFilter | null;
  onChange: (v: DateFilter | null) => void;
  onClose: () => void;
  dayHint: string;
}) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows taps meant for the sheet, which would otherwise reach the
            backdrop behind it and close it mid-choice. */}
        <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={() => {}}>
          <View style={styles.handle} />
          <ThemedText type="smallBold" style={{ fontSize: 16 }}>
            Filter by date
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
            Show only {dayHint} in this period.
          </ThemedText>

          <View style={styles.presetWrap}>
            {DATE_PRESETS.map((preset) => {
              const on = value?.label === preset.label;
              return (
                <Pressable
                  key={preset.key}
                  onPress={() => {
                    onChange(preset.build());
                    onClose();
                  }}
                  style={[
                    styles.preset,
                    {
                      backgroundColor: on ? GREEN : theme.backgroundElement,
                      borderColor: on ? GREEN : 'transparent',
                    },
                  ]}>
                  <ThemedText
                    type="small"
                    style={{ color: on ? '#fff' : theme.text, fontWeight: '600' }}>
                    {preset.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => setPicking(true)}
            style={({ pressed }) => [
              styles.pickDate,
              { backgroundColor: theme.backgroundElement },
              pressed && { opacity: 0.85 },
            ]}>
            <Ionicons name="calendar" size={18} color={GREEN} />
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">Pick an exact day</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                See {dayHint} on one date
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Pressable>

          {picking ? (
            <DateTimePicker
              value={value ? value.from : new Date()}
              mode="date"
              maximumDate={new Date()}
              onChange={(event, selected) => {
                if (Platform.OS !== 'ios') setPicking(false);
                if (event.type === 'set' && selected) {
                  onChange({
                    label: fmtDate(selected),
                    from: startOfDay(selected),
                    to: endOfDay(selected),
                  });
                  if (Platform.OS !== 'ios') onClose();
                }
              }}
            />
          ) : null}
          {Platform.OS === 'ios' && picking ? (
            <Pressable
              onPress={() => {
                setPicking(false);
                onClose();
              }}
              style={styles.done}>
              <ThemedText type="linkPrimary">Done</ThemedText>
            </Pressable>
          ) : null}

          {/* Only offered when there is something to clear. */}
          {value ? (
            <Pressable
              onPress={() => {
                onChange(null);
                onClose();
              }}
              style={styles.clear}>
              <ThemedText type="small" themeColor="textSecondary">
                Clear date filter
              </ThemedText>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    padding: Spacing.four,
    paddingBottom: Spacing.six,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(127,127,127,0.35)',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  preset: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 1,
  },
  pickDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  done: { alignItems: 'center', paddingVertical: Spacing.three },
  clear: { alignItems: 'center', paddingVertical: Spacing.three, marginTop: Spacing.two },
});
