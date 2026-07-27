import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { cn } from "@/client/lib/utils";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquareText,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import type { Message } from "./types";

interface FullscreenChatOverlayProps {
  messages: Message[];
  inputValue: string;
  isConnected: boolean;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onStopStreaming: () => void;
}

function useMcpWidgetFullscreen(): boolean {
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
  inputValue,
  isConnected,
  isLoading,
  onInputChange,
  onSendMessage,
  onStopStreaming,
}: FullscreenChatOverlayProps) {
  const isFullscreen = useMcpWidgetFullscreen();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const canSend = inputValue.trim().length > 0;

  useEffect(() => {
    if (!isFullscreen) setDrawerOpen(false);
  }, [isFullscreen]);

  useEffect(() => {
    if (drawerOpen) {
      transcriptEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [drawerOpen, messages]);

  if (!isFullscreen) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[230] px-3 pb-3 sm:px-5 sm:pb-5"
      data-testid="fullscreen-chat-overlay"
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2">
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
            />
          </section>
        )}

        <button
          type="button"
          className="flex h-9 items-center gap-2 self-end rounded-full border border-border/80 bg-background/95 px-3 text-sm font-medium text-foreground shadow-lg backdrop-blur-xl transition-colors hover:bg-muted"
          aria-expanded={drawerOpen}
          aria-controls="fullscreen-chat-drawer"
          onClick={() => setDrawerOpen((open) => !open)}
          data-testid="fullscreen-chat-drawer-toggle"
        >
          <MessageSquareText className="size-4" />
          <span>Chat</span>
          <span className="text-xs text-muted-foreground">
            {messages.length}
          </span>
          {drawerOpen ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronUp className="size-4" />
          )}
        </button>

        <div className="flex items-end gap-2 rounded-2xl border border-border/80 bg-background/95 p-2 shadow-2xl backdrop-blur-xl">
          <Textarea
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSendMessage();
              }
            }}
            placeholder={
              isConnected
                ? "Ask a question or request an action…"
                : "Server not connected"
            }
            rows={1}
            disabled={!isConnected || isLoading}
            className="min-h-10 max-h-32 resize-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0"
            data-testid="fullscreen-chat-input"
          />
          <Button
            type="button"
            size="icon"
            className={cn(
              "size-10 shrink-0 rounded-full",
              isLoading && "animate-spin",
              !canSend && !isLoading && "bg-zinc-400"
            )}
            disabled={!isLoading && (!canSend || !isConnected)}
            title={isLoading ? "Stop streaming" : "Send"}
            aria-label={isLoading ? "Stop streaming" : "Send message"}
            onClick={isLoading ? onStopStreaming : onSendMessage}
            data-testid="fullscreen-chat-send-button"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
