import type {
  CreateMessageRequest,
  McpUiDownloadFileRequest,
  McpUiDownloadFileResult,
} from "@mcp-use/client/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { RequestActionToast } from "@/client/components/shared/RequestActionToast";
import { useSamplingLLM } from "@/client/components/sampling/useSamplingLLM";
import type { LLMConfig } from "@/client/components/chat/types";

function filenameFromUri(uri: string): string {
  let candidate = uri;
  try {
    candidate = new URL(uri).pathname;
  } catch {
    // Non-HTTP MCP resource URIs are still valid filename sources.
  }
  const lastSegment = candidate.split("/").filter(Boolean).at(-1) ?? "download";
  let decodedSegment = lastSegment;
  try {
    decodedSegment = decodeURIComponent(lastSegment);
  } catch {
    // Keep the literal segment when it contains malformed percent escapes.
  }
  return (
    decodedSegment
      .replace(/[/\\?%*:|"<>]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 180) || "download"
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadContents(
  contents: McpUiDownloadFileRequest["params"]["contents"]
): Promise<void> {
  for (const item of contents) {
    if (item.type === "resource") {
      const resource = item.resource;
      const mimeType = resource.mimeType ?? "application/octet-stream";
      const blob =
        "blob" in resource
          ? new Blob(
              [
                Uint8Array.from(atob(resource.blob), (char) =>
                  char.charCodeAt(0)
                ),
              ],
              { type: mimeType }
            )
          : new Blob([resource.text], { type: mimeType });
      downloadBlob(blob, filenameFromUri(resource.uri));
      continue;
    }

    const response = await fetch(item.uri);
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    downloadBlob(await response.blob(), filenameFromUri(item.uri));
  }
}

export function useMcpAppsHostActions(llmConfig: LLMConfig | null | undefined) {
  const { generateResponse, isAvailable } = useSamplingLLM({
    llmConfig: llmConfig ?? null,
  });

  const onSamplingRequest = useCallback(
    (params: CreateMessageRequest["params"]) =>
      new Promise<Awaited<ReturnType<typeof generateResponse>>>(
        (resolve, reject) => {
          const toastId = toast(
            <RequestActionToast
              title="MCP App sampling request"
              description="This app wants to generate a model response."
              actions={[
                {
                  label: "Approve",
                  testId: "mcp-app-sampling-approve",
                  onClick: () => {
                    toast.dismiss(toastId);
                    void generateResponse({
                      request: { method: "sampling/createMessage", params },
                    }).then(resolve, reject);
                  },
                },
                {
                  label: "Deny",
                  testId: "mcp-app-sampling-deny",
                  onClick: () => {
                    toast.dismiss(toastId);
                    reject(new Error("User denied the sampling request"));
                  },
                },
              ]}
            />,
            { duration: Infinity }
          );
        }
      ),
    [generateResponse]
  );

  const onDownloadFile = useCallback(
    (params: McpUiDownloadFileRequest["params"]) =>
      new Promise<McpUiDownloadFileResult>((resolve, reject) => {
        const toastId = toast(
          <RequestActionToast
            title="MCP App download request"
            description={`Download ${params.contents.length} file${params.contents.length === 1 ? "" : "s"}?`}
            actions={[
              {
                label: "Download",
                testId: "mcp-app-download-confirm",
                onClick: () => {
                  toast.dismiss(toastId);
                  void downloadContents(params.contents)
                    .then(() => resolve({}))
                    .catch(reject);
                },
              },
              {
                label: "Deny",
                testId: "mcp-app-download-deny",
                onClick: () => {
                  toast.dismiss(toastId);
                  reject(new Error("User denied the download request"));
                },
              },
            ]}
          />,
          { duration: Infinity }
        );
      }),
    []
  );

  return {
    onSamplingRequest: isAvailable ? onSamplingRequest : undefined,
    onDownloadFile,
  };
}
