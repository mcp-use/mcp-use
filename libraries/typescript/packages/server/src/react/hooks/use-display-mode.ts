import { useViewActions } from "../bridge/view-bridge.js";
import type { DisplayMode } from "../types/host-types.js";
import { useHostContext } from "./use-host-context.js";

/**
 * Read the current display mode and request changes from the host.
 *
 * @remarks
 * `requestDisplayMode` is advisory: the host decides whether to honor it and
 * may grant a different mode or none at all. The returned promise resolves
 * once the host has processed the request — resolution does **not** mean the
 * mode changed. The single source of truth for the outcome is `displayMode`,
 * which updates reactively when the host applies a change; a denied request
 * simply leaves it unchanged. Do not store the requested mode in local state —
 * render from `displayMode` so the view also tracks mode changes the host
 * makes on its own (for example, the user exiting fullscreen).
 *
 * `displayMode` is `"inline"` until the host reports otherwise.
 *
 * @example
 * ```tsx
 * function ExpandButton() {
 *   const { displayMode, requestDisplayMode } = useDisplayMode();
 *   if (displayMode === "fullscreen") return null;
 *   return (
 *     <button
 *       type="button"
 *       onClick={() => requestDisplayMode({ mode: "fullscreen" })}
 *     >
 *       Expand
 *     </button>
 *   );
 * }
 * ```
 */
export function useDisplayMode(): {
  /** How the host is currently displaying the view; `"inline"` until the host reports otherwise. */
  displayMode: DisplayMode;
  /** Ask the host to switch display mode. Resolves when the host has processed the request; observe `displayMode` for the outcome. */
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<void>;
} {
  const { displayMode } = useHostContext();
  const { requestDisplayMode } = useViewActions();
  return { displayMode, requestDisplayMode };
}
