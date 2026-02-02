import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import type {
  ReadResourceResult,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
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
import { useState } from "react";
import { detectWidgetProtocol } from "../../utils/widget-detection";
import type { LLMConfig } from "../chat/types";
import { MCPAppsDebugControls } from "../MCPAppsDebugControls";
import { MCPAppsRenderer } from "../MCPAppsRenderer";
import { isMcpUIResource, McpUIRenderer } from "../McpUIRenderer";
import { OpenAIComponentRenderer } from "../OpenAIComponentRenderer";
import { JSONDisplay } from "../shared/JSONDisplay";
import { Spinner } from "../ui/spinner";

export interface ResourceResult {
  uri: string;
  result?: ReadResourceResult | { error?: string; isError?: boolean };
  error?: string;
  timestamp: number;
  // Resource metadata from definition (includes openai/outputTemplate in annotations)
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
  const [activeProps, setActiveProps] = useState<Record<string, string> | null>(
    null
  );
  // Check for OpenAI Apps SDK component
  // OpenAI metadata can be in:
  // 1. Resource annotations from the resource list (resourceAnnotations)
  // 2. _meta field in the resource contents when read
  let openaiAnnotations: string[] = [];
  let openaiOutputTemplate: string | undefined;

  // Check resource annotations first
  if (result?.resourceAnnotations) {
    openaiAnnotations = Object.keys(result.resourceAnnotations).filter((key) =>
      key.startsWith("openai/")
    );
    openaiOutputTemplate = result.resourceAnnotations[
      "openai/outputTemplate"
    ] as string;
  }

  // Also check _meta in contents (this is where OpenAI metadata often appears)
  if (
    result?.result &&
    "contents" in result.result &&
    Array.isArray(result.result.contents) &&
    result.result.contents[0]?._meta
  ) {
    const contentMeta = result.result.contents[0]._meta;
    const metaKeys = Object.keys(contentMeta).filter((key) =>
      key.startsWith("openai/")
    );
    if (metaKeys.length > 0) {
      openaiAnnotations = [...openaiAnnotations, ...metaKeys];
    }
    // If we don't have outputTemplate yet, check in _meta
    if (!openaiOutputTemplate && contentMeta["openai/outputTemplate"]) {
      openaiOutputTemplate = contentMeta["openai/outputTemplate"] as string;
    }
    // For resources, the URI itself might be the widget location
    if (
      !openaiOutputTemplate &&
      result.uri &&
      result.uri.startsWith("ui://widget/")
    ) {
      openaiOutputTemplate = result.uri;
    }
  }

  const hasOpenAIComponent = !!(
    openaiAnnotations.length > 0 &&
    openaiOutputTemplate &&
    typeof openaiOutputTemplate === "string" &&
    serverId &&
    readResource
  );

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

  // Detect widget protocol (Priority: MCP Apps → Apps SDK → MCP-UI)
  const widgetProtocol = detectWidgetProtocol(
    combinedAnnotations,
    result?.result
  );

  // Check for MCP Apps (SEP-1865)
  // For resources, check if the resource itself is an MCP App by mimeType
  const isMcpAppResource =
    result?.result &&
    "contents" in result.result &&
    Array.isArray(result.result.contents) &&
    result.result.contents.some(
      (item: any) => item.mimeType === "text/html;profile=mcp-app"
    );

  // Resource URI can come from metadata (for tool results) or be the resource URI itself (for resources)
  const mcpAppsResourceUri =
    (combinedAnnotations as any)?.ui?.resourceUri ||
    (contentMetadata as any)?.ui?.resourceUri ||
    (isMcpAppResource ? result.uri : undefined);

  const hasMcpAppsResource =
    (widgetProtocol === "mcp-apps" || isMcpAppResource) && !!mcpAppsResourceUri;

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

  // Check if we have MCP UI resources
  const hasMcpUIResources =
    result?.result &&
    "contents" in result.result &&
    Array.isArray(result.result.contents) &&
    result.result.contents.some(
      (item: any) => item.mimeType && isMcpUIResource(item)
    );

  const mcpUIResources =
    hasMcpUIResources &&
    result.result &&
    "contents" in result.result &&
    Array.isArray(result.result.contents)
      ? result.result.contents.filter(
          (item: any) => item.mimeType && isMcpUIResource(item)
        )
      : [];

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
          {hasMcpUIResources && (
            <Badge
              variant="outline"
              className="text-xs bg-purple-50 dark:bg-purple-900/20 border-none border-purple-200 dark:border-purple-800/50 text-purple-600 dark:text-purple-400"
            >
              MCP UI
            </Badge>
          )}
          {hasMcpAppsResource && (
            <Badge
              variant="outline"
              className="text-xs bg-green-50 dark:bg-green-900/20 border-none border-green-200 dark:border-green-800/50 text-green-600 dark:text-green-400"
            >
              MCP Apps
            </Badge>
          )}
          {hasOpenAIComponent && (
            <Badge
              variant="outline"
              className="text-xs bg-blue-50 dark:bg-blue-900/20 border-none border-blue-200 dark:border-blue-800/50 text-blue-600 dark:text-blue-400"
            >
              OpenAI Widget
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(hasMcpAppsResource || hasMcpUIResources || hasOpenAIComponent) && (
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
              {previewMode
                ? "JSON"
                : hasOpenAIComponent
                  ? "Component"
                  : "Preview"}
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
          // Priority 1: Handle MCP Apps (SEP-1865)
          if (
            hasMcpAppsResource &&
            serverId &&
            readResource &&
            mcpAppsResourceUri
          ) {
            if (previewMode) {
              // MCP Apps mode
              return (
                <div className="flex-1 h-full relative">
                  {/* Floating controls in top-right */}
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
                    <MCPAppsDebugControls
                      toolCallId={`resource-${result.timestamp}`}
                      displayMode="inline"
                      onDisplayModeChange={(mode) => {
                        console.log("Display mode change:", mode);
                        // Display mode changes are handled by MCPAppsRenderer internally
                      }}
                      propsContext="resource"
                      resourceUri={result.uri}
                      resourceAnnotations={combinedAnnotations}
                      llmConfig={llmConfig || null}
                      resource={selectedResource || null}
                      onPropsChange={setActiveProps}
                    />
                  </div>

                  <MCPAppsRenderer
                    serverId={serverId}
                    toolCallId={`resource-${result.timestamp}`}
                    toolName={result.uri}
                    toolInput={{}}
                    toolOutput={result.result}
                    toolMetadata={combinedAnnotations}
                    resourceUri={mcpAppsResourceUri}
                    readResource={readResource}
                    className="w-full h-full relative flex p-4"
                  />
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

          // Priority 2: Handle OpenAI Apps SDK components
          if (
            hasOpenAIComponent &&
            serverId &&
            readResource &&
            openaiOutputTemplate
          ) {
            if (previewMode) {
              // OpenAI Apps SDK Component mode
              return (
                <div className="flex-1 h-full">
                  <OpenAIComponentRenderer
                    componentUrl={openaiOutputTemplate}
                    toolName={result.uri}
                    toolArgs={{}}
                    toolResult={result.result}
                    serverId={serverId}
                    readResource={readResource}
                    className="w-full h-full relative flex p-4"
                    customProps={activeProps || undefined}
                  />
                </div>
              );
            } else {
              // JSON mode for Apps SDK resources
              return (
                <div className="px-4 pt-4" data-testid="resource-result-json">
                  <JSONDisplay
                    data={result.result}
                    filename={`resource-${result.uri.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.json`}
                  />
                </div>
              );
            }
          }

          if (hasMcpUIResources) {
            if (previewMode) {
              return (
                <div className="space-y-0 h-full">
                  {mcpUIResources.map((resource: any, _idx: number) => (
                    <div
                      key={`mcp-ui-${
                        resource.uri ||
                        `resource-${Date.now()}-${Math.random()}`
                      }`}
                      className="mx-0 size-full"
                    >
                      <div className="w-full h-full">
                        <McpUIRenderer
                          resource={resource}
                          // onUIAction={handleUIAction}
                          className="w-full h-full"
                          customProps={activeProps || undefined}
                        />
                      </div>
                    </div>
                  ))}
                  {/* Show JSON for non-UI content */}
                  {(() => {
                    if (
                      result.result &&
                      "contents" in result.result &&
                      Array.isArray(result.result.contents)
                    ) {
                      const nonUIResources = result.result.contents.filter(
                        (item: any) => !(item.mimeType && isMcpUIResource(item))
                      );
                      if (nonUIResources.length > 0) {
                        return (
                          <div className="px-4">
                            <JSONDisplay
                              data={nonUIResources}
                              filename={`resource-${result.uri.replace(/[^a-zA-Z0-9]/g, "-")}-non-ui-${Date.now()}.json`}
                            />
                          </div>
                        );
                      }
                    }
                    return null;
                  })()}
                </div>
              );
            } else {
              // JSON mode for MCP UI resources
              return (
                <div className="px-4 pt-4" data-testid="resource-result-json">
                  <JSONDisplay
                    data={result.result}
                    filename={`resource-${result.uri.replace(/[^a-zA-Z0-9]/g, "-")}-mcp-ui-${Date.now()}.json`}
                  />
                </div>
              );
            }
          }

          // Default: show JSON for non-MCP UI resources
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
