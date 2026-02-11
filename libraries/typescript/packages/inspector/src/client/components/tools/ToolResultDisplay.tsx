import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Check, Copy, History, Maximize, Minimize, Zap } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useWidgetDebug } from "../../context/WidgetDebugContext";
import {
  detectWidgetProtocol,
  getResourceUriForProtocol,
  hasBothProtocols,
} from "../../utils/widget-detection";
import { MCPAppsDebugControls } from "../MCPAppsDebugControls";
import { MCPAppsRenderer } from "../MCPAppsRenderer";
import { isMcpUIResource, McpUIRenderer } from "../McpUIRenderer";
import { OpenAIComponentRenderer } from "../OpenAIComponentRenderer";
import { JSONDisplay } from "../shared/JSONDisplay";
import { NotFound } from "../ui/not-found";
import { Spinner } from "../ui/spinner";

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

type ViewMode =
  | "chatgpt-app" // Component (Apps SDK)
  | "mcp-apps" // Component (MCP Apps)
  | "mcp-ui" // Component (MCP-UI)
  | "json"; // Raw JSON

interface ToolResultDisplayProps {
  results: ToolResult[];
  copiedResult: number | null;
  serverId: string;
  readResource: (uri: string) => Promise<any>;
  onCopy: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onFullscreen: (index: number) => void;
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
              <div
                className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3 font-mono text-sm whitespace-pre-wrap break-words"
                data-testid="tool-execution-results-text-content"
              >
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
                  data-testid="tool-execution-results-image-content"
                />
                {item.annotations && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <JSONDisplay
                      data={item.annotations}
                      filename={`image-annotations-${idx}.json`}
                      data-testid="tool-execution-results-image-annotations"
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
                  data-testid="tool-execution-results-audio-content"
                />
                {item.annotations && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <JSONDisplay
                      data={item.annotations}
                      filename={`audio-annotations-${idx}.json`}
                      data-testid="tool-execution-results-audio-annotations"
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
                      data-testid="tool-execution-results-resource-link-annotations"
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
                <div
                  className="font-mono text-sm break-all"
                  data-testid="tool-execution-results-resource-uri"
                >
                  <span className="text-gray-600 dark:text-gray-400">URI:</span>{" "}
                  {resource.uri}
                </div>
                {resource.mimeType && (
                  <div className="text-sm">
                    <span
                      className="text-gray-600 dark:text-gray-400"
                      data-testid="tool-execution-results-mime-type"
                    >
                      MIME Type:
                    </span>{" "}
                    {resource.mimeType}
                  </div>
                )}
                {resource.text && (
                  <div data-testid="tool-execution-results-resource-text-content">
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
                      data-testid="tool-execution-results-resource-annotations"
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
            <JSONDisplay
              data={item}
              filename={`content-${idx}.json`}
              data-testid="tool-execution-results-unknown-content"
            />
          </div>
        );
      })}
    </div>
  );
}

