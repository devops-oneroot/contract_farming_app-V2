import type { Ref } from 'react';
import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';

import { withExo } from '@/constants/fonts';

/**
 * Drop-in `Text` / `TextInput` in the app's Exo typeface. Screens import these
 * instead of React Native's, since React Native has no app-wide default font.
 * `ref` passes straight through (a plain prop in React 19).
 */
export function Text({ style, ...rest }: TextProps & { ref?: Ref<RNText> }) {
  return <RNText style={withExo(style)} {...rest} />;
}

export function TextInput({ style, ...rest }: TextInputProps & { ref?: Ref<RNTextInput> }) {
  return <RNTextInput style={withExo(style)} {...rest} />;
}
