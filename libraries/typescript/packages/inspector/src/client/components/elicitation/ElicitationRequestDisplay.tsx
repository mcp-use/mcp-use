import { Button } from "@/client/components/ui/button";
import type { ElicitResult } from "@modelcontextprotocol/client";
import type { PendingElicitationRequest } from "@/client/types/pending-requests";
import { JSONDisplay } from "@/client/components/shared/JSONDisplay";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  Maximize2,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { Badge } from "@/client/components/ui/badge";
import { ElicitationAskUserPanel } from "./shared/ElicitationAskUserPanel";

interface ElicitationRequestDisplayProps {
  request: PendingElicitationRequest | null;
  onApprove: (requestId: string, result: ElicitResult) => void;
  onReject: (requestId: string, error?: string) => void;
  onClose: () => void;
  previewMode: boolean;
  onTogglePreview: () => void;
  isCopied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onFullscreen: () => void;
}

function showElicitationSuccessToast() {
  import("react").then((React) => {
    const toastId = toast(
      React.createElement(
        "div",
        { className: "space-y-3" },
        React.createElement(
          "div",
          null,
          React.createElement("strong", null, "Elicitation Response Sent"),
          React.createElement(
            "p",
            { className: "text-sm text-muted-foreground mt-1" },
            "The tool will continue executing."
          )
        ),
        React.createElement(
          "div",
          { className: "flex gap-2" },
          React.createElement(
            "button",
            {
              "data-testid": "elicitation-view-tool-result",
              className:
                "px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90",
              onClick: () => {
                const event = new globalThis.CustomEvent(
                  "navigate-to-tool-result",
                  {
                    detail: { toolName: null },
                  }
                );
                window.dispatchEvent(event);
                toast.dismiss(toastId);
              },
            },
            "View Tool Result"
          )
        )
      ),
      {
        duration: 5000,
      }
    );
  });
}

export function ElicitationRequestDisplay({
  request,
  onApprove,
  onReject,
  onClose,
  previewMode: _previewMode,
  onTogglePreview: _onTogglePreview,
  isCopied,
  onCopy,
  onDownload,
  onFullscreen,
}: ElicitationRequestDisplayProps) {
  const handleApprove = (requestId: string, result: ElicitResult) => {
    onApprove(requestId, result);
    onClose();
    if (result.action === "accept" || result.action === "decline") {
      showElicitationSuccessToast();
    }
  };

  const handleDecline = () => {
    if (!request) return;
    handleApprove(request.id, { action: "decline" });
  };

  const handleCancel = () => {
    if (!request) return;
    onReject(request.id, "User cancelled elicitation request");
    onClose();
  };

  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400">
          Select an elicitation request to view details
        </p>
      </div>
    );
  }

  const mode = request.request.mode || "form";
  const isUrlMode = mode === "url";
  const isFormMode = mode === "form";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">
            {request.serverName}
          </h3>
          <Badge
            variant="outline"
            className={
              isUrlMode
                ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/50"
                : "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/50"
            }
          >
            {mode}
          </Badge>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(request.timestamp).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCopy}
                className="h-8 w-8 p-0"
              >
                {isCopied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy request</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDownload}
                className="h-8 w-8 p-0"
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download request</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onFullscreen}
                className="h-8 w-8 p-0"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fullscreen</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <ElicitationAskUserPanel
          request={request}
          onApprove={handleApprove}
          onReject={onReject}
          testId="elicitation-ask-user"
          actionTestIdPrefix="elicitation"
          showSecondaryActions={false}
        />

        {isFormMode &&
          "requestedSchema" in request.request &&
          request.request.requestedSchema && (
            <details className="space-y-2">
              <summary className="text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer">
                Schema (for reference)
              </summary>
              <div className="bg-muted rounded-lg p-3 max-h-64 overflow-auto">
                <JSONDisplay data={request.request.requestedSchema} />
              </div>
            </details>
          )}
      </div>

      {/* Actions Footer */}
      <div className="flex gap-2 p-4 border-t dark:border-zinc-700">
        <Button
          onClick={handleDecline}
          variant="outline"
          className="flex-1"
          data-testid="elicitation-decline-button"
        >
          Decline
        </Button>
        <Button
          onClick={handleCancel}
          variant="outline"
          className="flex-1"
          data-testid="elicitation-cancel-button"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
