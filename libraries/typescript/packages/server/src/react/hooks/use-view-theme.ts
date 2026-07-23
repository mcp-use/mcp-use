import { useSyncExternalStore } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";

/**
 * Subscribe to the host color theme only.
 *
 * @remarks
 * Returns the same value as {@link useHostContext}'s `theme` and updates live
 * when the user or host switches themes. Prefer this hook when theme is all a
 * component needs: it re-renders only when the resolved theme string changes,
 * never on locale, dimensions, display mode, or tool updates. Returns
 * `"light"` until the host reports a theme.
 *
 * @example
 * ```tsx
 * const theme = useViewTheme();
 * ```
 */
export function useViewTheme(): "light" | "dark" {
  const runtime = useViewRuntime("useViewTheme");
  return useSyncExternalStore(runtime.subscribeTheme, runtime.getThemeSnapshot);
}
