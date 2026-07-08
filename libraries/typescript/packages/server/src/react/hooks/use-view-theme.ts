import { useHostContextSubscription } from "../bridge/view-bridge.js";

/**
 * Subscribe to the host color theme only.
 *
 * @remarks
 * Returns the same value as {@link useHostContext}'s `theme` and updates live
 * when the user or host switches themes. Prefer this hook when theme is all a
 * component needs: it re-renders on host context changes only, never on
 * tool-input or result updates. Returns `"light"` until the host reports a
 * theme.
 *
 * @example
 * ```tsx
 * const theme = useViewTheme();
 * ```
 */
export function useViewTheme(): "light" | "dark" {
  const hostContext = useHostContextSubscription();
  return hostContext?.theme === "dark" ? "dark" : "light";
}
