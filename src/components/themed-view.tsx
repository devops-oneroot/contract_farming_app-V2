import { View, type ViewProps } from 'react-native';

import { CardShadow, Radius, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

/**
 * `type="card"` is the app's one raised surface: the card colour, the shared
 * shadow and the shared corner, so every card on every screen matches. The
 * screen's own style still wins for padding, layout and any radius it sets.
 */
export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        { backgroundColor: theme[type ?? 'background'] },
        type === 'card' && { borderRadius: Radius.lg, ...CardShadow },
        style,
      ]}
      {...otherProps}
    />
  );
}
