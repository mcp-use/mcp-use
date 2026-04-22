import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Checkbox } from "@/client/components/ui/checkbox";
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import type { PendingElicitationRequest } from "@/client/types/elicitation";
import { JSONDisplay } from "@/client/components/shared/JSONDisplay";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  Maximize2,
  X,
  ExternalLink,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { Badge } from "@/client/components/ui/badge";
import { ElicitationFormFields, useElicitationForm } from "./shared";

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
  const {
    formData,
    setFieldValue,
    getMissingRequiredFields,
    urlCompleted,
    setUrlCompleted,
    mode,
    isFormMode,
    isUrlMode,
  } = useElicitationForm(request);

  const handleAccept = () => {
    if (!request) return;

    if (isFormMode) {
      const missingFields = getMissingRequiredFields();
      if (missingFields.length > 0) {
        toast.error("Missing required fields", {
          description: `Please fill in: ${missingFields.join(", ")}`,
        });
        return;
      }

      onApprove(request.id, {
        action: "accept",
        content: formData,
      });
    } else if (isUrlMode) {
      onApprove(request.id, {
        action: "accept",
      });
    }
    onClose();

    // Show success toast with navigation back to tools tab
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
                  // Dispatch event to navigate to tools tab
                  const event = new globalThis.CustomEvent(
                    "navigate-to-tool-result",
                    {
                      detail: { toolName: null },
                    }
                  );
                  window.dispatchEvent(event);
                  // Dismiss the toast immediately
                  toast.dismiss(toastId);
                },
              },
              "View Tool Result"
            )
          )
        ),
        {
          duration: 5000, // Auto-dismiss after 5 seconds
        }
      );
    });
  };

  const handleDecline = () => {
    if (!request) return;
    onApprove(request.id, { action: "decline" });
    onClose();
  };

  const handleCancel = () => {
    if (!request) return;
    onReject(request.id, "User cancelled elicitation request");
    onClose();
  };

  const handleOpenUrl = () => {
    if (request && isUrlMode && "url" in request.request) {
      window.open(request.request.url, "_blank");
      setUrlCompleted(true);
    }
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
        {/* Message Section */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Message
          </h4>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {request.request.message}
          </p>
        </div>

        {/* URL Mode Display */}
        {isUrlMode && "url" in request.request && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              External Action Required
            </h4>
            <div className="bg-muted rounded-lg p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                This request requires you to complete an action at an external
                URL:
              </p>
              <div className="flex items-center gap-2 p-2 bg-background rounded border">
                <code className="flex-1 text-xs font-mono break-all">
                  {request.request.url}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenUrl}
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open URL
                </Button>
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Checkbox
                  id="url-completed"
                  checked={urlCompleted}
                  onCheckedChange={(checked) => setUrlCompleted(!!checked)}
                />
                <Label
                  htmlFor="url-completed"
                  className="text-sm font-normal cursor-pointer"
                >
                  I have completed the required action
                </Label>
              </div>
            </div>
          </div>
        )}

        {/* Form Mode Display */}
        {isFormMode && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Form Data
            </h4>
            <ElicitationFormFields
              request={request}
              formData={formData}
              onFieldChange={setFieldValue}
              idPrefix="field"
              testIdPrefix="elicitation-field"
              emptyFallback={
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  No form schema available
                </div>
              }
            />
          </div>
        )}

        {/* Schema Display (for debugging/reference) */}
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
          onClick={handleAccept}
          className="flex-1"
          data-testid="elicitation-accept-button"
        >
          Accept
        </Button>
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
