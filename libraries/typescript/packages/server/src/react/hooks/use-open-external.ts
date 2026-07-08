import { useViewActions } from "../bridge/view-bridge.js";

/**
 * Returns a callback that asks the host to open a URL outside the view.
 *
 * @remarks
 * Fire-and-forget: the callback returns immediately and reports nothing back.
 * The host decides how (and whether) to open the link — typically in the
 * user's browser, often behind a confirmation prompt — so treat it as a
 * request, not a guaranteed navigation. Views run sandboxed and cannot
 * navigate the user themselves; this is the supported way to link out.
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
