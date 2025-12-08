import type { Tool } from "@mcp-use/modelcontextprotocol-sdk/types.js";
import { Play, Save, X, Code } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { ToolInputForm } from "./ToolInputForm";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { Copy, Check } from "lucide-react";

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
  const [showMetadata, setShowMetadata] = useState(() => {
    // Load preference from localStorage
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mcp-inspector-show-tool-metadata");
      return saved ? JSON.parse(saved) : false;
    }
    return false;
  });
  const [copiedMetadata, setCopiedMetadata] = useState(false);

  // Persist metadata visibility preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "mcp-inspector-show-tool-metadata",
        JSON.stringify(showMetadata)
      );
    }
  }, [showMetadata]);

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
      <div className="flex-shrink-0 p-3 sm:p-5 pt-3 sm:pt-4 pb-4 sm:pr-4">
        <div>
          <div className="flex flex-row items-center justify-between mb-0 gap-2">
            <h3 className="text-base sm:text-lg font-semibold">
              {selectedTool.name}
            </h3>
            <div className="flex gap-2 flex-shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showMetadata ? "default" : "outline"}
                    onClick={() => setShowMetadata(!showMetadata)}
                    disabled={isExecuting}
                    size="sm"
                    className="lg:size-default gap-2"
                    title="Toggle tool metadata"
                  >
                    <Code className="h-4 w-4" />
                    <span className="hidden sm:inline">Metadata</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Show tool definition metadata</p>
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
          {selectedTool.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-2">
              {selectedTool.description}
            </p>
          )}
        </div>
      </div>

      {showMetadata ? (
        <div className="flex-1 overflow-hidden flex gap-4 px-3 sm:px-6 pb-4">
          {/* Left side: Input form (60%) */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            <ToolInputForm
              selectedTool={selectedTool}
              toolArgs={toolArgs}
              onArgChange={onArgChange}
            />
          </div>

          {/* Right side: Metadata display (40%) */}
          <div className="w-2/5 flex flex-col bg-zinc-50 dark:bg-zinc-900/50 rounded border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
              <h4 className="text-sm font-medium">Tool Definition</h4>
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
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <pre className="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                {JSON.stringify(
                  {
                    name: selectedTool.name,
                    description: selectedTool.description || "(no description)",
                    _meta: (selectedTool as any)._meta || null,
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 pb-4 pr-3">
          <ToolInputForm
            selectedTool={selectedTool}
            toolArgs={toolArgs}
            onArgChange={onArgChange}
          />
        </div>
      )}
    </div>
  );
}
