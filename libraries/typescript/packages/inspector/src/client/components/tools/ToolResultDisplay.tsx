import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Check, Copy, History, Maximize, Minimize, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isMcpUIResource, McpUIRenderer } from "../McpUIRenderer";
import { OpenAIComponentRenderer } from "../OpenAIComponentRenderer";
import { JSONDisplay } from "../shared/JSONDisplay";
import { NotFound } from "../ui/not-found";

export interface ToolResult {
  toolName: string;
  args: Record<string, unknown>;
  result: any;
  error?: string;
  timestamp: number;
  duration?: number;
  // Tool metadata from definition (_meta field, includes openai/outputTemplate)
  toolMeta?: Record<string, any>;
  // For Apps SDK UI resources
  appsSdkResource?: {
    uri: string;
    resourceData: any;
    isLoading?: boolean;
    error?: string;
  };
}

interface ToolResultDisplayProps {
  results: ToolResult[];
  copiedResult: number | null;
  previewMode: boolean;
  serverId: string;
  readResource: (uri: string) => Promise<any>;
  onCopy: (index: number, result: any) => void;
  onDelete: (index: number) => void;
  onFullscreen: (index: number) => void;
  onTogglePreview: () => void;
  onMaximize?: () => void;
  isMaximized?: boolean;
}

// Helper function to format relative time
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
function extractErrorMessage(result: {
  isError?: boolean;
  error?: string;
  content?: unknown;
}): string | null {
  if (!result?.isError) {
    return null;
  }

  const content = result.content;
  if (Array.isArray(content)) {
    const textContents = content
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text)
      .filter(Boolean);

    if (textContents.length > 0) {
      return textContents.join("\n");
    }
  }

  return "An error occurred";
}

// Helper function to check if a string is valid JSON
function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

