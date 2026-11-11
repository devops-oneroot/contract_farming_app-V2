import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useRef, useState, type MutableRefObject, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextInput as RNTextInput,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/exo-text';
import { VerticalGradient } from '@/components/vertical-gradient';
import { Photos } from '@/constants/photos';
import { Brand, LogoAspect, Logos } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';

// Branded auth palette (these screens are always light — no theme dependence).
export const AUTH = {
  bg: Brand.surface,
  card: '#ffffff',
  input: '#F7F3EE',
  btn: Brand.primary,
  gold: '#B8912E',
  heading: '#12212b',
  subtitle: '#67788a',
  label: '#1a1a1a',
  border: '#E8DFD3',
  danger: Brand.danger,
  green: Brand.primary,
  clay: Brand.secondary,
};

/** Side-by-side photo and form from this content width up (tablets, web). */
const WIDE_AT = 640;

type Shade = [number, [number, number, number, number]][];

/**
 * Each screen has its own backdrop so the two never look like the same page:
 * Sign in is the field team at work under a slate shade; Sign up is the
 * partnership handshake under a deep green one. Both shades darken toward the
 * foot of the photo so the white text reads on any part of it.
 */
const VARIANTS = {
  signin: {
    photo: Photos.fieldVisit,
    shade: [
      [0, [18, 33, 43, 0.25]],
      [0.55, [18, 33, 43, 0.45]],
      [1, [18, 33, 43, 0.9]],
    ] as Shade,
    kickerBg: 'rgba(255,127,0,0.92)',
    kicker: 'CONTRACT FARMING',
    kickerIcon: 'leaf' as const,
    // Behind the form on wide screens.
    pageBg: AUTH.bg,
  },
  signup: {
    photo: require('@/assets/images/banners/handshake.jpg'),
    shade: [
      [0, [12, 60, 34, 0.3]],
      [0.5, [16, 82, 46, 0.5]],
      [1, [10, 52, 29, 0.92]],
    ] as Shade,
    kickerBg: 'rgba(46,158,91,0.95)',
    kicker: 'JOIN ONEROOT',
    kickerIcon: 'people' as const,
    pageBg: Brand.secondarySurface,
  },
};

/**
 * The frame for Login and Sign Up.
 *
 * Phone: a field photo across the top with the logo and title on it, and the
 * form on a white sheet that rises over its foot. The photo shrinks on short
 * screens so the form, not the picture, gets the space.
 *
 * Tablet / web (content ≥ 640 wide): photo panel on the left, form on the
 * right, both filling the height.
 */
