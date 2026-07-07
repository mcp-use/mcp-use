import { useViewActions } from "../bridge/view-bridge.js";

/**
 * Returns a callback that opens an external URL in the host browser.
 *
 * @example
 * ```tsx
 * function DocsLink() {
 *   const openExternal = useOpenExternal();
 *   return (
 *     <button
 *       type="button"
 *       onClick={() => openExternal({ url: "https://example.com/docs" })}
 *     >
 *       Open docs
 *     </button>
 *   );
 * }
 * ```
 */
export function useOpenExternal(): (args: { url: string }) => void {
  const { openExternal } = useViewActions();
  return openExternal;
}
