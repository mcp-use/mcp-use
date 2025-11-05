import { useEffect, useMemo, useState } from "react";
import { OpenAIComponentRenderer } from "../OpenAIComponentRenderer";
import { MCPUIResource } from "./MCPUIResource";

interface ToolResultRendererProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
  result: any;
  serverId?: string;
  readResource?: (uri: string) => Promise<any>;
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
}: ToolResultRendererProps) {
  const [resourceData, setResourceData] = useState<any>(null);

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

  // Check if this is an OpenAI Apps SDK result with a component
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

  useEffect(() => {
    const updateResourceData = () => {
      if (extractedResource) {
        setResourceData(extractedResource);
      }
    };
    updateResourceData();
  }, [extractedResource]);

  // Render OpenAI Apps SDK component
  if (hasAppsSdkComponent && resourceData && serverId && readResource) {
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
      />
    );
  }

  // Show loading state
  if (hasAppsSdkComponent && !resourceData) {
    return (
      <div className="my-4 p-4 bg-blue-50/30 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/50 rounded-lg">
        <p className="text-sm text-blue-600 dark:text-blue-400">
          Loading component...
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

  return null;
}
