import { ViewRenderer } from "@mcp-use/client/react";
import type {
  ViewDisplayMode,
  ViewLifecycleEvent,
  ViewRendererProps,
} from "@mcp-use/client/react";
import { useViewHostProps } from "@/client/hooks/useViewHostProps";
import type { MessageContentBlock } from "@/client/types/message-content-block";
import { WidgetWrapper } from "@/client/components/ui/WidgetWrapper";
import { cn } from "@/client/lib/utils";
import { useCallback, useEffect, useState } from "react";
import type { LLMConfig } from "@/client/components/chat/types";
import { Spinner } from "@/client/components/ui/spinner";

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
  const propsRenderKey = customProps
    ? JSON.stringify(customProps)
    : "no-custom-props";
  const [showHostSpinner, setShowHostSpinner] = useState(true);

  useEffect(() => {
    setShowHostSpinner(true);
  }, [propsRenderKey, resourceUri, viewId]);

  const onLifecycleChange = useCallback(
    (event: ViewLifecycleEvent) => {
      if (event.status === "sandbox-loading" || event.status === "error") {
        setShowHostSpinner(false);
      }
    },
    [viewId]
  );

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
    onLifecycleChange,
  });

  const loadingOverlay = showHostSpinner ? (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      data-testid="mcp-apps-loading-overlay"
    >
      <Spinner className="size-5" />
    </div>
  ) : null;

  const handleMessage = useCallback(
    (content: Parameters<NonNullable<ViewRendererProps["onMessage"]>>[0]) => {
      if (!onSendFollowUp) {
        throw new Error("Chat is not available on this host surface");
      }
      return onSendFollowUp(content as MessageContentBlock[]);
    },
    [onSendFollowUp]
  );

  if (!hostProps) {
    if (noWrapper) {
      return (
        <div className="relative flex h-full w-full min-h-0 flex-1 items-center justify-center">
          {loadingOverlay}
        </div>
      );
    }
    return (
      <WidgetWrapper className="w-full h-full min-h-[240px]">
        <div className="relative flex h-full w-full items-center justify-center">
          {loadingOverlay}
        </div>
      </WidgetWrapper>
    );
  }

  const viewRendererClassName = cn(
    displayMode === "inline"
      ? "w-full h-full flex items-center justify-center relative p-4 min-h-0"
      : "w-full h-full relative p-4",
    className
  );

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
      onInlineHeightChange={
        displayMode === "inline" ? onWidgetHeightChange : undefined
      }
      {...hostProps}
    />
  );

  if (noWrapper) {
    return (
      <div className="relative flex h-full w-full min-h-0 flex-1 flex-col">
        {view}
        {loadingOverlay}
      </div>
    );
  }

  return (
    <WidgetWrapper className="w-full h-full min-h-[240px]">
      <div className="relative flex h-full w-full flex-col">
        {view}
        {loadingOverlay}
      </div>
    </WidgetWrapper>
  );
}
