import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type {
  ModelContextAttachment,
  ModelContextHandle,
} from "../types/model-context.js";

/**
 * Manage native model context through the view's shared, single writer.
 *
 * Mounting this hook activates native context delivery for the runtime; no
 * view configuration is needed. Legacy-only views retain their transport.
 * Existing model-visible widget persistence prevents an unsafe handoff and
 * surfaces an error; the SDK never silently clears that state.
 * Attachment keys are shared across all hook instances. Unmounting a consumer
 * does not clear selections. Exact duplicate blocks under different keys reject.
 *
 * Image src inputs resolve like Image public assets and are fetched before
 * replacing the selection; direct data plus mimeType remains supported.
 * Text thumbnail src uses the same resolver and remains a URL. Later same-key
 * actions or clear cancel image preparation and settle it as superseded.
 * Calls await initialization and negotiate support internally. Successful calls
 * acknowledge context delivery, not composer rendering. Host removals update
 * the selection where unambiguous. Uncertain writes or host ordering pause
 * publication until a fresh runtime can initialize after outstanding writes stop.
 * Definite failed writes retain the requested selection and reject. The next
 * valid mutation makes one fresh attempt; background updates do not retry.
 *
 * Keep removable evidence out of duplicate view state or description fields.
 * Audience annotations affect presentation, not access by the model.
 *
 * @returns Shared attachments, pending/error, and stable mutation methods.
 */
export function useModelContext(): ModelContextHandle {
  const store = useViewRuntime().modelContextStore;
  useLayoutEffect(() => {
    store.activateAttachments();
  }, [store]);
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
    }),
    [snapshot, store]
  );
}
