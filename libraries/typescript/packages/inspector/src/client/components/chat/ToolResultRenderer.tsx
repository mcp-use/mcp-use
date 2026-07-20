import { isViewTool } from "@mcp-use/client/react";
import type { ViewDisplayMode } from "@mcp-use/client/react";
import { useMemo, useState } from "react";
import type { MessageContentBlock } from "@/client/types/message-content-block";
import { McpAppsViewPanel } from "@/client/components/mcp-apps/McpAppsViewPanel";
import { useWidgetDebug } from "../../context/WidgetDebugContext";
import { Spinner } from "../ui/spinner";

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
  partialToolArgs?: Record<string, unknown>;
  cancelled?: boolean;
}

export function ToolResultRenderer({
  toolName,
  toolArgs,
  result,
  serverId,
  readResource,
  toolMeta,
  onSendFollowUp,
  partialToolArgs,
  cancelled,
}: ToolResultRendererProps) {
  const toolCallId = useMemo(
    () =>
      `chat-tool-${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    [toolName]
  );

  const [displayMode, setDisplayMode] = useState<ViewDisplayMode>("inline");

  const parsedResult = useMemo(() => {
    if (!result) return null;
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    }
    return result;
  }, [result]);

  const isMcpAppsTool = isViewTool(toolMeta);
  const resourceUri = isMcpAppsTool
    ? ((toolMeta?.ui?.resourceUri as string | undefined) ?? null)
    : null;

  const memoizedToolArgs = useMemo(() => toolArgs, [toolName, parsedResult]);
  const memoizedResult = useMemo(() => parsedResult, [toolName, parsedResult]);

  if (isMcpAppsTool && resourceUri && serverId && readResource) {
    return (
      <>
        <McpAppsViewPanel
          serverId={serverId}
          viewId={toolCallId}
          toolName={toolName}
          resourceUri={resourceUri}
          toolInput={memoizedToolArgs}
          toolOutput={memoizedResult}
          toolMetadata={toolMeta}
          readResource={readResource}
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          onSendFollowUp={onSendFollowUp}
          partialToolInput={partialToolArgs}
          cancelled={cancelled}
          noWrapper
          className="my-4"
        />
        <ModelContextBadge widgetId={toolCallId} />
      </>
    );
  }

  if (isMcpAppsTool && !resourceUri) {
    return (
      <div className="flex items-center justify-center w-full h-[200px] rounded border">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (isMcpAppsTool && (!serverId || !readResource)) {
    return (
      <div className="my-4 p-4 bg-red-50/30 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/50 rounded-lg">
        <p className="text-sm text-red-600 dark:text-red-400">
          Cannot render widget: Missing required props (serverId or
          readResource)
        </p>
      </div>
    );
  }

  return null;
}
