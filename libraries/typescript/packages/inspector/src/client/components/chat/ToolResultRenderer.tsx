import { useEffect, useMemo, useState } from "react";
import { OpenAIComponentRenderer } from "../OpenAIComponentRenderer";
import { MCPUIResource } from "./MCPUIResource";
import { Spinner } from "../ui/spinner";

interface ToolResultRendererProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
  result: any;
  serverId?: string;
  readResource?: (uri: string) => Promise<any>;
  toolMeta?: Record<string, any>;
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
}: ToolResultRendererProps) {
  const [resourceData, setResourceData] = useState<any>(null);

  // Debug logging to understand the data flow
  useEffect(() => {
    console.log("[ToolResultRenderer] Rendering:", {
      toolName,
      hasToolMeta: !!toolMeta,
      outputTemplate: toolMeta?.["openai/outputTemplate"],
      hasResult: !!result,
      hasServerId: !!serverId,
      hasReadResource: !!readResource,
    });
  }, [toolName, toolMeta, result, serverId, readResource]);

  // Parse result if it's a JSON string (memoized to prevent re-renders)
  const parsedResult = useMemo(() => {
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

  // Check if this is an OpenAI Apps SDK tool by checking tool metadata
  // (The tool definition has openai/outputTemplate in its _meta)
  const isAppsSdkTool = useMemo(
    () => !!toolMeta?.["openai/outputTemplate"],
    [toolMeta]
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

  // Fetch resource for Apps SDK tools (when not embedded in result)
  useEffect(() => {
    // If resource is already embedded, use it
    if (extractedResource) {
      setResourceData(extractedResource);
      return;
    }

    // If this is an Apps SDK tool but resource isn't embedded, fetch it
    if (isAppsSdkTool && toolMeta && readResource) {
      const outputTemplateUri = toolMeta["openai/outputTemplate"] as string;
      console.log(
        "[ToolResultRenderer] Fetching resource for Apps SDK tool:",
        outputTemplateUri
      );

      readResource(outputTemplateUri)
        .then((data) => {
          console.log("[ToolResultRenderer] Resource fetched:", data);
          // Extract the first resource from the contents array
          if (
            data?.contents &&
            Array.isArray(data.contents) &&
            data.contents.length > 0
          ) {
            setResourceData(data.contents[0]);
          } else {
            console.warn(
              "[ToolResultRenderer] No contents in fetched resource:",
              data
            );
          }
        })
        .catch((error) => {
          console.error(
            "[ToolResultRenderer] Failed to fetch resource:",
            error
          );
        });
    }
  }, [extractedResource, isAppsSdkTool, toolMeta, readResource]);

  // Render OpenAI Apps SDK component
  if (
    (isAppsSdkTool || hasAppsSdkComponent) &&
    resourceData &&
    serverId &&
    readResource
  ) {
    return (
      <OpenAIComponentRenderer
        componentUrl={resourceData.uri}
        toolName={toolName}
        toolArgs={toolArgs}
        toolResult={parsedResult}
        serverId={serverId}
        readResource={readResource}
        noWrapper={true}
        className="my-4"
        showConsole={false}
      />
    );
  }

  // Show loading state for Apps SDK tools
  if ((isAppsSdkTool || hasAppsSdkComponent) && !resourceData) {
    return (
      <div className="flex items-center justify-center w-full h-[200px] rounded border">
        <Spinner className="size-5" />
      </div>
    );
  }

  // Show error if Apps SDK tool but missing serverId or readResource
  if (isAppsSdkTool && (!serverId || !readResource)) {
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
