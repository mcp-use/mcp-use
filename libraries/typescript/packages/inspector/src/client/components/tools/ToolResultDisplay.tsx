import { Check, Clock, Copy, Zap } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { isMcpUIResource, McpUIRenderer } from "../McpUIRenderer";
import { OpenAIComponentRenderer } from "../OpenAIComponentRenderer";
import { NotFound } from "../ui/not-found";
import { JSONDisplay } from "../shared/JSONDisplay";

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
}

export function ToolResultDisplay({
  results,
  copiedResult,
  previewMode,
  serverId,
  readResource,
  onCopy,
  onTogglePreview,
}: ToolResultDisplayProps) {

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border-t dark:border-zinc-700">
      <div className="flex-1 overflow-y-auto h-full">
        {results.length > 0 ? (
          <div className="space-y-4 flex-1 h-full">
            {results.map((result, index) => {
              // Check tool metadata for Apps SDK component (from tool definition)
              const openaiOutputTemplate =
                result.toolMeta?.["openai/outputTemplate"];
              const hasAppsSdkResource = !!(
                openaiOutputTemplate &&
                typeof openaiOutputTemplate === "string" &&
                result.appsSdkResource
              );
              const appsSdkUri = openaiOutputTemplate;

              // Check if result contains MCP UI resources
              const content = result.result?.content || [];
              const mcpUIResources = content.filter(
                (item: any) =>
                  item.type === "resource" && isMcpUIResource(item.resource)
              );
              const hasMcpUIResources = mcpUIResources.length > 0;

              return (
                <div
                  key={index}
                  className="space-y-0 flex-1 h-full flex flex-col"
                >
                  <div
                    className={`flex items-center gap-2 px-4 pt-2 ${
                      hasMcpUIResources || hasAppsSdkResource
                        ? "border-b border-gray-200 dark:border-zinc-600 pb-2"
                        : ""
                    }`}
                  >
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
                    {hasAppsSdkResource && (
                      <div className="flex items-center gap-4 ml-4">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
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
                      <div className="flex items-center gap-4 ml-4">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCopy(index, result.result)}
                      className="ml-auto"
                    >
                      {copiedResult === index ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {result.error ? (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mx-4">
                      <p className="text-red-800 dark:text-red-300 font-medium">
                        Error:
                      </p>
                      <p className="text-red-700 dark:text-red-400 text-sm">
                        {result.error}
                      </p>
                    </div>
                  ) : (
                    (() => {
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
                                toolArgs={result.args}
                                toolResult={result.result}
                                resource={appsSdk.resourceData}
                                serverId={serverId}
                                readResource={readResource}
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
                      return (
                        <div className="px-4 pt-4">
                          <JSONDisplay
                            data={result.result}
                            filename={`tool-result-${result.toolName}-${Date.now()}.json`}
                          />
                        </div>
                      );
                    })()
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