export function ToolResultDisplay({
  results,
  copiedResult,
  serverId,
  readResource,
  onCopy,
  onMaximize,
  isMaximized = false,
}: ToolResultDisplayProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [relativeTime, setRelativeTime] = useState<string>("");
  const [formattedMode, setFormattedMode] = useState(true); // true = formatted, false = raw
  const [viewMode, setViewMode] = useState<ViewMode | null>(null); // Let effect initialize
  const [mcpAppsDisplayMode, setMcpAppsDisplayMode] = useState<
    "inline" | "pip" | "fullscreen"
  >("inline");
  const [activeProps, setActiveProps] = useState<Record<string, string> | null>(
    null
  );

  // Track if we've ever seen component views available (to handle async resource loading)
  const hasSeenComponentViewRef = useRef(false);

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

  // Copyable content: error message when present, otherwise pretty-printed result
  const errorMessageForCopy = result
    ? result.error || extractErrorMessage(result.result)
    : null;
  const copyableText =
    errorMessageForCopy != null
      ? errorMessageForCopy
      : result != null
        ? JSON.stringify(result.result, null, 2)
        : "";

  // Reset to first result when filtered results change
  useEffect(() => {
    if (toolResults.length > 0 && selectedIndex >= toolResults.length) {
      setSelectedIndex(0);
    }
  }, [toolResults.length, selectedIndex]);

  // Reset view mode tracking when tool changes
  useEffect(() => {
    hasSeenComponentViewRef.current = false;
    setViewMode(null);
  }, [currentResult?.toolName]);

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
  // Include duration in dependencies to detect when result is updated
  // (timestamp stays same, but duration changes from 0 to actual value when tool completes)
  const memoizedResult = useMemo(
    () => result?.result,
    [result?.timestamp, result?.duration, selectedIndex]
  );

  // Memoize readResource to ensure stable reference
  const memoizedReadResource = useCallback(
    (uri: string) => readResource(uri),
    [readResource]
  );

  // Memoize onSendFollowUp to prevent infinite re-render loop
  // This callback is used in MCPAppsRenderer's effect dependency array
  const memoizedOnSendFollowUp = useCallback((text: string) => {
    toast.info("Message received", {
      description: text,
      duration: 5000,
    });
  }, []);

  // Get widget debug context for protocol selection
  const { playground } = useWidgetDebug();

  // Detect widget protocol (Priority: MCP Apps → ChatGPT Apps → MCP-UI)
  // IMPORTANT: These hooks must be called before any early returns
  const widgetProtocol = useMemo(
    () =>
      result ? detectWidgetProtocol(result.toolMeta, result.result) : null,
    [result]
  );

  // Detect if tool supports both protocols
  const supportsBothProtocols = useMemo(
    () => (result ? hasBothProtocols(result.toolMeta) : false),
    [result]
  );

  // Determine active protocol based on toggle state
  const activeProtocol = useMemo(() => {
    if (!widgetProtocol) return null;

    if (widgetProtocol === "both") {
      // User has selected a protocol via toggle
      if (playground.selectedProtocol) {
        return playground.selectedProtocol;
      }
      // Default to MCP Apps when both exist
      return "mcp-apps";
    }

    return widgetProtocol;
  }, [widgetProtocol, playground.selectedProtocol]);

  // Check for MCP Apps (SEP-1865) - BEFORE early return
  const mcpAppsResourceUri = useMemo(() => {
    if (!result) return null;
    return supportsBothProtocols
      ? getResourceUriForProtocol("mcp-apps", result.toolMeta)
      : result.toolMeta?.ui?.resourceUri;
  }, [result, supportsBothProtocols]);

  const hasMcpAppsResource = useMemo(
    () =>
      (activeProtocol === "mcp-apps" || supportsBothProtocols) &&
      !!mcpAppsResourceUri,
    [activeProtocol, supportsBothProtocols, mcpAppsResourceUri]
  );

  // Check tool metadata for Apps SDK component (from tool definition) - BEFORE early return
  const openaiOutputTemplate = useMemo(() => {
    if (!result) return null;
    return supportsBothProtocols
      ? getResourceUriForProtocol("chatgpt-app", result.toolMeta)
      : result.toolMeta?.["openai/outputTemplate"];
  }, [result, supportsBothProtocols]);

  const hasAppsSdkResource = useMemo(
    () =>
      !!(
        (activeProtocol === "chatgpt-app" || supportsBothProtocols) &&
        openaiOutputTemplate &&
        typeof openaiOutputTemplate === "string" &&
        result?.appsSdkResource
      ),
    [activeProtocol, supportsBothProtocols, openaiOutputTemplate, result]
  );

  const appsSdkUri = openaiOutputTemplate;

  // Check if result contains MCP UI resources - BEFORE early return
  const content = useMemo(() => result?.result?.content || [], [result]);
  const mcpUIResources = useMemo(
    () =>
      content.filter(
        (item: any) =>
          item.type === "resource" && isMcpUIResource(item.resource)
      ),
    [content]
  );
  const hasMcpUIResources = mcpUIResources.length > 0;

  // Check if result has content or structuredContent (for formatted/raw toggle)
  const hasContentOrStructured = useMemo(
    () =>
      !!((content && content.length > 0) || result?.result?.structuredContent),
    [content, result]
  );

  const isNonUIResult = useMemo(
    () =>
      !hasMcpAppsResource &&
      !hasMcpUIResources &&
      !hasAppsSdkResource &&
      hasContentOrStructured,
    [
      hasMcpAppsResource,
      hasMcpUIResources,
      hasAppsSdkResource,
      hasContentOrStructured,
    ]
  );

  // Build available view options based on detected protocols - BEFORE early return
  const availableViews = useMemo(() => {
    const views: Array<{ mode: ViewMode; label: string }> = [];

    // Check for ChatGPT Apps SDK
    if (hasAppsSdkResource || (supportsBothProtocols && openaiOutputTemplate)) {
      views.push({ mode: "chatgpt-app", label: "Component (Apps SDK)" });
    }

    // Check for MCP Apps (SEP-1865)
    if (hasMcpAppsResource || (supportsBothProtocols && mcpAppsResourceUri)) {
      views.push({ mode: "mcp-apps", label: "Component (MCP Apps)" });
    }

    // Check for MCP-UI
    if (hasMcpUIResources) {
      views.push({ mode: "mcp-ui", label: "Component (MCP-UI)" });
    }

    // Always show Raw JSON
    views.push({ mode: "json", label: "Raw JSON" });

    return views;
  }, [
    hasAppsSdkResource,
    hasMcpAppsResource,
    hasMcpUIResources,
    supportsBothProtocols,
    openaiOutputTemplate,
    mcpAppsResourceUri,
  ]);

  // Initialize view mode when result changes or available views change - BEFORE early return
  useEffect(() => {
    if (availableViews.length === 0) return;

    const isCurrentModeAvailable =
      viewMode && availableViews.some((v) => v.mode === viewMode);
    const firstComponentView = availableViews.find((v) => v.mode !== "json");

    // Track if component views are now available
    if (firstComponentView) {
      const wasComponentViewAvailable = hasSeenComponentViewRef.current;
      hasSeenComponentViewRef.current = true;

      // Initialize if null, fix if current mode isn't available,
      // OR switch from JSON to component when component FIRST becomes available
      // (handles async resource loading where JSON was the only option initially)
      // Only auto-switch once - after that, respect user's choice
      if (
        !viewMode ||
        !isCurrentModeAvailable ||
        (viewMode === "json" && !wasComponentViewAvailable)
      ) {
        setViewMode(firstComponentView.mode);
        return;
      }
    } else {
      // No component views available
      if (!viewMode || !isCurrentModeAvailable) {
        setViewMode("json");
      }
    }
  }, [availableViews, viewMode]);

  // Early return AFTER all hooks are called
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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border-t dark:border-zinc-700">
      <div className="flex-1 overflow-y-auto h-full">
        <div className="space-y-0 flex flex-col flex-1 h-full">
          <div
            className={`sticky top-0 z-20 flex items-center gap-2 px-4 pt-2 backdrop-blur-xs bg-white/50 dark:bg-black/50 ${
              hasMcpAppsResource ||
              hasMcpUIResources ||
              hasAppsSdkResource ||
              isNonUIResult
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

            {/* Unified header for all widget types */}
            {(hasAppsSdkResource ||
              hasMcpAppsResource ||
              hasMcpUIResources) && (
              <div className="flex items-center gap-4 sm:ml-4">
                {/* Show URI if available */}
                {(appsSdkUri ||
                  mcpAppsResourceUri ||
                  mcpUIResources[0]?.resource?.uri) && (
                  <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400">
                    URI:{" "}
                    {appsSdkUri ||
                      mcpAppsResourceUri ||
                      mcpUIResources[0]?.resource?.uri ||
                      "No URI"}
                  </span>
                )}

                {/* Dynamic view mode buttons */}
                <div className="flex items-center gap-2">
                  {availableViews.map((view, index) => (
                    <React.Fragment key={view.mode}>
                      {index > 0 && (
                        <span className="text-xs text-zinc-400">|</span>
                      )}
                      <button
                        data-testid={`tool-result-view-${view.mode}`}
                        onClick={() => setViewMode(view.mode)}
                        className={`text-xs font-medium ${
                          viewMode === view.mode
                            ? "text-black dark:text-white"
                            : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {view.label}
                      </button>
                    </React.Fragment>
                  ))}
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
              {(hasMcpAppsResource ||
                hasAppsSdkResource ||
                hasMcpUIResources) &&
                onMaximize && (
                  <Button
                    data-testid="tool-result-maximize"
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
                data-testid={`tool-result-copy-${originalResultIndex}`}
                variant="ghost"
                size="sm"
                onClick={() => onCopy(originalResultIndex, copyableText)}
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

            // Render based on selected view mode
            return (() => {
              // Show loading state while view mode is initializing
              if (!viewMode) {
                return (
                  <div className="flex items-center justify-center w-full h-[200px]">
                    <Spinner className="size-5" />
                  </div>
                );
              }

              switch (viewMode) {
                case "chatgpt-app": {
                  // ChatGPT Apps SDK Component view
                  if (!hasAppsSdkResource || !result.appsSdkResource) {
                    return (
                      <div className="px-4 pt-4">
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                          <p className="text-sm text-red-600 dark:text-red-400">
                            Apps SDK resource not available
                          </p>
                        </div>
                      </div>
                    );
                  }

                  const appsSdk = result.appsSdkResource;

                  if (appsSdk.isLoading) {
                    return (
                      <div className="flex items-center justify-center w-full h-[200px]">
                        <Spinner className="size-5" />
                      </div>
                    );
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

                  return (
                    <div className="flex-1">
                      <OpenAIComponentRenderer
                        key={`openai-${result.timestamp}`}
                        componentUrl={appsSdk.uri}
                        toolName={result.toolName}
                        toolArgs={memoizedArgs}
                        toolResult={memoizedResult}
                        serverId={serverId}
                        readResource={memoizedReadResource}
                        className="w-full h-full relative p-4"
                      />
                    </div>
                  );
                }

                case "mcp-apps": {
                  // MCP Apps (SEP-1865) Component view
                  if (!hasMcpAppsResource || !mcpAppsResourceUri) {
                    return (
                      <div className="px-4 pt-4">
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                          <p className="text-sm text-red-600 dark:text-red-400">
                            MCP Apps resource not available
                          </p>
                        </div>
                      </div>
                    );
                  }

                  // Extract widget props from toolOutput._meta (same as OpenAI renderer)
                  const metaSource = memoizedResult?._meta;
                  const widgetProps = metaSource?.["mcp-use/props"] || null;

                  // Merge widget props (from output) with custom props (from debug controls) and tool args
                  // Priority: activeProps > widgetProps > memoizedArgs
                  const finalToolInput = {
                    ...(memoizedArgs || {}),
                    ...(widgetProps || {}),
                    ...(activeProps || {}),
                  };

                  return (
                    <div className="flex-1 relative">
                      {/* Floating controls in top-right */}
                      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
                        <MCPAppsDebugControls
                          toolCallId={`tool-${result.timestamp}`}
                          displayMode={mcpAppsDisplayMode}
                          onDisplayModeChange={setMcpAppsDisplayMode}
                          propsContext="tool"
                          resourceUri={mcpAppsResourceUri}
                          toolInput={result.args}
                          resourceAnnotations={result.toolMeta}
                          llmConfig={null}
                          resource={null}
                          onPropsChange={setActiveProps}
                        />
                      </div>

                      <MCPAppsRenderer
                        key={`mcp-apps-${result.timestamp}`}
                        serverId={serverId}
                        toolCallId={`tool-${result.timestamp}`}
                        toolName={result.toolName}
                        toolInput={finalToolInput}
                        toolOutput={memoizedResult}
                        toolMetadata={result.toolMeta}
                        resourceUri={mcpAppsResourceUri}
                        readResource={memoizedReadResource}
                        className="w-full h-full relative p-4"
                        displayMode={mcpAppsDisplayMode}
                        onDisplayModeChange={setMcpAppsDisplayMode}
                        onSendFollowUp={memoizedOnSendFollowUp}
                      />
                    </div>
                  );
                }

                case "mcp-ui": {
                  // MCP-UI Component view
                  if (!hasMcpUIResources) {
                    return (
                      <div className="px-4 pt-4">
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                          <p className="text-sm text-red-600 dark:text-red-400">
                            MCP-UI resource not available
                          </p>
                        </div>
                      </div>
                    );
                  }

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
                }

                case "json": {
                  // Raw JSON view (or formatted for non-UI results)
                  // For non-UI results, check if we should show formatted content
                  if (isNonUIResult && formattedMode) {
                    const structuredContent = result.result?.structuredContent;

                    return (
                      <div
                        className="px-4 pt-4 space-y-4"
                        data-testid="tool-execution-results-content"
                      >
                        {structuredContent && (
                          <div
                            className="space-y-2"
                            data-testid="tool-execution-results-structured-content"
                          >
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
                            <div
                              className="text-sm text-gray-500 dark:text-gray-400"
                              data-testid="tool-execution-results-no-content"
                            >
                              No content to display
                            </div>
                          )}
                      </div>
                    );
                  }

                  // Raw JSON mode
                  return (
                    <div className="px-4 pt-4">
                      <JSONDisplay
                        data={result.result}
                        filename={`tool-result-${result.toolName}-${Date.now()}.json`}
                      />
                    </div>
                  );
                }

                default:
                  return null;
              }
            })();
          })()}
        </div>
      </div>
    </div>
  );
}
