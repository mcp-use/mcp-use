import { useHostContextSubscription } from "../bridge/view-bridge.js";

/**
 * Dedicated host-theme subscription without re-rendering on tool-data or other
 * host-context channels.
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
