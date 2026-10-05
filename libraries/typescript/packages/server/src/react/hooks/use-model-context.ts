import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type {
  ModelContextAttachment,
  ModelContextHandle,
} from "../types/model-context.js";

/**
 * Manage native model context through the view's shared, single writer.
 *
 * Export `viewConfig = { modelContext: "attachments" }` before rendering.
 * This explicit migration uses standard context delivery and assistant-only
 * background projection; it does not replace private widget persistence.
 * Attachment keys are shared across all hook instances. Unmounting a consumer
 * does not clear selections. Exact duplicate blocks under different keys reject.
 *
 * Calls await initialization and negotiate support internally. Successful calls
 * acknowledge context delivery, not composer rendering. Host removals update
 * the selection where unambiguous. Uncertain writes or host ordering pause
 * publication: ordinary retry cannot resolve those conflicts.
 *
 * Keep removable evidence out of duplicate view state or description fields.
 * Audience annotations affect presentation, not access by the model.
 *
 * @returns Shared attachments, pending/error, and stable mutation methods.
 */
export function useModelContext(): ModelContextHandle {
  const store = useViewRuntime().modelContextStore;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.prepare().catch(() => {});
  }, [store]);
  return useMemo(
    () => ({
      ...snapshot,
      attachments: snapshot.attachments as readonly ModelContextAttachment[],
      add: store.add,
      remove: store.remove,
      clearAttachments: store.clearSelection,
      retry: store.retryContext,
    }),
    [snapshot, store]
  );
}