// Component to render formatted content
function FormattedContentDisplay({ content }: { content: any[] }) {
  if (!Array.isArray(content) || content.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">No content</div>
    );
  }

  return (
    <div className="space-y-4">
      {content.map((item: any, idx: number) => {
        // Handle text content
        if (item.type === "text") {
          const text = item.text || "";

          // Check if it's stringified JSON
          if (isValidJSON(text)) {
            try {
              const parsed = JSON.parse(text);
              return (
                <div key={idx} className="space-y-2">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Text Content (JSON)
                  </div>
                  <JSONDisplay data={parsed} filename={`content-${idx}.json`} />
                </div>
              );
            } catch {
              // Fall through to plain text
            }
          }

          // Plain text
          return (
            <div key={idx} className="space-y-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Text Content
              </div>
              <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3 font-mono text-sm whitespace-pre-wrap break-words">
                {text}
              </div>
            </div>
          );
        }

        // Handle image content
        if (item.type === "image") {
          return (
            <div key={idx} className="space-y-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Image Content
              </div>
              <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3">
                <img
                  src={`data:${item.mimeType || "image/png"};base64,${item.data}`}
                  alt="Result"
                  className="max-w-full rounded"
                />
                {item.annotations && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <JSONDisplay
                      data={item.annotations}
                      filename={`image-annotations-${idx}.json`}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        }

        // Handle audio content
        if (item.type === "audio") {
          return (
            <div key={idx} className="space-y-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Audio Content
              </div>
              <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3">
                <audio
                  controls
                  src={`data:${item.mimeType || "audio/wav"};base64,${item.data}`}
                  className="w-full"
                />
                {item.annotations && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <JSONDisplay
                      data={item.annotations}
                      filename={`audio-annotations-${idx}.json`}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        }

        // Handle resource links
        if (item.type === "resource_link") {
          return (
            <div key={idx} className="space-y-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Resource Link
              </div>
              <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3 space-y-2">
                <div className="font-mono text-sm break-all">
                  <span className="text-gray-600 dark:text-gray-400">URI:</span>{" "}
                  {item.uri}
                </div>
                {item.name && (
                  <div className="text-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      Name:
                    </span>{" "}
                    {item.name}
                  </div>
                )}
                {item.description && (
                  <div className="text-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      Description:
                    </span>{" "}
                    {item.description}
                  </div>
                )}
                {item.mimeType && (
                  <div className="text-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      MIME Type:
                    </span>{" "}
                    {item.mimeType}
                  </div>
                )}
                {item.annotations && (
                  <div className="mt-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Annotations:
                    </div>
                    <JSONDisplay
                      data={item.annotations}
                      filename={`resource-link-annotations-${idx}.json`}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        }

        // Handle embedded resources
        if (item.type === "resource") {
          const resource = item.resource || {};
          return (
            <div key={idx} className="space-y-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Embedded Resource
              </div>
              <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3 space-y-2">
                <div className="font-mono text-sm break-all">
                  <span className="text-gray-600 dark:text-gray-400">URI:</span>{" "}
                  {resource.uri}
                </div>
                {resource.mimeType && (
                  <div className="text-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      MIME Type:
                    </span>{" "}
                    {resource.mimeType}
                  </div>
                )}
                {resource.text && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Content:
                    </div>
                    <div className="bg-white dark:bg-black rounded p-2 font-mono text-sm whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                      {resource.text}
                    </div>
                  </div>
                )}
                {resource.blob && (
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    [Binary content: {resource.blob.length || 0} bytes]
                  </div>
                )}
                {resource.annotations && (
                  <div className="mt-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Annotations:
                    </div>
                    <JSONDisplay
                      data={resource.annotations}
                      filename={`resource-annotations-${idx}.json`}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        }

        // Unknown content type - show as JSON
        return (
          <div key={idx} className="space-y-2">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Unknown Content Type: {item.type || "N/A"}
            </div>
            <JSONDisplay data={item} filename={`content-${idx}.json`} />
          </div>
        );
      })}
    </div>
  );
}

export function ToolResultDisplay({
  results,
  copiedResult,
  previewMode,
  serverId,
  readResource,
  onCopy,
  onTogglePreview,
  onMaximize,
  isMaximized = false,
}: ToolResultDisplayProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [relativeTime, setRelativeTime] = useState<string>("");
  const [formattedMode, setFormattedMode] = useState(true); // true = formatted, false = raw

  // Get the most recent result to determine which tool we're viewing
  const currentResult = results[0];

  // Filter results to only show those from the same tool
  const toolResults = currentResult
    ? results.filter((r) => r.toolName === currentResult.toolName)
    : [];

  // Use the filtered results
  const result = toolResults[selectedIndex] || toolResults[0];

  // Find the original index in the results array for the current result
  const originalResultIndex = results.findIndex((r) => r === result);

  // Reset to first result when filtered results change
  useEffect(() => {
    if (toolResults.length > 0 && selectedIndex >= toolResults.length) {
      setSelectedIndex(0);
    }
  }, [toolResults.length, selectedIndex]);

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

  // Memoize result.args and result.result to prevent unnecessary re-renders
  // in OpenAIComponentRenderer when only relativeTime changes
  // Use stable identifiers (timestamp, selectedIndex) instead of the objects themselves
  const memoizedArgs = useMemo(
    () => result?.args,
    [result?.timestamp, selectedIndex]
  );
  const memoizedResult = useMemo(
    () => result?.result,
    [result?.timestamp, selectedIndex]
  );

  // Memoize readResource to ensure stable reference
  const memoizedReadResource = useCallback(
    (uri: string) => readResource(uri),
    [readResource]
  );

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

  // Check tool metadata for Apps SDK component (from tool definition)
  const openaiOutputTemplate = result.toolMeta?.["openai/outputTemplate"];
  const hasAppsSdkResource = !!(
    openaiOutputTemplate &&
    typeof openaiOutputTemplate === "string" &&
    result.appsSdkResource
  );
  const appsSdkUri = openaiOutputTemplate;

  // Check if result contains MCP UI resources
  const content = result.result?.content || [];
  const mcpUIResources = content.filter(
    (item: any) => item.type === "resource" && isMcpUIResource(item.resource)
  );
  const hasMcpUIResources = mcpUIResources.length > 0;

  // Check if result has content or structuredContent (for formatted/raw toggle)
  const hasContentOrStructured = !!(
    (content && content.length > 0) ||
    result.result?.structuredContent
  );
  const isNonUIResult =
    !hasMcpUIResources && !hasAppsSdkResource && hasContentOrStructured;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border-t dark:border-zinc-700">
      <div className="flex-1 overflow-y-auto h-full">
        <div className="space-y-0 flex flex-col">
          <div
            className={`sticky top-0 z-20 flex items-center gap-2 px-4 pt-2 backdrop-blur-xs bg-white/50 dark:bg-black/50 ${
              hasMcpUIResources || hasAppsSdkResource || isNonUIResult
                ? "border-b border-gray-200 dark:border-zinc-600 pb-2"
                : ""
            }`}
          >
            <h3 className="text-sm font-medium hidden sm:block">Response</h3>

            {result.duration !== undefined && (
              <div className="hidden sm:flex items-center gap-1">
                <Zap className="h-3 w-3 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {result.duration}ms
                </span>
              </div>
            )}

            {hasAppsSdkResource && (
              <div className="flex items-center gap-4 sm:ml-4">
                <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400">
                  URI: {appsSdkUri || "No URI"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onTogglePreview()}
                    className={`text-xs font-medium ${
                      previewMode
                        ? "text-black dark:text-white"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    Component
                  </button>
                  <span className="text-xs text-zinc-400">|</span>
                  <button
                    onClick={() => onTogglePreview()}
                    className={`text-xs font-medium ${
                      !previewMode
                        ? "text-black dark:text-white"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    Raw JSON
                  </button>
                </div>
              </div>
            )}

            {hasMcpUIResources && !hasAppsSdkResource && (
              <div className="flex items-center gap-4 sm:ml-4">
                <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400">
                  URI: {mcpUIResources[0]?.resource?.uri || "No URI"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onTogglePreview()}
                    className={`text-xs font-medium ${
                      previewMode
                        ? "text-black dark:text-white"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    Preview
                  </button>
                  <span className="text-xs text-zinc-400">|</span>
                  <button
                    onClick={() => onTogglePreview()}
                    className={`text-xs font-medium ${
                      !previewMode
                        ? "text-black dark:text-white"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    JSON
                  </button>
                </div>
              </div>
            )}

            {isNonUIResult && (
              <div className="flex items-center gap-2 sm:ml-4">
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
            )}

            <div className="ml-auto flex items-center gap-1">
              {(hasAppsSdkResource || hasMcpUIResources) && onMaximize && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onMaximize}
                  title={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? (
                    <Minimize className="h-4 w-4" />
                  ) : (
                    <Maximize className="h-4 w-4" />
                  )}
                </Button>
              )}

              {/* Version dropdown */}
              {toolResults.length > 1 && (
                <Select
                  value={selectedIndex.toString()}
                  onValueChange={(value) => setSelectedIndex(parseInt(value))}
                >
                  <SelectTrigger size="sm" className="w-[140px] h-8 text-xs">
                    <SelectValue>
                      <div className="flex items-center gap-1">
                        <History className="h-3 w-3" />
                        <span>{relativeTime}</span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {toolResults.map((r, idx) => (
                      <SelectItem key={idx} value={idx.toString()}>
                        <div className="flex items-center gap-2">
                          <History className="h-3 w-3" />
                          <span>{getRelativeTime(r.timestamp)}</span>
                          <span className="text-xs text-muted-foreground">
                            ({new Date(r.timestamp).toLocaleTimeString()})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCopy(originalResultIndex, result.result)}
              >
                {copiedResult === originalResultIndex ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {(() => {
            // Check for error in result.error or result.result.isError
            const errorMessage =
              result.error || extractErrorMessage(result.result);

            if (errorMessage) {
              return (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mx-4">
                  <p className="text-red-800 dark:text-red-300 font-medium">
                    Error:
                  </p>
                  <p className="text-red-700 dark:text-red-400 text-sm">
                    {errorMessage}
                  </p>
                </div>
              );
            }

            // Render normal result
            return (() => {
              // Handle Apps SDK UI resources
              if (hasAppsSdkResource) {
                const appsSdk = result.appsSdkResource!;

                if (appsSdk.isLoading) {
                  return <></>;
                }

                if (appsSdk.error) {
                  return (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mx-4">
                      <p className="text-red-800 dark:text-red-300 font-medium">
                        Resource Error:
                      </p>
                      <p className="text-red-700 dark:text-red-400 text-sm">
                        {appsSdk.error}
                      </p>
                    </div>
                  );
                }

                if (previewMode) {
                  // OpenAI Apps SDK Component mode
                  return (
                    <div className="flex-1">
                      <OpenAIComponentRenderer
                        componentUrl={appsSdkUri}
                        toolName={result.toolName}
                        toolArgs={memoizedArgs}
                        toolResult={memoizedResult}
                        serverId={serverId}
                        readResource={memoizedReadResource}
                        className="w-full h-full relative p-4"
                      />
                    </div>
                  );
                } else {
                  // JSON mode for Apps SDK resources
                  return (
                    <div className="px-4 pt-4">
                      <JSONDisplay
                        data={result.result}
                        filename={`tool-result-${result.toolName}-${Date.now()}.json`}
                      />
                    </div>
                  );
                }
              }

              if (hasMcpUIResources) {
                if (previewMode) {
                  return (
                    <div className="space-y-0 h-full">
                      {mcpUIResources.map((item: any, idx: number) => (
                        <div key={idx} className="mx-0 size-full">
                          <McpUIRenderer
                            resource={item.resource}
                            onUIAction={(_action) => {
                              // Handle UI actions here if needed
                            }}
                            className="w-full h-full relative"
                          />
                        </div>
                      ))}
                      {/* Show JSON for non-UI content */}
                      {content.filter(
                        (item: any) =>
                          !(
                            item.type === "resource" &&
                            isMcpUIResource(item.resource)
                          )
                      ).length > 0 && (
                        <div className="px-4">
                          <JSONDisplay
                            data={content.filter(
                              (item: any) =>
                                !(
                                  item.type === "resource" &&
                                  isMcpUIResource(item.resource)
                                )
                            )}
                            filename={`tool-result-${result.toolName}-non-ui-${Date.now()}.json`}
                          />
                        </div>
                      )}
                    </div>
                  );
                } else {
                  // JSON mode for MCP UI resources
                  return (
                    <div className="px-4 pt-4">
                      <JSONDisplay
                        data={result.result}
                        filename={`tool-result-${result.toolName}-mcp-ui-${Date.now()}.json`}
                      />
                    </div>
                  );
                }
              }

              // Default: show JSON for non-MCP UI resources
              // If we have content or structuredContent, show formatted/raw toggle
              if (isNonUIResult && formattedMode) {
                // Formatted mode: show structured content or formatted content
                const structuredContent = result.result?.structuredContent;

                return (
                  <div className="px-4 pt-4 space-y-4">
                    {structuredContent && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Structured Content
                        </div>
                        <JSONDisplay
                          data={structuredContent}
                          filename={`structured-content-${result.toolName}-${Date.now()}.json`}
                        />
                      </div>
                    )}

                    {content && content.length > 0 && (
                      <FormattedContentDisplay content={content} />
                    )}

                    {!structuredContent &&
                      (!content || content.length === 0) && (
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          No content to display
                        </div>
                      )}
                  </div>
                );
              }

              // Raw mode or no special content: show full JSON
              return (
                <div className="px-4 pt-4">
                  <JSONDisplay
                    data={result.result}
                    filename={`tool-result-${result.toolName}-${Date.now()}.json`}
                  />
                </div>
              );
            })();
          })()}
        </div>
      </div>
    </div>
  );
}
