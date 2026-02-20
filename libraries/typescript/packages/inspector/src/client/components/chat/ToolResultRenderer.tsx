import { useEffect, useMemo, useRef, useState } from "react";
import { useWidgetDebug } from "../../context/WidgetDebugContext";
import {
  detectWidgetProtocol,
  getResourceUriForProtocol,
  hasBothProtocols,
} from "../../utils/widget-detection";
import { MCPAppsRenderer } from "../MCPAppsRenderer";
import { OpenAIComponentRenderer } from "../OpenAIComponentRenderer";
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
  onSendFollowUp?: (text: string) => void;
  /** When provided, passed to widget renderers to avoid useMcpClient() context lookup. */
  serverBaseUrl?: string;
  /** Partial/streaming tool arguments (forwarded to widget as partialToolInput) */
  partialToolArgs?: Record<string, unknown>;
  /** Whether this tool execution was cancelled by the user */
  cancelled?: boolean;
}

/**
 * Renders tool results - handles both OpenAI Apps SDK components and MCP-UI resources
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
  const { playground } = useWidgetDebug();
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
  const supportsBothProtocols = useMemo(
    () => hasBothProtocols(toolMeta),
    [toolMetaJson]
  );

  // Determine active protocol based on toggle state
  const activeProtocol = useMemo(() => {
    if (!widgetProtocol) return null;

    if (widgetProtocol === "both") {
      // User has selected a protocol via toggle
      if (playground.selectedProtocol) {
        return playground.selectedProtocol;
      }
      // Default to MCP Apps when both exist (same as current priority)
      return "mcp-apps";
    }

    return widgetProtocol;
  }, [widgetProtocol, playground.selectedProtocol]);

  // Check if this is an MCP Apps tool
  const isMcpAppsTool = useMemo(
    () => activeProtocol === "mcp-apps",
    [activeProtocol]
  );

  // Check if this is an OpenAI Apps SDK tool
  const isAppsSdkTool = useMemo(
    () => activeProtocol === "chatgpt-app",
    [activeProtocol]
  );

  // Check if the result content has the Apps SDK resource embedded
  const hasAppsSdkComponent = useMemo(
    () =>
      !!(
        parsedResult?.content &&
        Array.isArray(parsedResult.content) &&
        parsedResult.content.some(
          (item: any) =>
            item.type === "resource" &&
            item.resource?.uri?.startsWith("ui://") &&
            item.resource?.mimeType === "text/html+skybridge"
        )
      ),
    [parsedResult]
  );

  // Extract resource data when component is detected
  const extractedResource = useMemo(() => {
    if (hasAppsSdkComponent) {
      const resourceItem = parsedResult.content.find(
        (item: any) =>
          item.type === "resource" &&
          item.resource?.uri?.startsWith("ui://") &&
          item.resource?.mimeType === "text/html+skybridge"
      );
      return resourceItem?.resource || null;
    }
    return null;
  }, [hasAppsSdkComponent, parsedResult]);

  // Memoize toolArgs and parsedResult to prevent unnecessary re-renders in child renderers
  // (same pattern as ToolResultDisplay - stabilizes refs so effects don't re-run on parent re-renders)
  const memoizedToolArgs = useMemo(() => toolArgs, [toolName, parsedResult]);
  const memoizedResult = useMemo(() => parsedResult, [toolName, parsedResult]);

  // Calculate resource URI outside of effect for stable dependency
  const resourceUri = useMemo(() => {
    if (supportsBothProtocols && activeProtocol) {
      return getResourceUriForProtocol(activeProtocol as any, toolMeta);
    } else if (isMcpAppsTool) {
      return toolMeta?.ui?.resourceUri || null;
    } else if (isAppsSdkTool) {
      return toolMeta?.["openai/outputTemplate"] || null;
    }
    return null;
  }, [
    supportsBothProtocols,
    activeProtocol,
    isMcpAppsTool,
    isAppsSdkTool,
    toolMetaJson,
  ]);

  // Fetch resource for Apps SDK tools (when not embedded in result)
  useEffect(() => {
    // If resource is already embedded, use it
    if (extractedResource) {
      setResourceData(extractedResource);
      fetchedUriRef.current = extractedResource.uri || null;
      return;
    }

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
  }, [extractedResource, resourceUri, activeProtocol, readResource]);

  const invokingText = toolMeta?.["openai/toolInvocation/invoking"] as
    | string
    | undefined;
  const invokedText = toolMeta?.["openai/toolInvocation/invoked"] as
    | string
    | undefined;

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

        {activeProtocol === "chatgpt-app" && (
          <OpenAIComponentRenderer
            componentUrl={resourceData.uri}
            toolName={toolName}
            toolArgs={memoizedToolArgs}
            toolResult={memoizedResult}
            serverId={serverId}
            readResource={readResource}
            noWrapper={true}
            showConsole={false}
            invoking={invokingText}
            invoked={invokedText}
            serverBaseUrl={serverBaseUrl}
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

  // Render OpenAI Apps SDK component (Priority 2)
  // Render immediately if we have resourceUri from metadata, even if resourceData is still loading
  if (
    (isAppsSdkTool || hasAppsSdkComponent) &&
    resourceUri &&
    serverId &&
    readResource
  ) {
    return (
      <OpenAIComponentRenderer
        componentUrl={resourceData?.uri || resourceUri}
        toolName={toolName}
        toolArgs={memoizedToolArgs}
        toolResult={memoizedResult}
        serverId={serverId}
        readResource={readResource}
        noWrapper={true}
        className="my-4"
        showConsole={false}
        invoking={invokingText}
        invoked={invokedText}
        serverBaseUrl={serverBaseUrl}
      />
    );
  }

  // Show loading state only if we don't have enough info to render
  if ((isMcpAppsTool || isAppsSdkTool || hasAppsSdkComponent) && !resourceUri) {
    return (
      <div className="flex items-center justify-center w-full h-[200px] rounded border">
        <Spinner className="size-5" />
      </div>
    );
  }

  // Show error if MCP Apps or Apps SDK tool but missing serverId or readResource
  if ((isMcpAppsTool || isAppsSdkTool) && (!serverId || !readResource)) {
    console.error(
      "[ToolResultRenderer] Apps SDK tool but missing serverId or readResource:",
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

  // Extract and render MCP-UI resources (non-Apps SDK)
  const mcpUIResources: any[] = [];
  if (parsedResult?.content && Array.isArray(parsedResult.content)) {
    for (const item of parsedResult.content) {
      if (
        item.type === "resource" &&
        item.resource?.uri?.startsWith("ui://") &&
        item.resource?.mimeType !== "text/html+skybridge" // Not Apps SDK
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
    isAppsSdkTool,
    hasAppsSdkComponent,
    hasResourceData: !!resourceData,
    contentLength: parsedResult?.content?.length,
  });

  return null;
}
