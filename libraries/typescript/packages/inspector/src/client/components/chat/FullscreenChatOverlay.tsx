import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import type { Message, ToolAuthenticationRequest } from "./types";
import type { McpServer } from "@mcp-use/client/react";

interface FullscreenChatOverlayProps {
  messages: Message[];
  isLoading: boolean;
  authorization?: McpServer["authorization"];
  onAuthenticateTool?: (request: ToolAuthenticationRequest) => Promise<void>;
  onRetryTool?: (request: ToolAuthenticationRequest) => Promise<void>;
  authenticatingTool?: boolean;
  retryingTool?: boolean;
}

export function useMcpWidgetFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setIsFullscreen(root.hasAttribute("data-mcp-widget-fullscreen"));

    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-mcp-widget-fullscreen"],
    });
    return () => observer.disconnect();
  }, []);

  return isFullscreen;
}

/**
 * Chat controls layered above a fullscreen MCP App. The transcript intentionally
 * omits MCP App result bodies so the active app is never recursively rendered
 * inside the drawer; normal text and tool-call details remain available.
 */
export function FullscreenChatOverlay({
  messages,
  isLoading,
  authorization,
  onAuthenticateTool,
  onRetryTool,
  authenticatingTool,
  retryingTool,
}: FullscreenChatOverlayProps) {
  const isFullscreen = useMcpWidgetFullscreen();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const latestUserMessageId = messages.reduce<string | null>(
    (latestId, message) => (message.role === "user" ? message.id : latestId),
    null
  );
  const latestUserMessageIdRef = useRef(latestUserMessageId);

  useEffect(() => {
    if (!isFullscreen) setDrawerOpen(false);
  }, [isFullscreen]);

  useEffect(() => {
    const previousUserMessageId = latestUserMessageIdRef.current;
    latestUserMessageIdRef.current = latestUserMessageId;
    if (
      isFullscreen &&
      latestUserMessageId !== null &&
      latestUserMessageId !== previousUserMessageId
    ) {
      setDrawerOpen(true);
    }
  }, [isFullscreen, latestUserMessageId]);

  useEffect(() => {
    if (drawerOpen) {
      transcriptEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [drawerOpen, messages]);

  if (!isFullscreen) return null;

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-2 pb-2 sm:px-4"
      data-testid="fullscreen-chat-overlay"
    >
      {drawerOpen && (
        <section
          id="fullscreen-chat-drawer"
          className="max-h-[46vh] overflow-y-auto overscroll-contain rounded-2xl border border-border/80 bg-background/95 px-2 py-4 shadow-2xl backdrop-blur-xl sm:px-4"
          aria-label="Current chat messages"
          data-testid="fullscreen-chat-drawer"
        >
          <MessageList
            messages={messages}
            isLoading={isLoading}
            messagesEndRef={transcriptEndRef}
            renderToolResults={false}
            authorization={authorization}
            onAuthenticateTool={onAuthenticateTool}
            onRetryTool={onRetryTool}
            authenticatingTool={authenticatingTool}
            retryingTool={retryingTool}
          />
        </section>
      )}

      <button
        type="button"
        className="grid size-9 place-items-center self-center rounded-full border border-border/80 bg-background/95 text-foreground shadow-lg backdrop-blur-xl transition-colors hover:bg-muted"
        aria-label={drawerOpen ? "Hide chat messages" : "Show chat messages"}
        aria-expanded={drawerOpen}
        aria-controls="fullscreen-chat-drawer"
        onClick={() => setDrawerOpen((open) => !open)}
        data-testid="fullscreen-chat-drawer-toggle"
      >
        {drawerOpen ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronUp className="size-4" />
        )}
      </button>
    </div>
  );
}
