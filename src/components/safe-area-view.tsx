import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { type Edge, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Breathing room below the status bar / notch on every screen, so a title or
 * the first card never sits right under the clock. Change it here, not per screen.
 */
export const TOP_GAP = 10;

type Props = ViewProps & { edges?: readonly Edge[] };

/** A style's own padding on one side, however it was written. */
function padOf(style: ViewStyle, side: 'Top' | 'Bottom' | 'Left' | 'Right') {
  const axis = side === 'Top' || side === 'Bottom' ? style.paddingVertical : style.paddingHorizontal;
  const v = style[`padding${side}`] ?? axis ?? style.padding ?? 0;
  return typeof v === 'number' ? v : 0;
}

/**
 * The app's SafeAreaView: react-native-safe-area-context's, plus TOP_GAP under
 * the top inset. Same props - `edges` defaults to all four - and the insets
 * are added to whatever padding the screen sets, as the library's does.
 */
export function SafeAreaView({ edges, style, ...rest }: Props) {
  const insets = useSafeAreaInsets();
  const on = (e: Edge) => !edges || edges.includes(e);
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  return (
    <View
      style={[
        style,
        on('top') && { paddingTop: insets.top + TOP_GAP + padOf(flat, 'Top') },
        on('bottom') && { paddingBottom: insets.bottom + padOf(flat, 'Bottom') },
        on('left') && { paddingLeft: insets.left + padOf(flat, 'Left') },
        on('right') && { paddingRight: insets.right + padOf(flat, 'Right') },
      ]}
      {...rest}
    />
  );
}
