import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height of the on-screen keyboard, or 0 when it is closed.
 *
 * Android runs edge-to-edge from SDK 54, so `adjustResize` no longer shrinks the
 * window when the keyboard opens — it simply draws over the bottom of the screen,
 * and `KeyboardAvoidingView` with no behaviour does nothing. A form whose last
 * field sits near the bottom is then unreachable: there is no extra content to
 * scroll to, so scrolling cannot help either.
 *
 * Add this to a scroll view's bottom padding to make that space real.
 */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // `will*` fires before the animation on iOS, so the layout moves with the
    // keyboard rather than after it. Android only has the `did*` pair.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
