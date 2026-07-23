import { useCallback } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";

/**
 * Returns a callback that asks the host to open a URL outside the view.
 *
 * @remarks
 * Requires the host `openLinks` capability; otherwise the returned promise
 * rejects before any wire traffic. The host decides how (and whether) to open
 * the link — typically in the user's browser, often behind a confirmation
 * prompt — so treat it as a request, not a guaranteed navigation. Views run
 * sandboxed and cannot navigate the user themselves; this is the supported
 * way to link out.
 *
 * The returned callback is referentially stable for the lifetime of the
 * mounted runtime.
 *
 * @example
 * ```tsx
 * function DocsLink() {
 *   const openExternal = useOpenExternal();
 *   return (
 *     <button
 *       type="button"
 *       onClick={() => {
 *         void openExternal({ url: "https://example.com/docs" });
 *       }}
 *     >
 *       Open docs
 *     </button>
 *   );
 * }
 * ```
 */
export function useOpenExternal(): (args: { url: string }) => Promise<void> {
  const runtime = useViewRuntime("useOpenExternal");
  return useCallback(
    async (args: { url: string }) => {
      await runtime.openLink({ url: args.url });
    },
    [runtime]
  );
}