export function AuthScaffold({
  title,
  subtitle,
  variant = 'signin',
  children,
}: {
  title: string;
  subtitle: string;
  /** Which backdrop: the Sign in or the Sign up one. */
  variant?: keyof typeof VARIANTS;
  children: ReactNode;
}) {
  const v = VARIANTS[variant];
  const insets = useSafeAreaInsets();
  const width = useContentWidth();
  const { height } = useWindowDimensions();
  const wide = width >= WIDE_AT;

  // Never more than ~36% of a phone's height, never less than enough for the copy.
  const heroH = Math.round(Math.max(230, Math.min(330, height * 0.36))) + insets.top;

  const brandBlock = (
    <>
      <Image
        source={Logos.horizontalWhite}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel="OneRoot"
      />
      <View style={[styles.kicker, { backgroundColor: v.kickerBg }]}>
        <Ionicons name={v.kickerIcon} size={12} color="#fff" />
        <Text style={styles.kickerText}>{v.kicker}</Text>
      </View>
      <Text style={[styles.heroTitle, wide && { fontSize: 34, lineHeight: 40 }]}>{title}</Text>
      <Text style={styles.heroSub}>{subtitle}</Text>
    </>
  );

  const footer = (
    <View style={styles.footer}>
      <Ionicons name="shield-checkmark" size={13} color={AUTH.subtitle} />
      <Text style={styles.footerText}>Your details stay private and secure</Text>
    </View>
  );

  if (wide) {
    return (
      <View style={[styles.container, styles.row, { backgroundColor: v.pageBg }]}>
        <View style={styles.sidePanel}>
          <Image source={v.photo} style={StyleSheet.absoluteFill} contentFit="cover" />
          <VerticalGradient stops={v.shade} />
          <View style={[styles.sideCopy, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
            {brandBlock}
          </View>
        </View>
        <KeyboardAvoidingView style={{ flex: 1.15 }} behavior="padding">
          <ScrollView
            contentContainerStyle={[
              styles.wideScroll,
              { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.wideForm}>{children}</View>
            {footer}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* The photo and title stay put; only the white sheet scrolls, sliding up
          over them. Drawn a little taller than the gap left for it so the
          sheet's rounded corners sit on photo, not on blank page. */}
      <View style={[styles.fixedHero, { height: heroH + 40 }]} pointerEvents="none">
        <Image source={v.photo} style={StyleSheet.absoluteFill} contentFit="cover" />
        <VerticalGradient stops={v.shade} />
        {/* Sized by height alone. Not `flex: 0`: on web that compiles to
            `flex-basis: 0%`, which beats `height`, collapses this box to nothing,
            and the bottom-aligned title spills off the top of the screen. */}
        <View style={[styles.heroCopy, { height: heroH, paddingTop: insets.top + 16 }]}>
          {brandBlock}
        </View>
      </View>

      {/*
        'padding' on Android too, despite the RN/Expo docs suggesting `undefined` there.
        That default assumes the manifest's adjustResize shrinks the window for the keyboard,
        but edge-to-edge (gradle.properties: edgeToEdgeEnabled, mandatory since SDK 54) makes
        the app draw behind the keyboard instead — so `undefined` leaves KeyboardAvoidingView
        inert and the keyboard covers the submit button. Don't "fix" this back to undefined.
      */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          bounces={false}>
          {/* Transparent gap the height of the photo; the sheet starts below it. */}
          <View style={{ height: heroH }} />

          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            {children}
            {footer}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Small heading at the top of the form. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={styles.formTitle}>{title}</Text>
      {subtitle ? <Text style={styles.formSub}>{subtitle}</Text> : null}
    </View>
  );
}

/**
 * Labelled input with a leading icon. The border turns brand orange while
 * focused, and red when `error` is set, so the agent can see which field the
 * message is about.
 */
export function AuthField({
  label,
  icon,
  prefix,
  error,
  inputRef,
  secure,
  hint,
  ...input
}: TextInputProps & {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Fixed text before the input, e.g. a country code. */
  prefix?: string;
  error?: boolean;
  inputRef?: Ref<RNTextInput>;
  /** A password: hidden by default, with an eye button to show / hide it. */
  secure?: boolean;
  /** Small helper line under the field. */
  hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const borderColor = error ? AUTH.danger : focused ? AUTH.btn : AUTH.border;

  // Our own handle on the input, so a tap anywhere on the box (the icon, the
  // padding) focuses it - while still handing it to the caller's `inputRef`.
  const innerRef = useRef<RNTextInput | null>(null);
  const setRef = useCallback(
    (node: RNTextInput | null) => {
      innerRef.current = node;
      if (typeof inputRef === 'function') inputRef(node);
      else if (inputRef) (inputRef as MutableRefObject<RNTextInput | null>).current = node;
    },
    [inputRef]
  );

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.label}>{label}</Text>
      {/*
        Focus changes COLOURS only. Never toggle elevation / shadow / opacity /
        zIndex here: on the New Architecture that changes whether this box is a
        native view of its own, so Android detaches and re-attaches the
        TextInput inside it - and a re-attached input has lost its focus. That
        was the "fields cannot be focused" bug: focusing restyled the box, which
        blurred the field straight away.
      */}
      <Pressable
        onPress={() => innerRef.current?.focus()}
        disabled={input.editable === false}
        accessible={false}
        style={[styles.field, { borderColor, backgroundColor: focused ? '#fff' : AUTH.input }]}>
        <Ionicons name={icon} size={19} color={focused ? AUTH.btn : AUTH.subtitle} />
        {prefix ? (
          <View style={styles.prefix}>
            <Text style={styles.prefixText}>{prefix}</Text>
          </View>
        ) : null}
        <TextInput
          ref={setRef}
          placeholderTextColor="#9AA5B1"
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          secureTextEntry={secure ? hidden : input.secureTextEntry}
          autoCapitalize={secure ? 'none' : input.autoCapitalize}
          autoCorrect={secure ? false : input.autoCorrect}
          style={[styles.fieldInput, input.editable === false && { color: AUTH.subtitle }]}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={21}
              color={focused ? AUTH.btn : AUTH.subtitle}
            />
          </Pressable>
        ) : null}
      </Pressable>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** A checkbox row with a label, e.g. "Use default password". */
export function AuthCheckbox({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      hitSlop={6}
      style={styles.checkRow}>
      <View
        style={[
          styles.checkBox,
          checked ? { backgroundColor: AUTH.btn, borderColor: AUTH.btn } : { borderColor: AUTH.border },
        ]}>
        {checked ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkLabel}>{label}</Text>
        {sub ? <Text style={styles.fieldHint}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The one big call to action. */
export function AuthButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        (loading || disabled) && { opacity: 0.7 },
        pressed && { transform: [{ scale: 0.98 }], backgroundColor: Brand.primaryDark },
      ]}>
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <Text style={styles.btnText}>{label}</Text>
          <View style={styles.btnArrow}>
            <Ionicons name="arrow-forward" size={16} color={AUTH.btn} />
          </View>
        </>
      )}
    </Pressable>
  );
}

/** Inline error, with an icon so it is not mistaken for help text. */
export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={16} color={AUTH.danger} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/** "New user? Create account" style switch between the two screens. */
export function AuthSwitch({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.divider} />
      <Pressable onPress={onPress} hitSlop={8} style={styles.switchBtn}>
        <Text style={{ color: AUTH.subtitle, fontSize: 14 }}>
          {prompt} <Text style={{ color: AUTH.btn, fontWeight: '800' }}>{action}</Text>
        </Text>
      </Pressable>
    </View>
  );
}

/** A selectable card, used for picking a role. */
export function AuthChoice({
  label,
  hint,
  icon,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.choice,
        selected
          ? { borderColor: AUTH.btn, backgroundColor: Brand.primarySurface }
          : { borderColor: AUTH.border, backgroundColor: '#fff' },
        pressed && { opacity: 0.85 },
      ]}>
      <View style={[styles.choiceIcon, { backgroundColor: selected ? AUTH.btn : AUTH.input }]}>
        <Ionicons name={icon} size={18} color={selected ? '#fff' : AUTH.subtitle} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceLabel, selected && { color: Brand.primaryDark }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.choiceHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      {/* A radio mark on every row, filled on the chosen one, so it reads as
          "pick one" before anything is tapped. */}
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={selected ? AUTH.btn : AUTH.border}
      />
    </Pressable>
  );
}

