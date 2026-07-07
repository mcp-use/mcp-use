import { useViewActions } from "../bridge/view-bridge.js";
import type { DisplayMode } from "../types/host-types.js";
import { useHostContext } from "./use-host-context.js";

/**
 * Read the current display mode and request changes from the host.
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
  displayMode: DisplayMode;
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<void>;
} {
  const { displayMode } = useHostContext();
  const { requestDisplayMode } = useViewActions();
  return { displayMode, requestDisplayMode };
}
