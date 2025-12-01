import { useState, useMemo } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";
import type { PendingSamplingRequest } from "@/client/types/sampling";
import { JSONDisplay } from "@/client/components/shared/JSONDisplay";
import { toast } from "sonner";
import { Check, Copy, Download, Maximize2, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";

interface SamplingRequestDisplayProps {
  request: PendingSamplingRequest | null;
  onApprove: (requestId: string, result: CreateMessageResult) => void;
  onReject: (requestId: string, error?: string) => void;
  onClose: () => void;
  previewMode: boolean;
  onTogglePreview: () => void;
  isCopied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onFullscreen: () => void;
}

export function SamplingRequestDisplay({
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
}: SamplingRequestDisplayProps) {
  const [model, setModel] = useState("stub-model");
  const [stopReason, setStopReason] = useState("endTurn");
  const [role, setRole] = useState<"assistant" | "user">("assistant");
  const [contentType, setContentType] = useState<"text" | "image">("text");
  const [textContent, setTextContent] = useState("positive"); // Default sentiment response
  const [imageData, setImageData] = useState("");
  const [imageMimeType, setImageMimeType] = useState("image/png");

  const messageResult = useMemo(() => {
    const result: any = {
      model,
      stopReason,
      role,
      content: {
        type: contentType,
      },
    };

    if (contentType === "text") {
      result.content.text = textContent;
    } else if (contentType === "image") {
      result.content.data = imageData;
      result.content.mimeType = imageMimeType;
    }

    return result;
  }, [model, stopReason, role, contentType, textContent, imageData, imageMimeType]);

  const handleApprove = () => {
    if (!request) return;
    
    const validationResult = CreateMessageResultSchema.safeParse(messageResult);
    if (!validationResult.success) {
      toast.error("Invalid response", {
        description: `Validation failed: ${validationResult.error.message}`,
      });
      return;
    }

    onApprove(request.id, validationResult.data);
    onClose();
    
    // Show success toast with navigation back to tools tab
    // Use the same button styling as the approve/deny toast
    import("react").then((React) => {
      const toastId = toast(
        React.createElement(
          "div",
          { className: "space-y-3" },
          React.createElement(
            "div",
            null,
            React.createElement("strong", null, "Sampling Response Sent"),
            React.createElement("p", { className: "text-sm text-muted-foreground mt-1" }, "The tool will continue executing.")
          ),
          React.createElement(
            "div",
            { className: "flex gap-2" },
            React.createElement(
              "button",
              {
                className: "px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90",
                onClick: () => {
                  // Dispatch event to navigate to tools tab
                  const event = new globalThis.CustomEvent("navigate-to-tool-result", {
                    detail: { toolName: request.toolName },
                  });
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

  const handleReject = () => {
    if (!request) return;
    onReject(request.id, "User rejected sampling request");
    onClose();
  };

  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400">
          Select a sampling request to view details
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
        {/* Request Section */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Request
          </h4>
          <div className="bg-muted rounded-lg p-3 max-h-64 overflow-auto">
            <JSONDisplay data={request.request} />
          </div>
        </div>

        {/* Response Form Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Response
          </h4>
          
          <div className="space-y-2">
            <Label htmlFor={`model-${request.id}`}>Model</Label>
            <Input
              id={`model-${request.id}`}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="stub-model"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`stopReason-${request.id}`}>Stop Reason</Label>
            <Input
              id={`stopReason-${request.id}`}
              value={stopReason}
              onChange={(e) => setStopReason(e.target.value)}
              placeholder="endTurn"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`role-${request.id}`}>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "assistant" | "user")}>
              <SelectTrigger id={`role-${request.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="assistant">assistant</SelectItem>
                <SelectItem value="user">user</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`contentType-${request.id}`}>Content Type</Label>
            <Select value={contentType} onValueChange={(v) => setContentType(v as "text" | "image")}>
              <SelectTrigger id={`contentType-${request.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">text</SelectItem>
                <SelectItem value="image">image</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {contentType === "text" && (
            <div className="space-y-2">
              <Label htmlFor={`text-${request.id}`}>Text Content</Label>
              <Textarea
                id={`text-${request.id}`}
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Enter response text..."
                rows={6}
              />
            </div>
          )}

          {contentType === "image" && (
            <>
              <div className="space-y-2">
                <Label htmlFor={`imageData-${request.id}`}>Base64 Image Data</Label>
                <Textarea
                  id={`imageData-${request.id}`}
                  value={imageData}
                  onChange={(e) => setImageData(e.target.value)}
                  placeholder="Base64 encoded image data..."
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`mimeType-${request.id}`}>MIME Type</Label>
                <Input
                  id={`mimeType-${request.id}`}
                  value={imageMimeType}
                  onChange={(e) => setImageMimeType(e.target.value)}
                  placeholder="image/png"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Actions Footer */}
      <div className="flex gap-2 p-4 border-t dark:border-zinc-700">
        <Button onClick={handleApprove} className="flex-1">
          Approve
        </Button>
        <Button onClick={handleReject} variant="outline" className="flex-1">
          Reject
        </Button>
      </div>
    </div>
  );
}