// Kept for any screen still styling its own auth controls.
export const authStyles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: AUTH.label, marginBottom: 6 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AUTH.bg },
  row: { flexDirection: 'row' },

  // Hero (phone)
  fixedHero: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  heroCopy: { justifyContent: 'flex-end', paddingHorizontal: 24, paddingBottom: 46 },
  logo: { width: 132, height: 132 / LogoAspect.horizontal, marginBottom: 'auto' },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,127,0,0.9)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  kickerText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  heroTitle: { color: '#fff', fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.88)', fontSize: 15, lineHeight: 21, marginTop: 4 },

  // Form sheet (phone)
  sheet: {
    flexGrow: 1,
    backgroundColor: AUTH.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -28,
    paddingHorizontal: 22,
    paddingTop: 26,
  },

  // Wide layout
  sidePanel: { flex: 1, overflow: 'hidden' },
  sideCopy: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 32 },
  wideScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32 },
  wideForm: {
    backgroundColor: AUTH.card,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  formTitle: { fontSize: 22, fontWeight: '800', color: AUTH.heading },
  formSub: { fontSize: 14, color: AUTH.subtitle, marginTop: 2 },

  label: { fontSize: 13, fontWeight: '700', color: AUTH.label, marginBottom: 7 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 54,
  },
  prefix: { borderRightWidth: 1, borderRightColor: AUTH.border, paddingRight: 10 },
  prefixText: { fontSize: 16, fontWeight: '700', color: AUTH.heading },
  fieldInput: { flex: 1, fontSize: 16, color: AUTH.heading, paddingVertical: 14 },
  fieldHint: { fontSize: 12, color: AUTH.subtitle, marginTop: 5, lineHeight: 16 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14 },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkLabel: { fontSize: 14, fontWeight: '700', color: AUTH.heading },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: AUTH.btn,
    borderRadius: 16,
    minHeight: 56,
    marginTop: 22,
    shadowColor: Brand.primary,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  btnArrow: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Brand.dangerSurface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  errorText: { color: AUTH.danger, fontSize: 13, fontWeight: '600', flex: 1 },

  switchRow: { marginTop: 22, alignItems: 'center' },
  divider: { height: 1, alignSelf: 'stretch', backgroundColor: AUTH.border, marginBottom: 16 },
  switchBtn: { paddingVertical: 4 },

  // One full-width row per option.
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  choiceIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  choiceLabel: { fontSize: 15, fontWeight: '800', color: AUTH.heading },
  choiceHint: { fontSize: 12, lineHeight: 16, color: AUTH.subtitle, marginTop: 1 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 'auto',
    paddingTop: 24,
  },
  footerText: { fontSize: 12, color: AUTH.subtitle },
});
