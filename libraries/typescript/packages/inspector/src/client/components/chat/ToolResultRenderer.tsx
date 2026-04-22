import { useEffect, useMemo, useRef, useState } from "react";
import type { MessageContentBlock } from "mcp-use/react";
import { useWidgetDebug } from "../../context/WidgetDebugContext";
import {
  detectWidgetProtocol,
} from "../../utils/widget-detection";
import { MCPAppsRenderer } from "../MCPAppsRenderer";
import { Spinner } from "../ui/spinner";
import { MCPUIResource } from "./MCPUIResource";

function ModelContextBadge({ widgetId }: { widgetId: string }) {
  const { getWidget } = useWidgetDebug();
  const widget = getWidget(widgetId);
  const ctx = widget?.modelContext;
  if (!ctx?.content?.length && !ctx?.structuredContent) return null;
  const preview =
    ctx.content?.map((c: any) => c.text).join(" ") ??
    JSON.stringify(ctx.structuredContent).slice(0, 80);
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/30 border border-border/40 rounded-md mt-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
      <span className="font-medium">State synced to model</span>
      <span className="truncate opacity-60 max-w-[300px]">{preview}</span>
    </div>
  );
}

interface ToolResultRendererProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
  result: any;
  serverId?: string;
  readResource?: (uri: string) => Promise<any>;
  toolMeta?: Record<string, any>;
  onSendFollowUp?: (content: MessageContentBlock[]) => void;
  /** When provided, passed to widget renderers to avoid useMcpClient() context lookup. */
  serverBaseUrl?: string;
  /** Partial/streaming tool arguments (forwarded to widget as partialToolInput) */
  partialToolArgs?: Record<string, unknown>;
  /** Whether this tool execution was cancelled by the user */
  cancelled?: boolean;
}

/**
 * Renders tool results - handles MCP Apps components
 */
