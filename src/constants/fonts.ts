import {
  Exo_400Regular,
  Exo_500Medium,
  Exo_600SemiBold,
  Exo_700Bold,
  Exo_800ExtraBold,
} from '@expo-google-fonts/exo';
import { Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

/** Loaded once in the root layout (`useFonts(ExoFontFiles)`). */
export const ExoFontFiles = {
  Exo_400Regular,
  Exo_500Medium,
  Exo_600SemiBold,
  Exo_700Bold,
  Exo_800ExtraBold,
};

/**
 * The app's typeface is Exo. A custom font has one file per weight, and
 * Android ignores `fontWeight` on a custom family (or fakes bold), so the
 * weight has to choose the file. Weights the app does not load fall to the
 * nearest one that is.
 */
function exoFamily(weight: TextStyle['fontWeight']): string {
  const w =
    weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : Number(weight) || 400;
  if (w >= 800) return 'Exo_800ExtraBold';
  if (w >= 700) return 'Exo_700Bold';
  if (w >= 600) return 'Exo_600SemiBold';
  if (w >= 500) return 'Exo_500Medium';
  return 'Exo_400Regular';
}

/**
 * Adds the Exo family matching the style's weight. A style that names its own
 * `fontFamily` (e.g. the monospace `code` text) is left alone.
 *
 * On Android the weight is reset too: the file already carries it, and
 * keeping it makes Android embolden an already-bold face.
 */
export function withExo(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style) || {};
  if (flat.fontFamily) return style;
  const exo: TextStyle = { fontFamily: exoFamily(flat.fontWeight) };
  if (Platform.OS === 'android') exo.fontWeight = 'normal';
  return [style, exo];
}
