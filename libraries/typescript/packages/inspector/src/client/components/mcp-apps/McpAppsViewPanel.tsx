import { ViewRenderer } from "@mcp-use/client/react";
import type { ViewDisplayMode } from "@mcp-use/client/react";
import { useViewHostProps } from "@/client/hooks/useViewHostProps";
import type { MessageContentBlock } from "@/client/types/message-content-block";
import { WidgetWrapper } from "@/client/components/ui/WidgetWrapper";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";

const CHAT_MESSAGE_CAPABILITIES = { text: {}, image: {} } as const;

export interface McpAppsViewPanelProps {
  serverId: string;
  viewId: string;
  toolName: string;
  resourceUri: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  toolMetadata?: Record<string, unknown>;
  readResource: (uri: string) => Promise<unknown>;
  customProps?: Record<string, string>;
  displayMode: ViewDisplayMode;
  onDisplayModeChange: (mode: ViewDisplayMode) => void;
  onSendFollowUp?: (content: MessageContentBlock[]) => Promise<void>;
  modelContextScope?: string;
  onWidgetHeightChange?: (height: number) => void;
  partialToolInput?: Record<string, unknown>;
  cancelled?: boolean;
  /** Skip WidgetWrapper; fill parent flex height (tools maximize / chat). */
  noWrapper?: boolean;
  /** Extra class on the ViewRenderer root (e.g. chat `my-4`). */
  className?: string;
}

/**
 * Shared MCP Apps host for tools tab + chat — one place for displayMode,
 * ViewRenderer classNames, and useViewHostProps wiring.
 */
export function McpAppsViewPanel({
  serverId,
  viewId,
  toolName,
  resourceUri,
  toolInput,
  toolOutput,
  toolMetadata,
  readResource,
  customProps,
  displayMode,
  onDisplayModeChange,
  onSendFollowUp,
  modelContextScope,
  onWidgetHeightChange,
  partialToolInput,
  cancelled,
  noWrapper = false,
  className,
}: McpAppsViewPanelProps) {
  const hostProps = useViewHostProps({
    serverId,
    viewId,
    resourceUri,
    toolName,
    toolInput,
    toolOutput,
    toolMetadata,
    readResource,
    displayMode,
    onDisplayModeChange,
    modelContextScope,
  });

  if (!hostProps) {
    const loading = <Spinner className="size-5" />;
    if (noWrapper) {
      return (
        <div className="flex h-full w-full min-h-0 flex-1 items-center justify-center">
          {loading}
        </div>
      );
    }
    return (
      <WidgetWrapper className="w-full h-full min-h-[240px]">
        {loading}
      </WidgetWrapper>
    );
  }

  const viewRendererClassName = cn(
    displayMode === "inline"
      ? "w-full h-full flex items-center justify-center relative p-4 min-h-0"
      : "w-full h-full relative p-4",
    className
  );

  const propsRenderKey = customProps
    ? JSON.stringify(customProps)
    : "no-custom-props";

  const view = (
    <ViewRenderer
      key={propsRenderKey}
      viewId={viewId}
      toolName={toolName}
      toolInput={toolInput}
      toolOutput={toolOutput}
      customProps={customProps}
      partialToolInput={partialToolInput}
      cancelled={cancelled}
      className={viewRendererClassName}
      messageCapabilities={
        onSendFollowUp ? CHAT_MESSAGE_CAPABILITIES : undefined
      }
      onMessage={
        onSendFollowUp
          ? (content) => onSendFollowUp(content as MessageContentBlock[])
          : undefined
      }
      onInlineHeightChange={
        displayMode === "inline" ? onWidgetHeightChange : undefined
      }
      {...hostProps}
    />
  );

  if (noWrapper) {
    return (
      <div className="flex h-full w-full min-h-0 flex-1 flex-col">{view}</div>
    );
  }

  return (
    <WidgetWrapper className="w-full h-full min-h-[240px]">
      {view}
    </WidgetWrapper>
  );
}
