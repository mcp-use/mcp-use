import {
  McpUseProvider,
  useFiles,
  useWidget,
  type WidgetMetadata,
} from "mcp-use/react";
import React, { useRef, useState } from "react";
import { z } from "zod";

export const widgetMetadata: WidgetMetadata = {
  description:
    "File manager demonstrating useFiles() with isSupported detection, upload, and download",
  props: z.object({}),
  metadata: {
    prefersBorder: true,
    autoResize: true,
  },
};

type UploadedFile = {
  fileId: string;
  name: string;
  size: number;
  downloadUrl: string | null;
};

const FileManager: React.FC = () => {
  const { isPending, theme } = useWidget();
  const { upload, getDownloadUrl, isSupported } = useFiles();
  const isDark = theme === "dark";

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadingDownloadId, setLoadingDownloadId] = useState<string | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const { fileId } = await upload(file);
      setUploadedFiles((prev) => [
        ...prev,
        { fileId, name: file.name, size: file.size, downloadUrl: null },
      ]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
      // Reset input so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleGetDownloadUrl(fileId: string) {
    setLoadingDownloadId(fileId);
    try {
      const { downloadUrl } = await getDownloadUrl({ fileId });
      setUploadedFiles((prev) =>
        prev.map((f) => (f.fileId === fileId ? { ...f, downloadUrl } : f))
      );
    } catch (err) {
      console.error("Failed to get download URL:", err);
    } finally {
      setLoadingDownloadId(null);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const bg = isDark ? "bg-gray-900 text-white" : "bg-white text-gray-900";
  const border = isDark ? "border-gray-700" : "border-gray-200";
  const subtle = isDark ? "text-gray-400" : "text-gray-500";
  const cardBg = isDark ? "bg-gray-800" : "bg-gray-50";

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className={`p-8 rounded-2xl ${bg}`}>
          <div className="animate-pulse space-y-3">
            <div
              className={`h-6 w-32 rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            />
            <div
              className={`h-4 w-full rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            />
          </div>
        </div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <div className={`rounded-2xl overflow-hidden ${bg}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b ${border}`}>
          <h2 className="text-lg font-semibold">File Manager</h2>
          <p className={`text-sm mt-0.5 ${subtle}`}>
            Upload files and retrieve download links
          </p>
        </div>

        <div className="p-4 space-y-4">
          {/* Not supported notice */}
          {!isSupported && (
            <div
              className={`rounded-xl p-4 border ${
                isDark
                  ? "bg-amber-900/20 border-amber-700 text-amber-300"
                  : "bg-amber-50 border-amber-200 text-amber-800"
              }`}
            >
              <div className="font-medium text-sm mb-1">
                File operations not available
              </div>
              <p className="text-xs leading-relaxed">
                File upload and download are only supported in the ChatGPT Apps
                SDK environment. The MCP Apps specification ({" "}
                <span className="font-mono">SEP-1865</span>) has deferred file
                handling. This widget is running in an MCP Apps client where
                files are not yet supported.
              </p>
            </div>
          )}

          {/* Upload area — only shown when supported */}
          {isSupported && (
            <div>
              <label
                className={`flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                  isDark
                    ? "border-gray-600 hover:border-blue-500 hover:bg-blue-900/10"
                    : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                } ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
                {isUploading ? (
                  <>
                    <div
                      className={`animate-spin rounded-full h-6 w-6 border-b-2 ${
                        isDark ? "border-blue-400" : "border-blue-600"
                      }`}
                    />
                    <span className={`text-sm ${subtle}`}>Uploading…</span>
                  </>
                ) : (
                  <>
                    <svg
                      className={`h-8 w-8 ${subtle}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                      />
                    </svg>
                    <span className="text-sm font-medium">
                      Click to upload a file
                    </span>
                    <span className={`text-xs ${subtle}`}>Any file type</span>
                  </>
                )}
              </label>

              {uploadError && (
                <p className="mt-2 text-xs text-red-500">{uploadError}</p>
              )}
            </div>
          )}

          {/* Uploaded files list */}
          {uploadedFiles.length > 0 && (
            <div className="space-y-2">
              <h3 className={`text-sm font-medium ${subtle}`}>
                Uploaded files
              </h3>
              {uploadedFiles.map((file) => (
                <div
                  key={file.fileId}
                  className={`rounded-xl p-3 ${cardBg} border ${border}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {file.name}
                      </div>
                      <div className={`text-xs mt-0.5 ${subtle}`}>
                        {formatSize(file.size)} · ID: {file.fileId.slice(0, 20)}
                        …
                      </div>
                    </div>

                    {file.downloadUrl ? (
                      <a
                        href={file.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs font-medium text-blue-500 hover:text-blue-600"
                      >
                        Open ↗
                      </a>
                    ) : (
                      <button
                        onClick={() => handleGetDownloadUrl(file.fileId)}
                        disabled={loadingDownloadId === file.fileId}
                        className={`shrink-0 text-xs font-medium ${
                          isDark
                            ? "text-blue-400 hover:text-blue-300"
                            : "text-blue-600 hover:text-blue-700"
                        } disabled:opacity-50`}
                      >
                        {loadingDownloadId === file.fileId
                          ? "Getting URL…"
                          : "Get download URL"}
                      </button>
                    )}
                  </div>

                  {file.downloadUrl && (
                    <div
                      className={`mt-2 text-xs font-mono truncate ${subtle} p-1.5 rounded ${
                        isDark ? "bg-gray-900" : "bg-white"
                      } border ${border}`}
                    >
                      {file.downloadUrl}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {isSupported && uploadedFiles.length === 0 && !isUploading && (
            <p className={`text-center text-sm ${subtle}`}>
              No files uploaded yet
            </p>
          )}
        </div>
      </div>
    </McpUseProvider>
  );
};

export default FileManager;
