import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DripPart, Enquiry, EnquiryImplement } from '@/lib/api';

const GREEN = Brand.primary;

/** Tractor implements, in the order the field team asked for them. */
export const ENQUIRY_IMPLEMENTS: { key: EnquiryImplement; label: string }[] = [
  { key: 'rotavator', label: 'Rotavators' },
  { key: 'mb_plough', label: 'MB Ploughs' },
  { key: 'five_axle_plough', label: '5 axle ploughs' },
  { key: 'cultivator', label: 'Cultivators' },
  { key: 'bed_farm', label: 'Bed farms' },
  { key: 'power_tool', label: 'Power tools' },
  { key: 'mulcher', label: 'Mulcher' },
];

/** What a drip irrigation farmer may want - shown only when drip is "yes". */
export const ENQUIRY_DRIP_PARTS: { key: DripPart; label: string }[] = [
  { key: 'laterals', label: 'Laterals' },
  { key: 'attachments', label: 'Attachments' },
];

/** Nothing answered yet. `null` on a yes/no means "not asked", which is not "no". */
export const blankEnquiry = (): Enquiry => ({
  tractorImplements: null,
  implements: [],
  dripIrrigation: null,
  dripParts: [],
  insurance: null,
  kccLowCost: null,
});

/** Fills any missing keys, so a farmer saved before enquiries existed reads as blank. */
export const enquiryOf = (e?: Partial<Enquiry> | null): Enquiry => {
  const merged = { ...blankEnquiry(), ...(e ?? {}) };
  // Saved before the Yes/No question existed: ticked implements already mean yes.
  if (merged.tractorImplements == null && merged.implements.length > 0) merged.tractorImplements = true;
  return merged;
};

/**
 * Whether two enquiries differ. Order of the ticked boxes does not matter, and
 * the server's JSON key order is not the same as ours, so compare canonically.
 */
export function enquiryChanged(a: Enquiry, b: Enquiry): boolean {
  const canon = (e: Enquiry) =>
    JSON.stringify({
      tractorImplements: e.tractorImplements ?? null,
      implements: [...e.implements].sort(),
      dripIrrigation: e.dripIrrigation ?? null,
      dripParts: [...e.dripParts].sort(),
      insurance: e.insurance ?? null,
      kccLowCost: e.kccLowCost ?? null,
    });
  return canon(a) !== canon(b);
}

/**
 * An enquiry as short lines for a history list, e.g.
 * ["Tractor: Rotavators, Mulcher", "Drip: Laterals", "Insurance: No"].
 * Questions not asked are left out.
 */
export function enquirySummary(e: Enquiry): string[] {
  const named = (keys: string[], list: { key: string; label: string }[]) =>
    keys.map((k) => list.find((o) => o.key === k)?.label ?? k).join(', ');
  const out: string[] = [];
  if (e.tractorImplements != null) {
    out.push(`Tractor implements: ${e.tractorImplements ? named(e.implements, ENQUIRY_IMPLEMENTS) || 'Yes' : 'No'}`);
  }
  if (e.dripIrrigation != null) {
    out.push(`Drip irrigation: ${e.dripIrrigation ? named(e.dripParts, ENQUIRY_DRIP_PARTS) || 'Yes' : 'No'}`);
  }
  if (e.insurance != null) out.push(`Insurance: ${e.insurance ? 'Yes' : 'No'}`);
  if (e.kccLowCost != null) out.push(`KCC low cost: ${e.kccLowCost ? 'Yes' : 'No'}`);
  return out;
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * The enquiry questions, shared by onboarding and Edit farmer:
 *  1. tractor implements yes / no - "yes" opens the implements to tick;
 *  2. drip irrigation yes / no - "yes" opens laterals and attachments;
 *  3. insurance yes / no;
 *  4. KCC low cost yes / no.
 */
export function EnquiryFields({ value, onChange }: { value: Enquiry; onChange: (e: Enquiry) => void }) {
  const theme = useTheme();

  const check = (checked: boolean, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => [
        styles.checkRow,
        {
          backgroundColor: checked ? Brand.primarySurface : theme.backgroundElement,
          borderColor: checked ? GREEN : 'transparent',
        },
        pressed && { opacity: 0.85 },
      ]}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={20} color={checked ? GREEN : theme.textSecondary} />
      <ThemedText type="small" style={{ flex: 1, color: theme.text, fontWeight: checked ? '700' : '500' }}>
        {label}
      </ThemedText>
    </Pressable>
  );

  /** Two check boxes that cannot both be ticked: Yes, or No, or neither (not asked). */
  const yesNo = (v: boolean | null, onSet: (next: boolean | null) => void) => (
    <View style={styles.yesNoRow}>
      {check(v === true, 'Yes', () => onSet(v === true ? null : true))}
      {check(v === false, 'No', () => onSet(v === false ? null : false))}
    </View>
  );

  const label = (text: string) => (
    <ThemedText type="small" themeColor="textSecondary" style={styles.groupLabel}>
      {text}
    </ThemedText>
  );

  return (
    <View style={{ gap: Spacing.two }}>
      {label('Tractor implements')}
      {yesNo(value.tractorImplements, (next) =>
        onChange({ ...value, tractorImplements: next, implements: next === true ? value.implements : [] })
      )}
      {value.tractorImplements === true ? (
        <View style={styles.indent}>
          {ENQUIRY_IMPLEMENTS.map((o) =>
            check(value.implements.includes(o.key), o.label, () =>
              onChange({ ...value, implements: toggle(value.implements, o.key) })
            )
          )}
        </View>
      ) : null}

      {label('Drip irrigation')}
      {yesNo(value.dripIrrigation, (next) =>
        onChange({ ...value, dripIrrigation: next, dripParts: next === true ? value.dripParts : [] })
      )}
      {value.dripIrrigation === true ? (
        <View style={styles.indent}>
          {label('Drip irrigation - what they need')}
          {ENQUIRY_DRIP_PARTS.map((o) =>
            check(value.dripParts.includes(o.key), o.label, () =>
              onChange({ ...value, dripParts: toggle(value.dripParts, o.key) })
            )
          )}
        </View>
      ) : null}

      {label('Insurance')}
      {yesNo(value.insurance, (next) => onChange({ ...value, insurance: next }))}

      {label('KCC low cost')}
      {yesNo(value.kccLowCost, (next) => onChange({ ...value, kccLowCost: next }))}
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: { marginTop: Spacing.three },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
  yesNoRow: { flexDirection: 'row', gap: Spacing.two },
  indent: { marginLeft: Spacing.three, gap: Spacing.two },
});
