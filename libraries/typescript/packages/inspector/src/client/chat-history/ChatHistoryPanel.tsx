import { cn } from "@/client/lib/utils";
import { ScrollArea } from "@/client/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/client/components/ui/sheet";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { ChatHistoryHeader } from "./ChatHistoryHeader";
import { ChatList } from "./ChatList";
import type { ChatStorageProvider } from "./types";
import { useChatHistory } from "./useChatHistory";

interface ChatHistoryPanelProps {
  provider: ChatStorageProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentChatId?: string;
  container?: HTMLElement | null;
  agentId?: string;
  /** When agent relation is denied (e.g. server chat agents), use this for display instead of "Unknown Agent" */
  agentDisplayNameFallback?: string;
  /** Called on chat selection; panel closes when provided */
  onSelectChat?: (chatId: string) => void;
  /** "drawer" = Sheet overlay (default). "inline" = content only, no overlay; parent controls layout */
  variant?: "drawer" | "inline";
  /** Optional class for the inline panel container */
  containerClassName?: string;
  /** When this value changes, triggers an immediate refetch of the chat list */
  refetchKey?: number;
  /** Poll interval in ms when set (e.g. server chat) */
  refetchInterval?: number | false;
  /** Called when the currently active chat is deleted */
  onCurrentChatDeleted?: () => void;
  onDeleteSuccess?: () => void;
  onDeleteError?: (error: unknown) => void;
}

export function ChatHistoryPanel({
  provider,
  open,
  onOpenChange,
  currentChatId,
  container,
  agentId,
  agentDisplayNameFallback,
  onSelectChat,
  variant = "drawer",
  containerClassName,
  refetchKey,
  refetchInterval = false,
  onCurrentChatDeleted,
  onDeleteSuccess,
  onDeleteError,
}: ChatHistoryPanelProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const {
    chats: chatsWithAgents,
    isLoading,
    hasNextPage,
    loadMore,
    deleteChat,
  } = useChatHistory({
    provider,
    enabled: open,
    agentId,
    refetchKey,
    refetchInterval: agentDisplayNameFallback ? (refetchInterval || 3000) : refetchInterval,
  });

  useEffect(() => {
    if (!open || !loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [open, hasNextPage, isLoading, loadMore]);

  const handleDelete = async (chatId: string) => {
    try {
      await deleteChat(chatId);
      onDeleteSuccess?.();
      if (chatId === currentChatId) {
        onCurrentChatDeleted?.();
      }
    } catch (error) {
      console.error("Failed to delete chat:", error);
      onDeleteError?.(error);
    }
  };

  const chatSessions = chatsWithAgents.map((chat) => ({
    ...chat,
    title: chat.title || "New Chat",
    agent_name: chat.agent_name ?? agentDisplayNameFallback ?? "Unknown Agent",
  }));

  const chatCount = chatSessions.filter(
    (chat) => chat.type !== "agent_execution"
  ).length;

  const list = (
    <ChatList
      chats={chatSessions}
      onDelete={handleDelete}
      compact={variant === "inline"}
      hideAgentName={!!agentDisplayNameFallback}
      isLoading={isLoading && chatsWithAgents.length === 0}
      currentChatId={currentChatId}
      onSelect={
        onSelectChat
          ? (id) => {
              onSelectChat(id);
              onOpenChange(false);
            }
          : undefined
      }
    />
  );

  const panelContent = (
    <div className="relative flex h-full min-h-0 flex-col">
      <ChatHistoryHeader count={chatCount} />
      <ScrollArea
        ref={scrollAreaRef}
        className={cn(
          "min-h-0 flex-1 w-full pt-14 sm:pt-16 [&_[data-slot=scroll-area-viewport]]:block!",
          variant === "inline" ? "p-0" : "px-3 sm:px-5"
        )}
      >
        {list}
        {hasNextPage && (
          <div
            ref={loadMoreRef}
            className="py-4 flex items-center justify-center"
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading more...
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );

  if (variant === "inline") {
    return (
      <div
        className={cn("flex h-full min-h-0 flex-col", containerClassName)}
      >
        {panelContent}
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[400px] sm:w-[400px] border-zinc-200 p-0 dark:border-zinc-700"
        container={container}
      >
        {panelContent}
      </SheetContent>
    </Sheet>
  );
}
