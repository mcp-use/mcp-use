import { ViewRenderer } from "@mcp-use/client/react";
import type {
  ViewDisplayMode,
  ViewLifecycleEvent,
  ViewRendererProps,
} from "@mcp-use/client/react";
import { useViewHostProps } from "@/client/hooks/useViewHostProps";
import type { MessageContentBlock } from "@/client/types/message-content-block";
import { WidgetWrapper } from "@/client/components/ui/WidgetWrapper";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { debugMcpApps } from "@/client/mcp-apps/debug";
import { useCallback, useEffect, useRef } from "react";
import type { LLMConfig } from "@/client/components/chat/types";

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
  llmConfig?: LLMConfig | null;
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
  llmConfig,
  onWidgetHeightChange,
  partialToolInput,
  cancelled,
  noWrapper = false,
  className,
}: McpAppsViewPanelProps) {
  const instanceIdRef = useRef(
    `view-panel-${Math.random().toString(36).substring(2, 9)}`
  );
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
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
    llmConfig,
  });

  debugMcpApps("view-panel-render", {
    instanceId: instanceIdRef.current,
    renderCount: renderCountRef.current,
    viewId,
    toolName,
    hasHostProps: Boolean(hostProps),
    hasMessageHandler: Boolean(onSendFollowUp),
    hasModelContextScope: Boolean(modelContextScope),
  });

  useEffect(() => {
    const instanceId = instanceIdRef.current;
    debugMcpApps("view-panel-mount", { instanceId, viewId, toolName });
    return () => {
      debugMcpApps("view-panel-unmount", { instanceId, viewId, toolName });
    };
  }, [toolName, viewId]);

  const handleMessage = useCallback(
    (content: Parameters<NonNullable<ViewRendererProps["onMessage"]>>[0]) => {
      debugMcpApps("view-message", {
        instanceId: instanceIdRef.current,
        viewId,
        blockCount: content.length,
      });
      if (!onSendFollowUp) {
        throw new Error("Chat is not available on this host surface");
      }
      return onSendFollowUp(content as MessageContentBlock[]);
    },
    [onSendFollowUp, viewId]
  );

  const handleLifecycleChange = useCallback(
    (event: ViewLifecycleEvent) => {
      debugMcpApps("view-lifecycle", {
        instanceId: instanceIdRef.current,
        viewId,
        status: event.status,
        ...("error" in event ? { error: event.error } : {}),
      });
    },
    [viewId]
  );

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
      onMessage={onSendFollowUp ? handleMessage : undefined}
      onLifecycleChange={handleLifecycleChange}
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
