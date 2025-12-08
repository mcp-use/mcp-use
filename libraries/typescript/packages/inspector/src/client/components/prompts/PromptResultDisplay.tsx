import { Check, Clock, Copy, Zap } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { NotFound } from "../ui/not-found";
import { JSONDisplay } from "../shared/JSONDisplay";
import type { GetPromptResult } from "@mcp-use/modelcontextprotocol-sdk/types.js";

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
  onCopy: (
    index: number,
    result: GetPromptResult | { error?: string; isError?: boolean }
  ) => void;
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

export function PromptResultDisplay({
  results,
  copiedResult,
  onCopy,
}: PromptResultDisplayProps) {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border-t dark:border-zinc-700">
      <div className="flex-1 overflow-y-auto h-full">
        {results.length > 0 ? (
          <div className="space-y-4 flex-1 h-full">
            {results.map((result, index) => {
              // Check for error in result.error or result.result.isError
              const errorMessage =
                result.error || extractErrorMessage(result.result);

              return (
                <div
                  key={index}
                  className="space-y-0 flex-1 h-full flex flex-col"
                >
                  <div className="flex items-center gap-2 px-4 pt-2 border-b border-gray-200 dark:border-zinc-600 pb-2">
                    <h3 className="text-sm font-medium">Response</h3>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-gray-400" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(result.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {result.duration !== undefined && (
                      <div className="flex items-center gap-1">
                        <Zap className="h-3 w-3 text-gray-400" />
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {result.duration}
                          ms
                        </span>
                      </div>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCopy(index, result.result)}
                        className="h-6 px-2"
                      >
                        {copiedResult === index ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {errorMessage ? (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mx-4">
                      <p className="text-red-800 dark:text-red-300 font-medium">
                        Error:
                      </p>
                      <p className="text-red-700 dark:text-red-400 text-sm">
                        {errorMessage}
                      </p>
                    </div>
                  ) : (
                    <div className="px-4 pt-4">
                      <JSONDisplay
                        data={result.result}
                        filename={`prompt-result-${result.promptName}-${Date.now()}.json`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <NotFound vertical noBorder message="No Results yet" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
