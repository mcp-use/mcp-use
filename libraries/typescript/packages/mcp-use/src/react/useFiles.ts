/**
 * useFiles — React hook for file upload and download in widgets.
 *
 * File operations are only supported in the ChatGPT Apps SDK environment.
 * The MCP Apps spec (SEP-1865) has deferred file handling:
 * https://github.com/modelcontextprotocol/ext-apps/issues/201
 *
 * Always check `isSupported` before calling `upload` or `getDownloadUrl`.
 *
 * ## Model visibility
 *
 * By default, uploaded files are tracked in widget state under `imageIds` so
 * ChatGPT includes them in the model's conversation context. Pass
 * `{ modelVisible: false }` to `upload()` to suppress this — the file is
 * still uploaded but the model won't see it.
 */

import { useMemo } from "react";
import type { FileMetadata } from "./widget-types.js";

export interface UploadOptions {
  /**
   * Whether the uploaded file should be visible to the model.
   *
   * When `true` (default), the `fileId` is appended to `imageIds` in widget
   * state so the ChatGPT host includes the file in the model's conversation
   * context on future turns.
   *
   * When `false`, the file is uploaded but not tracked in `imageIds` — the
   * model will not see it. Useful for files used only by the widget (e.g.
   * a user-provided config file or a privately-processed image).
   *
   * @default true
   */
  modelVisible?: boolean;
}

export interface UseFilesResult {
  /**
   * Whether the host supports file operations.
   *
   * `true` only in the ChatGPT Apps SDK environment where
   * `window.openai.uploadFile` and `window.openai.getFileDownloadUrl`
   * are available. Always check this flag before calling `upload` or
   * `getDownloadUrl`.
   */
  isSupported: boolean;

  /**
   * Upload a file to the host.
   *
   * Returns a `{ fileId }` reference that can be passed to `getDownloadUrl`
   * or stored in widget state for later retrieval.
   *
   * By default the file is tracked in widget state (`imageIds`) so the model
   * can see it. Pass `{ modelVisible: false }` to upload privately.
   *
   * @throws If called when `isSupported` is `false`.
   */
  upload: (file: File, options?: UploadOptions) => Promise<FileMetadata>;

  /**
   * Get a temporary download URL for a previously uploaded file.
   *
   * The returned URL is valid for a limited time (typically 5 minutes).
   * Do not store the URL — call `getDownloadUrl` again when you need to
   * display or fetch the file.
   *
   * @throws If called when `isSupported` is `false`.
   */
  getDownloadUrl: (file: FileMetadata) => Promise<{ downloadUrl: string }>;
}

/**
 * Hook for file upload and download operations in widgets.
 *
 * File operations are **only available in the ChatGPT Apps SDK** environment.
 * Always guard usage with the `isSupported` flag:
 *
 * ```tsx
 * const { upload, getDownloadUrl, isSupported } = useFiles();
 *
 * if (!isSupported) {
 *   return <p>File operations are not available in this host.</p>;
 * }
 *
 * // Upload (model-visible by default)
 * const { fileId } = await upload(file);
 *
 * // Upload privately (model won't see it)
 * const { fileId } = await upload(file, { modelVisible: false });
 *
 * const { downloadUrl } = await getDownloadUrl({ fileId });
 * ```
 */
export function useFiles(): UseFilesResult {
  const isSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      typeof (window.openai as any)?.uploadFile === "function" &&
      typeof (window.openai as any)?.getFileDownloadUrl === "function"
    );
  }, []);

  const upload = useMemo(
    () =>
      async (
        file: File,
        options: UploadOptions = {}
      ): Promise<FileMetadata> => {
        if (!isSupported) {
          throw new Error(
            "[useFiles] File upload is not supported in this host. " +
              "Check `isSupported` before calling `upload`. " +
              "File operations are only available in the ChatGPT Apps SDK environment."
          );
        }

        const metadata = await ((window.openai as any).uploadFile(
          file
        ) as Promise<FileMetadata>);

        // Track in imageIds so the model can see the file, unless opted out.
        // Preserves existing privateContent to avoid wiping non-file widget state.
        const { modelVisible = true } = options;
        if (modelVisible && window.openai?.setWidgetState) {
          const prev = (window.openai.widgetState ?? {}) as Record<
            string,
            unknown
          >;
          const imageIds = [
            ...((prev.imageIds as string[] | undefined) ?? []),
            metadata.fileId,
          ];
          window.openai
            .setWidgetState({ ...prev, imageIds } as any)
            .catch((err: unknown) => {
              console.warn("[useFiles] Failed to track imageId:", err);
            });
        }

        return metadata;
      },
    [isSupported]
  );

  const getDownloadUrl = useMemo(
    () =>
      async (file: FileMetadata): Promise<{ downloadUrl: string }> => {
        if (!isSupported) {
          throw new Error(
            "[useFiles] File download is not supported in this host. " +
              "Check `isSupported` before calling `getDownloadUrl`. " +
              "File operations are only available in the ChatGPT Apps SDK environment."
          );
        }
        return (window.openai as any).getFileDownloadUrl(file) as Promise<{
          downloadUrl: string;
        }>;
      },
    [isSupported]
  );

  return { isSupported, upload, getDownloadUrl };
}
