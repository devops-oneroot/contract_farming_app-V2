import { useWindowDimensions } from 'react-native';

import { MaxContentWidth } from '@/constants/theme';

/**
 * The width the app's screens actually get: the window's, capped at
 * MaxContentWidth. Use this - not useWindowDimensions - for anything laid out
 * inside a screen (carousel pages, grid cells), or it overflows on tablets.
 * Full-window things such as a photo viewer in a Modal still use the window.
 */
export function useContentWidth() {
  return Math.min(useWindowDimensions().width, MaxContentWidth);
}
