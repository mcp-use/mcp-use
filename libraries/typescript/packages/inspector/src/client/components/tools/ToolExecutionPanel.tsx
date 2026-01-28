import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Code,
  Copy,
  Play,
  Save,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { JSONDisplay } from "../shared/JSONDisplay";
import { ToolInputForm } from "./ToolInputForm";

interface ToolExecutionPanelProps {
  selectedTool: Tool | null;
  toolArgs: Record<string, unknown>;
  isExecuting: boolean;
  isConnected: boolean;
  onArgChange: (key: string, value: string) => void;
  onExecute: () => void;
  onSave: () => void;
  onCancel?: () => void;
}

export function ToolExecutionPanel({
  selectedTool,
  toolArgs,
  isExecuting,
  isConnected,
  onArgChange,
  onExecute,
  onSave,
  onCancel,
}: ToolExecutionPanelProps) {
  const [showCancelButton, setShowCancelButton] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [copiedMetadata, setCopiedMetadata] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isDescriptionTruncated, setIsDescriptionTruncated] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);

  // Check if description needs truncation (more than 3 lines)
  useEffect(() => {
    if (descriptionRef.current && selectedTool?.description) {
      const element = descriptionRef.current;
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      const height = element.scrollHeight;
      const lines = Math.round(height / lineHeight);
      setIsDescriptionTruncated(lines > 3);
      setIsDescriptionExpanded(false);
    }
  }, [selectedTool?.description]);

  // Copy metadata to clipboard
  const copyMetadataToClipboard = () => {
    if (!selectedTool) return;
    const metadata = {
      name: selectedTool.name,
      description: selectedTool.description || "",
      _meta: (selectedTool as any)._meta,
    };
    navigator.clipboard.writeText(JSON.stringify(metadata, null, 2));
    setCopiedMetadata(true);
    setTimeout(() => setCopiedMetadata(false), 2000);
  };

  // Handle Cmd/Ctrl + Enter keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // Check if Cmd/Ctrl + Enter is pressed
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        // Only execute if a tool is selected and not already executing
        if (selectedTool && !isExecuting && isConnected) {
          event.preventDefault();
          onExecute();
        }
      }
      // Escape key to cancel execution
      if (event.key === "Escape" && isExecuting && onCancel) {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedTool, isExecuting, isConnected, onExecute, onCancel]);

  if (!selectedTool) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          Select a tool to get started
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Choose a tool from the list to view its details and execute it
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 p-3 sm:p-5 pt-3 sm:pt-4 pb-4 sm:pr-4">
        <div>
          <div className="flex flex-row items-center justify-between mb-0 gap-2">
            <h3 className="text-base sm:text-lg font-semibold">
              {selectedTool.name}
            </h3>
            <div className="flex gap-2 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showMetadata ? "default" : "outline"}
                    onClick={() => setShowMetadata(!showMetadata)}
                    disabled={isExecuting}
                    size="sm"
                    className="lg:size-default gap-2"
                    title="View tool metadata"
                  >
                    <Code className="h-4 w-4" />
                    <span className="hidden sm:inline">Metadata</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View tool definition metadata</p>
                </TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                onClick={onSave}
                disabled={isExecuting}
                size="sm"
                className="lg:size-default gap-2"
              >
                <Save className="h-4 w-4" />
                <span className="hidden sm:inline">Save</span>
              </Button>
              {isExecuting && onCancel ? (
                <Tooltip open={showCancelButton ? undefined : false}>
                  <TooltipTrigger asChild>
                    <div
                      onMouseEnter={() => setShowCancelButton(true)}
                      onMouseLeave={() => setShowCancelButton(false)}
                      className="relative"
                    >
                      <Button
                        onClick={onCancel}
                        variant={showCancelButton ? "destructive" : "default"}
                        size="sm"
                        className="lg:size-default gap-2 transition-all"
                      >
                        {showCancelButton ? (
                          <>
                            <X className="h-4 w-4" />
                            <span className="hidden sm:inline">Cancel</span>
                            <span className="hidden sm:inline text-[12px] border border-current p-1 rounded-full ml-2">
                              Esc
                            </span>
                          </>
                        ) : (
                          <>
                            <Spinner className="mr-2" />
                            <span className="hidden sm:inline">
                              Executing...
                            </span>
                          </>
                        )}
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Hover to cancel (or press Esc)</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  onClick={onExecute}
                  disabled={isExecuting || !isConnected}
                  size="sm"
                  className="lg:size-default pr-1! gap-0"
                >
                  {isExecuting ? (
                    <>
                      <Spinner className="mr-2" />
                      <span className="hidden sm:inline">Executing...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Execute</span>
                      <span className="hidden sm:inline text-[12px] border text-zinc-300 p-1 rounded-full border-zinc-300 dark:text-zinc-600 dark:border-zinc-500 ml-2">
                        ⌘↵
                      </span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-5 pb-4 pr-3">
        {selectedTool.description && (
          <div className="relative mb-4">
            <div className="relative">
              <p
                ref={descriptionRef}
                className={`text-sm text-gray-600 dark:text-gray-400 leading-relaxed transition-all duration-300 ${
                  !isDescriptionExpanded && isDescriptionTruncated
                    ? "line-clamp-3"
                    : ""
                }`}
              >
                {selectedTool.description}
              </p>
              {isDescriptionTruncated && !isDescriptionExpanded && (
                <div className="absolute bottom-0 left-0 right-0 h-[1.4em] bg-linear-to-t from-white/95 dark:from-black/95 via-white/55 dark:via-black/55 to-transparent pointer-events-none" />
              )}
            </div>
            {isDescriptionTruncated && (
              <div className="flex justify-end">
                <button
                  onClick={() =>
                    setIsDescriptionExpanded(!isDescriptionExpanded)
                  }
                  className="relative z-10 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mt-1 transition-colors"
                >
                  {isDescriptionExpanded ? (
                    <>
                      Show less
                      <ChevronUp className="h-3 w-3" />
                    </>
                  ) : (
                    <>
                      Show more
                      <ChevronDown className="h-3 w-3" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        <ToolInputForm
          selectedTool={selectedTool}
          toolArgs={toolArgs}
          onArgChange={onArgChange}
        />
      </div>

      <Dialog open={showMetadata} onOpenChange={setShowMetadata}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>Tool Definition</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyMetadataToClipboard}
                className="h-7 w-7 p-0"
                title="Copy metadata"
              >
                {copiedMetadata ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </DialogTitle>
          </DialogHeader>

          <JSONDisplay
            data={{
              name: selectedTool.name,
              description: selectedTool.description || "(no description)",
              _meta: (selectedTool as any)._meta || null,
            }}
            filename={`tool-definition-${selectedTool.name}-${Date.now()}.json`}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
