/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Brand palette — "Earth & Leaf". One source of truth; screens must not
 * re-declare these as local hex constants.
 *
 * The colours carry meaning, so the app reads at a glance:
 *   primary   (green)      farmers, crops, growth, primary actions
 *   secondary (terracotta) aggregators — the market/buyer side of the app
 *   accent    (amber)      pending, awaiting verification
 *   danger    (red)        errors, and things missing that block work
 *
 * `surface` is a warm neutral rather than a green tint: with every screen
 * washed green, the green stopped meaning anything.
 */
export const Brand = {
  primary: '#2E9E5B',
  primaryDark: '#1F7A43',
  primarySurface: '#E7F5EC',

  secondary: '#D97742',
  secondaryDark: '#B85C2E',
  secondarySurface: '#FBEEE6',

  accent: '#F2A93B',
  accentSurface: '#FEF3E0',

  danger: '#E5484D',
  dangerSurface: '#FDECEC',

  /** Screen background — warm sand. */
  surface: '#FBF7F2',
  card: '#FFFFFF',
  ink: '#1F2A24',
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Corner radii, by the size of the thing. Cards and sheets share the same
 * curvature so the app reads as one surface rather than a pile of components.
 */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/**
 * The single elevation used by every raised surface — cards, tiles, the tab bar.
 * Screens must not re-declare their own: two shadows at different depths on one
 * screen is what makes an interface look assembled rather than designed.
 */
export const CardShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

/**
 * Breathing room a scrolling screen leaves at the bottom. The tab bar is docked,
 * so the navigator already keeps content clear of it — this is only so the last
 * row does not sit flush against the bar.
 */
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
