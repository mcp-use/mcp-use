import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Button } from "@/client/components/ui/button";
import {
  Check,
  Copy,
  History,
  Maximize,
  Minimize,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NotFound } from "../ui/not-found";
import { JSONDisplay } from "../shared/JSONDisplay";
import { PromptMessageCard } from "./PromptMessageCard";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

export interface PromptResult {
  promptName: string;
  args: Record<string, unknown>;
  result: GetPromptResult | { error?: string; isError?: boolean };
  error?: string;
  timestamp: number;
  duration?: number;
}

interface PromptResultDisplayProps {
  results: PromptResult[];
  copiedResult: number | null;
  previewMode?: boolean;
  onCopy: (
    index: number,
    result: GetPromptResult | { error?: string; isError?: boolean }
  ) => void;
  onDelete?: (index: number) => void;
  onFullscreen?: (index: number) => void;
  onTogglePreview?: () => void;
  onMaximize?: () => void;
  isMaximized?: boolean;
}

/**
 * Format a timestamp as a compact human-readable relative time.
 *
 * @param timestamp - Milliseconds since the Unix epoch to compare against the current time
 * @returns A short relative time string: `"now"` for <10s, `"<n>s ago"` for seconds, `"<n>m ago"` for minutes, `"<n>h ago"` for hours, or `"<n>d ago"` for days
 */
function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// Helper function to extract error message from result with isError: true
function extractErrorMessage(
  result: GetPromptResult | { error?: string; isError?: boolean }
): string | null {
  // Check if this is an error result object
  if ("isError" in result && !result.isError) {
    return null;
  }

  // Handle error property directly
  if ("error" in result && result.error) {
    return result.error;
  }

  // GetPromptResult has messages, not content
  // If isError is true but no explicit error, return generic message
  if ("isError" in result && result.isError) {
    return "An error occurred";
  }

  return null;
}

/**
 * Renders a selectable view of prompt invocation results with controls for copying, deleting,
 * time-relative labels, formatted/raw toggling, and optional fullscreen/maximize actions.
 *
 * @param results - Array of prompt results; the most recent result (results[0]) determines the current prompt group to view.
 * @param copiedResult - Index of the result that was most recently copied, or `null` if none.
 * @param previewMode - When `true`, enables compact preview behaviors (defaults to `true`).
 * @param onCopy - Callback invoked with (originalResultIndex, result) when the copy action is triggered.
 * @param onDelete - Optional callback invoked with (originalResultIndex) when the delete action is triggered.
 * @param onFullscreen - Optional callback invoked with (originalResultIndex) to open the result in fullscreen (used on small screens).
 * @param onTogglePreview - Optional callback to toggle preview mode (not required by the component to render).
 * @param onMaximize - Optional callback invoked to toggle maximize/restore state.
 * @param isMaximized - When `true`, indicates the component is currently maximized (defaults to `false`).
 * @returns The rendered prompt results UI containing header controls, error or formatted message display, and raw JSON fallback.
 */
export function PromptResultDisplay({
  results,
  copiedResult,
  previewMode = true,
  onCopy,
  onDelete,
  onFullscreen,
  onTogglePreview,
  onMaximize,
  isMaximized = false,
}: PromptResultDisplayProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [relativeTime, setRelativeTime] = useState<string>("");
  const [formattedMode, setFormattedMode] = useState(true); // true = formatted, false = raw

  // Get the most recent result to determine which prompt we're viewing
  const currentResult = results[0];

  // Filter results to only show those from the same prompt
  const promptResults = currentResult
    ? results.filter((r) => r.promptName === currentResult.promptName)
    : [];

  // Use the filtered results
  const result = promptResults[selectedIndex] || promptResults[0];

  // Find the original index in the results array for the current result
  const originalResultIndex = results.findIndex((r) => r === result);

  // Reset to first result when filtered results change
  useEffect(() => {
    if (promptResults.length > 0 && selectedIndex >= promptResults.length) {
      setSelectedIndex(0);
    }
  }, [promptResults.length, selectedIndex]);

  // Update relative time every second
  useEffect(() => {
    const updateTime = () => {
      if (result) {
        setRelativeTime(getRelativeTime(result.timestamp));
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [result]);

  if (results.length === 0) {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-black border-t dark:border-zinc-700">
        <div className="flex-1 overflow-y-auto h-full">
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <NotFound vertical noBorder message="No Results yet" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Check for error in result.error or result.result.isError
  const errorMessage = result.error || extractErrorMessage(result.result);
  const hasMessages =
    "messages" in result.result && Array.isArray(result.result.messages);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border-t dark:border-zinc-700">
      <div className="flex-1 overflow-y-auto h-full">
        <div className="space-y-0 flex-1 h-full flex flex-col">
          <div className="flex items-center gap-2 px-4 pt-2 border-b border-gray-200 dark:border-zinc-600 pb-2">
            <h3 className="text-sm font-medium hidden sm:block">Response</h3>

            {result.duration !== undefined && (
              <div className="hidden sm:flex items-center gap-1">
                <Zap className="h-3 w-3 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {result.duration}ms
                </span>
              </div>
            )}

            {hasMessages && (
              <div className="flex items-center gap-4 sm:ml-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFormattedMode(true)}
                    className={`text-xs font-medium ${
                      formattedMode
                        ? "text-black dark:text-white"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    Formatted
                  </button>
                  <span className="text-xs text-zinc-400">|</span>
                  <button
                    onClick={() => setFormattedMode(false)}
                    className={`text-xs font-medium ${
                      !formattedMode
                        ? "text-black dark:text-white"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    Raw
                  </button>
                </div>
              </div>
            )}

            <div className="ml-auto flex items-center gap-1">
              {promptResults.length > 1 && (
                <div className="flex items-center gap-2 mr-2">
                  <History className="h-3 w-3 text-gray-400" />
                  <Select
                    value={selectedIndex.toString()}
                    onValueChange={(value) => setSelectedIndex(parseInt(value))}
                  >
                    <SelectTrigger className="h-7 w-[120px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {promptResults.map((_, idx) => (
                        <SelectItem key={idx} value={idx.toString()}>
                          {idx === 0 ? "Latest" : `${idx + 1} call ago`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">
                {relativeTime}
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCopy(originalResultIndex, result.result)}
                className="h-7 w-7 p-0"
                title="Copy result"
              >
                {copiedResult === originalResultIndex ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>

              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(originalResultIndex)}
                  className="h-7 w-7 p-0"
                  title="Delete result"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}

              {onFullscreen && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onFullscreen(originalResultIndex)}
                  className="h-7 w-7 p-0 sm:hidden"
                  title="Fullscreen"
                >
                  <Maximize className="h-4 w-4" />
                </Button>
              )}

              {onMaximize && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onMaximize}
                  className="h-7 w-7 p-0 hidden sm:flex"
                  title={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? (
                    <Minimize className="h-4 w-4" />
                  ) : (
                    <Maximize className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {errorMessage ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                <p className="text-red-800 dark:text-red-300 font-medium">
                  Error:
                </p>
                <p className="text-red-700 dark:text-red-400 text-sm">
                  {errorMessage}
                </p>
              </div>
            ) : formattedMode && hasMessages ? (
              <div className="space-y-3">
                {result.result.messages.map(
                  (message: any, msgIndex: number) => (
                    <PromptMessageCard
                      key={msgIndex}
                      message={message}
                      index={msgIndex}
                    />
                  )
                )}
              </div>
            ) : (
              <JSONDisplay
                data={result.result}
                filename={`prompt-result-${result.promptName}-${Date.now()}.json`}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
