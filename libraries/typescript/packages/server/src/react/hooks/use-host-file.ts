import { useMemo, useSyncExternalStore } from "react";
import { HostFileSession } from "../runtime/host-file-store.js";
import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { HostFileHandle, HostFileOptions } from "../types/host-file.js";

/**
 * Read and edit the file that opened this View through the existing App connection.
 *
 * Requires the host's `openai/resource` experimental capability and complete
 * file-entrypoint input. Partial or later ambient input cannot authorize access.
 * The URI is opaque; this hook accepts no resource or filesystem path argument.
 *
 * Writes require explicit `ifMatch`. Keep a draft's base ETag separately from
 * subscription updates. On conflict, retain the draft and refresh to reconcile.
 * Subscription errors do not prevent manual refreshes. ChatGPT currently
 * supports this extension on desktop only.
 *
 * @param options - Optional representation and subscription preference.
 * @returns Opening-file contents, status, and guarded actions for this lifetime.
 */
export function useHostFile(options: HostFileOptions = {}): HostFileHandle {
  const runtime = useViewRuntime();
  const session = useMemo(
    () =>
      new HostFileSession(runtime.hostFileStore, {
        ...(options.representation !== undefined && {
          representation: options.representation,
        }),
        subscribe: options.subscribe ?? true,
      }),
    [runtime, options.representation, options.subscribe]
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );
  return useMemo(
    () => ({ ...snapshot, refresh: session.refresh, write: session.write }),
    [snapshot, session]
  );
}
