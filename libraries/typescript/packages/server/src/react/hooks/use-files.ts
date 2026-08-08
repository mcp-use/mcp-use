import { useMemo, useSyncExternalStore } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { UseFilesResult } from "../types/file-types.js";

/**
 * Upload and download files through ChatGPT's optional `window.openai`
 * extension.
 *
 * File handling is not part of the MCP Apps bridge. Always check
 * `isSupported` before calling either action; unsupported calls reject with a
 * descriptive error. The hook does not read or update ChatGPT widget state and
 * does not make uploaded files model-visible as a side effect.
 *
 * The returned actions are referentially stable for the lifetime of the
 * mounted runtime.
 *
 * @example
 * ```tsx
 * const { isSupported, upload, getDownloadUrl } = useFiles();
 *
 * if (!isSupported) return <p>File handling requires ChatGPT.</p>;
 *
 * const { fileId } = await upload(file);
 * const { downloadUrl } = await getDownloadUrl({ fileId });
 * ```
 */
export function useFiles(): UseFilesResult {
  const runtime = useViewRuntime();
  const { isSupported } = useSyncExternalStore(
    runtime.subscribeFiles,
    runtime.getFilesSnapshot
  );

  return useMemo(
    () => ({
      isSupported,
      upload: runtime.uploadFile,
      getDownloadUrl: runtime.getFileDownloadUrl,
    }),
    [runtime, isSupported]
  );
}
