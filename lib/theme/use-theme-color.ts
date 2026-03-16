import { Colors } from './colors';

/**
 * Returns the resolved color for the current theme.
 *
 * Since we lock to light mode for e-ink, the theme is always 'light'.
 * The hook signature is kept for forward-compatibility if dark mode is added later.
 */
export function useThemeColor(props: { light?: string }, colorName: keyof typeof Colors.light) {
  return props.light ?? Colors.light[colorName];
}
