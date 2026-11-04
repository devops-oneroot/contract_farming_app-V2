/**
 * The app runs in its light theme on every phone.
 *
 * Dark mode is not finished: many cards are drawn on a fixed white background,
 * and on a phone set to dark mode their text turned white too - farmer names
 * and task titles became invisible. Until every screen takes its colours from
 * the theme, the light theme (also the one that reads best outdoors) is used
 * regardless of the system setting. To bring dark mode back, return
 * `useRNColorScheme()` here and in use-color-scheme.web.ts.
 */
export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}
