import { useSyncExternalStore } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { DisplayMode } from "../types/host-types.js";

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
 * `availableDisplayModes` is the view's declared modes from `viewConfig`
 * (Phase 9 intersects with host-reported modes).
 * `requestDisplayMode` is the runtime-owned method — referentially stable.
 *
 * @example
 * ```tsx
 * function ExpandButton() {
 *   const { displayMode, availableDisplayModes, requestDisplayMode } =
 *     useDisplayMode();
 *   if (!availableDisplayModes.includes("fullscreen")) return null;
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
  /** Modes this view declared via `viewConfig.displayModes` (host intersection lands in Phase 9). */
  availableDisplayModes: readonly DisplayMode[];
  /** Ask the host to switch display mode. Resolves when the host has processed the request; observe `displayMode` for the outcome. */
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<void>;
} {
  const runtime = useViewRuntime();
  const { displayMode, availableDisplayModes } = useSyncExternalStore(
    runtime.subscribeDisplay,
    runtime.getDisplaySnapshot
  );
  return {
    displayMode,
    availableDisplayModes,
    requestDisplayMode: runtime.requestDisplayMode,
  };
}
