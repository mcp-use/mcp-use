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
 * `availableDisplayModes` is the negotiated intersection of
 * `viewConfig.displayModes` and `hostContext.availableDisplayModes`. When the
 * host omits available modes, only `"inline"` is requestable.
 * `requestDisplayMode` rejects modes outside that intersection before sending;
 * the method itself is runtime-owned and referentially stable.
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
 *       onClick={() => {
 *         void requestDisplayMode({ mode: "fullscreen" });
 *       }}
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
  /**
   * Negotiated modes: intersection of `viewConfig.displayModes` and host
   * `availableDisplayModes` (host omits → only `"inline"`).
   */
  availableDisplayModes: readonly DisplayMode[];
  /**
   * Ask the host to switch display mode. Rejects when the mode is outside the
   * negotiated intersection. Resolves when the host has processed the request;
   * observe `displayMode` for the outcome.
   */
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<void>;
} {
  const runtime = useViewRuntime("useDisplayMode");
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