export function ToolResultRenderer({
  toolName,
  toolArgs,
  result,
  serverId,
  readResource,
  toolMeta,
  onSendFollowUp,
  serverBaseUrl,
  partialToolArgs,
  cancelled,
}: ToolResultRendererProps) {
  const [resourceData, setResourceData] = useState<any>(null);
  const fetchedUriRef = useRef<string | null>(null);

  // Generate stable toolCallId once
  const toolCallId = useMemo(
    () =>
      `chat-tool-${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    [toolName]
  );

  // Parse result if it's a JSON string (memoized to prevent re-renders)
  // Allow null/undefined results (tool hasn't completed yet)
  const parsedResult = useMemo(() => {
    if (!result) {
      return null;
    }

    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch (error) {
        console.error("[ToolResultRenderer] Failed to parse result:", error);
        return result;
      }
    }
    return result;
  }, [result]);

  // Detect widget protocol - use JSON.stringify for stable comparison
  const toolMetaJson = useMemo(() => JSON.stringify(toolMeta), [toolMeta]);
  const widgetProtocol = useMemo(
    () => detectWidgetProtocol(toolMeta, parsedResult),
    [toolMetaJson, parsedResult]
  );

  // Detect if tool supports both protocols
  const supportsBothProtocols = false;

  // Determine active protocol
  const activeProtocol = widgetProtocol;

  // Check if this is an MCP Apps tool
  const isMcpAppsTool = useMemo(
    () => activeProtocol === "mcp-apps",
    [activeProtocol]
  );

  // Memoize toolArgs and parsedResult to prevent unnecessary re-renders in child renderers
  const memoizedToolArgs = useMemo(() => toolArgs, [toolName, parsedResult]);
  const memoizedResult = useMemo(() => parsedResult, [toolName, parsedResult]);

  // Calculate resource URI for MCP Apps
  const resourceUri = useMemo(() => {
    if (isMcpAppsTool) {
      return toolMeta?.ui?.resourceUri || null;
    }
    return null;
  }, [isMcpAppsTool, toolMetaJson]);

  // Fetch resource for MCP Apps tools
  useEffect(() => {
    // If we've already fetched this URI, skip
    if (resourceUri && fetchedUriRef.current === resourceUri) {
      return;
    }

    // Reset resource data if URI changed
    if (resourceUri !== fetchedUriRef.current) {
      setResourceData(null);
    }

    if (resourceUri && readResource) {
      fetchedUriRef.current = resourceUri;

      readResource(resourceUri)
        .then((data) => {
          // Extract the first resource from the contents array
          if (
            data?.contents &&
            Array.isArray(data.contents) &&
            data.contents.length > 0
          ) {
            setResourceData(data.contents[0]);
          }
        })
        .catch((error) => {
          console.error(
            "[ToolResultRenderer] Failed to fetch resource:",
            error
          );
          fetchedUriRef.current = null;
        });
    }
  }, [resourceUri, activeProtocol, readResource]);

  // Render toggle when both protocols are supported
  if (supportsBothProtocols && resourceData && serverId && readResource) {
    return (
      <div className="my-4">
        {activeProtocol === "mcp-apps" && (
          <MCPAppsRenderer
            serverId={serverId}
            toolCallId={toolCallId}
            toolName={toolName}
            toolInput={memoizedToolArgs}
            toolOutput={memoizedResult}
            toolMetadata={toolMeta}
            invoking={invokingText}
            invoked={invokedText}
            partialToolInput={partialToolArgs}
            resourceUri={resourceData.uri}
            readResource={readResource}
            noWrapper={true}
            onSendFollowUp={onSendFollowUp}
            serverBaseUrl={serverBaseUrl}
            cancelled={cancelled}
          />
        )}
      </div>
    );
  }

  // Render MCP Apps component (Priority 1)
  // Render immediately if we have resourceUri from metadata, even if resourceData is still loading
  if (isMcpAppsTool && resourceUri && serverId && readResource) {
    return (
      <>
        <MCPAppsRenderer
          serverId={serverId}
          toolCallId={toolCallId}
          toolName={toolName}
          toolInput={memoizedToolArgs}
          toolOutput={memoizedResult}
          toolMetadata={toolMeta}
          invoking={invokingText}
          invoked={invokedText}
          partialToolInput={partialToolArgs}
          resourceUri={resourceData?.uri || resourceUri}
          readResource={readResource}
          className="my-4"
          noWrapper={true}
          onSendFollowUp={onSendFollowUp}
          serverBaseUrl={serverBaseUrl}
        />
        <ModelContextBadge widgetId={toolCallId} />
      </>
    );
  }

  // Show loading state only if we don't have enough info to render
  if (isMcpAppsTool && !resourceUri) {
    return (
      <div className="flex items-center justify-center w-full h-[200px] rounded border">
        <Spinner className="size-5" />
      </div>
    );
  }

  // Show error if MCP Apps tool but missing serverId or readResource
  if (isMcpAppsTool && (!serverId || !readResource)) {
    console.error(
      "[ToolResultRenderer] MCP Apps tool but missing serverId or readResource:",
      {
        toolName,
        hasServerId: !!serverId,
        hasReadResource: !!readResource,
      }
    );
    return (
      <div className="my-4 p-4 bg-red-50/30 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/50 rounded-lg">
        <p className="text-sm text-red-600 dark:text-red-400">
          Cannot render widget: Missing required props (serverId or
          readResource)
        </p>
      </div>
    );
  }

  // Extract and render MCP-UI resources
  const mcpUIResources: any[] = [];
  if (parsedResult?.content && Array.isArray(parsedResult.content)) {
    for (const item of parsedResult.content) {
      if (
        item.type === "resource" &&
        item.resource?.uri?.startsWith("ui://")
      ) {
        mcpUIResources.push(item.resource);
      }
    }
  }

  if (mcpUIResources.length > 0) {
    return (
      <>
        {mcpUIResources.map((resource) => (
          <MCPUIResource
            key={`${toolName}-mcp-ui-${resource.uri}`}
            resource={resource}
          />
        ))}
      </>
    );
  }

  // Debug: Log when we're not rendering anything
  console.log("[ToolResultRenderer] Not rendering (no UI resources found):", {
    toolName,
    isMcpAppsTool,
    hasResourceData: !!resourceData,
    contentLength: parsedResult?.content?.length,
  });

  return null;
}
