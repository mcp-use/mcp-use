import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import type { ReadResourceResult, Resource } from "@mcp-use/client/react";
import {
  Brush,
  Check,
  Clock,
  Code,
  Copy,
  Download,
  Maximize,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { isViewResource, isViewTool } from "@mcp-use/client/react";
import type { LLMConfig } from "../chat/types";
import { MCPAppsDebugControls } from "../MCPAppsDebugControls";
import { McpAppsViewPanel } from "../mcp-apps/McpAppsViewPanel";
import { JSONDisplay } from "../shared/JSONDisplay";
import { Spinner } from "../ui/spinner";

export interface ResourceResult {
  uri: string;
  result?: ReadResourceResult | { error?: string; isError?: boolean };
  error?: string;
  timestamp: number;
  // Resource metadata from definition
  resourceAnnotations?: Record<string, unknown>;
}

interface ResourceResultDisplayProps {
  result: ResourceResult | null;
  isLoading: boolean;
  previewMode: boolean;
  serverId?: string;
  readResource?: (uri: string) => Promise<ReadResourceResult>;
  onTogglePreview: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onFullscreen: () => void;
  onUIAction?: (action: unknown) => void;
  isCopied?: boolean;
  selectedResource?: Resource | null;
  llmConfig?: LLMConfig | null;
}

// Helper function to extract error message from result with isError: true
function extractErrorMessage(
  result: ReadResourceResult | { error?: string; isError?: boolean }
): string | null {
  // Handle direct error property
  if ("error" in result && result.error && typeof result.error === "string") {
    return result.error;
  }

  // Only extract text content as error if isError is explicitly true
  if (!("isError" in result && result.isError)) {
    return null;
  }

  // isError is true - extract error message from contents
  if ("contents" in result && Array.isArray(result.contents)) {
    const textContents = result.contents
      .filter(
        (item): item is Extract<typeof item, { text: string }> => "text" in item
      )
      .map((item) => item.text)
      .filter(Boolean);

    if (textContents.length > 0) {
      return textContents.join("\n");
    }
  }

  return "An error occurred";
}

export function ResourceResultDisplay({
  result,
  isLoading,
  previewMode,
  serverId,
  readResource,
  onTogglePreview,
  onCopy,
  onDownload,
  onFullscreen,
  isCopied = false,
  selectedResource,
  llmConfig,
}: ResourceResultDisplayProps) {
  // Stable empty object — avoids breaking ViewRenderer memo on every re-render
  const [activeProps, setActiveProps] = useState<Record<string, string> | null>(
    null
  );

  // Stable callback — must not change reference on re-renders, otherwise
  // MCPAppsDebugControls' useEffect (which has onPropsChange in its deps) would
  // re-fire and create an infinite loop.
  const handlePropsChange = useCallback((p: Record<string, string> | null) => {
    setActiveProps(p);
  }, []);
  const [mcpAppsDisplayMode, setMcpAppsDisplayMode] = useState<
    "inline" | "pip" | "fullscreen"
  >("inline");
  const emptyToolInput = useMemo(() => ({}), []);

  // Extract complete metadata from result contents for props configuration
  const contentMetadata =
    result?.result &&
    "contents" in result.result &&
    Array.isArray(result.result.contents)
      ? result.result.contents[0]?._meta || {}
      : {};
  const combinedAnnotations = {
    ...result?.resourceAnnotations,
    ...contentMetadata,
  };

  // Detect required props from the widget schema so we can warn before rendering.
  // Reads from "mcp-use/propsSchema" (mcp-use private extension in resource listing _meta).
  const requiredProps = useMemo(() => {
    const props = (combinedAnnotations as any)?.["mcp-use/propsSchema"];
    if (!props) return [];
    // Zod format: { def: { type: "object", shape: { propName: { def: { type: "..." } } } } }
    const shape = props.def?.shape;
    if (shape) {
      return Object.entries(shape)
        .filter(([, v]: any) => {
          const t = v?.def?.type ?? v?.type;
          return t !== "optional" && t !== "default";
        })
        .map(([k]) => k);
    }
    // JSON Schema format
    return (props.required as string[]) ?? [];
  }, [combinedAnnotations]);

  // Detect widget protocol (MCP Apps only)
  const widgetProtocol = isViewTool(
    combinedAnnotations as Record<string, unknown>
  )
    ? "mcp-apps"
    : null;

  const isMcpAppResource =
    result?.result &&
    "contents" in result.result &&
    Array.isArray(result.result.contents) &&
    result.result.contents.some((item: any) => isViewResource(item.mimeType));

  // Resource URI can come from metadata (for tool results) or be the resource URI itself (for resources)
  const mcpAppsResourceUri =
    (combinedAnnotations as any)?.ui?.resourceUri ||
    (contentMetadata as any)?.ui?.resourceUri ||
    (isMcpAppResource ? result.uri : undefined);

  const hasMcpAppsResource =
    (widgetProtocol === "mcp-apps" || isMcpAppResource) && !!mcpAppsResourceUri;

  const needsProps = requiredProps.length > 0 && !activeProps;

  if (isLoading) {
    return (
      <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          Select a resource to view its contents
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Choose a resource from the list to see its data
        </p>
      </div>
    );
  }

  // Check for error in result.error or result.result.isError
  const errorMessage =
    result.error || (result.result ? extractErrorMessage(result.result) : null);

  if (errorMessage) {
    return (
      <div className="p-4">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
          <p className="text-red-800 dark:text-red-300 font-medium">Error:</p>
          <p className="text-red-700 dark:text-red-400 text-sm">
            {errorMessage}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-gray-400" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {new Date(result.timestamp).toLocaleTimeString()}
            </span>
          </div>
          {(() => {
            const durationMs =
              (result as any)?.duration ??
              (result.result as any)?.duration ??
              (result.result as any)?.metrics?.durationMs;
            return durationMs !== undefined ? (
              <div className="flex items-center gap-1">
                <Zap className="h-3 w-3 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {durationMs}
                  ms
                </span>
              </div>
            ) : null;
          })()}
          {hasMcpAppsResource && (
            <Badge
              variant="outline"
              className="text-xs bg-green-50 dark:bg-green-900/20 border-none border-green-200 dark:border-green-800/50 text-green-600 dark:text-green-400"
            >
              MCP Apps
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasMcpAppsResource && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onTogglePreview}
              className={
                !previewMode ? "text-purple-600 dark:text-purple-400" : ""
              }
            >
              {previewMode ? (
                <Code className="h-4 w-4 mr-1" />
              ) : (
                <Brush className="h-4 w-4 mr-1" />
              )}
              {previewMode ? "JSON" : "Preview"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCopy}>
            {isCopied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDownload}>
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onFullscreen}>
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto relative">
        {(() => {
          // Handle MCP Apps (SEP-1865)
          if (
            hasMcpAppsResource &&
            serverId &&
            readResource &&
            mcpAppsResourceUri
          ) {
            if (previewMode) {
              // MCP Apps mode
              return (
                <div
                  className="flex flex-1 h-full relative flex-col min-h-0"
                  data-testid="resource-widget-preview"
                >
                  {/* Floating controls in top-right */}
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
                    <MCPAppsDebugControls
                      toolCallId={`resource-${result.timestamp}`}
                      displayMode={mcpAppsDisplayMode}
                      onDisplayModeChange={setMcpAppsDisplayMode}
                      propsContext="resource"
                      resourceUri={result.uri}
                      resourceAnnotations={combinedAnnotations}
                      llmConfig={llmConfig || null}
                      resource={selectedResource || null}
                      onPropsChange={handlePropsChange}
                      requiredProps={
                        requiredProps.length > 0 && !activeProps
                          ? requiredProps
                          : undefined
                      }
                    />
                  </div>

                  {needsProps ? (
                    <div className="flex items-center justify-center w-full h-full min-h-[200px] rounded-xl border-2 border-dashed border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-800/50 m-4">
                      <p className="text-sm text-gray-500 dark:text-gray-400 text-center px-6">
                        This widget requires props, set or generate them in the
                        props debugger
                      </p>
                    </div>
                  ) : (
                    <McpAppsViewPanel
                      serverId={serverId}
                      viewId={`resource-${result.timestamp}`}
                      toolName={mcpAppsResourceUri}
                      resourceUri={mcpAppsResourceUri}
                      toolInput={emptyToolInput}
                      toolOutput={result.result}
                      toolMetadata={combinedAnnotations}
                      readResource={readResource}
                      customProps={activeProps || undefined}
                      displayMode={mcpAppsDisplayMode}
                      onDisplayModeChange={setMcpAppsDisplayMode}
                      llmConfig={llmConfig}
                    />
                  )}
                </div>
              );
            } else {
              // JSON mode for MCP Apps
              return (
                <div className="px-4 pt-4" data-testid="resource-result-json">
                  <JSONDisplay
                    data={result.result}
                    filename={`resource-${result.uri.replace(/[^a-zA-Z0-9]/g, "-")}-mcp-apps-${Date.now()}.json`}
                  />
                </div>
              );
            }
          }

          // Default: show JSON for non-widget resources
          return (
            <div className="px-4 pt-4" data-testid="resource-result-json">
              <JSONDisplay
                data={result.result}
                filename={`resource-${result.uri.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.json`}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}
