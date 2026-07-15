import { cn } from "@/client/lib/utils";
import { Input } from "@/client/components/ui/input";
import { NotFound } from "@/client/components/ui/not-found";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Search } from "lucide-react";
import * as React from "react";
import { ChatTitleReveal } from "./ChatTitleReveal";
import type { ChatSession } from "./types";

export type { ChatSession };

interface ChatListProps {
  chats: ChatSession[];
  onDelete: (id: string) => void;
  /** When provided, render buttons that call this instead of navigation links */
  onSelect?: (chatId: string) => void;
  /** When true, align item content with header (reduced horizontal padding) */
  compact?: boolean;
  /** When true, hide the agent name line (e.g. for MCP Server Chat where it's not an agent) */
  hideAgentName?: boolean;
  /** When true and chats is empty, show skeleton placeholders instead of empty state */
  isLoading?: boolean;
  /** Highlight the active chat */
  currentChatId?: string;
}

function ChatItemSkeleton({
  compact,
  hideAgentName,
}: {
  compact?: boolean;
  hideAgentName?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-3 gap-2",
        compact ? "px-4" : "px-3 rounded-lg"
      )}
    >
      <div
        className={cn(
          "flex-1 min-w-0 flex flex-col gap-1",
          hideAgentName ? "gap-1.5" : "gap-1"
        )}
      >
        <Skeleton className="h-4 w-3/4" />
        {!hideAgentName && <Skeleton className="h-3 w-1/2" />}
      </div>
      <Skeleton className="h-3 w-14 shrink-0" />
    </div>
  );
}

export function ChatList({
  chats,
  onDelete: _onDelete,
  onSelect,
  compact,
  hideAgentName,
  isLoading,
  currentChatId,
}: ChatListProps) {
  const [searchTerm, setSearchTerm] = React.useState("");

  const visibleChats = chats.filter((chat) => chat.type !== "agent_execution");

  const filteredChats = visibleChats.filter((chat) => {
    const title = (chat.title ?? "").toLowerCase();
    return title.includes(searchTerm.toLowerCase());
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();

    const isSameDay = date.toDateString() === now.toDateString();

    if (isSameDay) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isYesterday) {
      return "Yesterday";
    }

    const diffTime = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 7) {
      return `${diffDays} days ago`;
    }
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const renderChatItem = (chat: ChatSession) => (
    <div
      className={cn(
        "flex items-center justify-between py-3 hover:bg-muted/50 transition-colors gap-2 cursor-pointer",
        compact ? "px-4" : "px-3 rounded-lg",
        currentChatId === chat.id && "bg-muted/50"
      )}
    >
      <div
        className={cn(
          "flex-1 min-w-0 flex overflow-hidden",
          hideAgentName ? "flex-col" : "flex-col gap-1"
        )}
      >
        <p className="text-sm font-medium truncate w-full">
          <ChatTitleReveal
            key={`${chat.id}:${chat.title}`}
            chatId={chat.id}
            title={chat.title}
          />
        </p>
        {!hideAgentName && (
          <p className="text-xs text-muted-foreground truncate w-full">
            {chat.agent_name}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(chat.updated_at)}
        </span>
      </div>
    </div>
  );

  const renderChatList = () => {
    if (isLoading && visibleChats.length === 0) {
      return (
        <div className="space-y-1">
          <ChatItemSkeleton compact={compact} hideAgentName={hideAgentName} />
          <ChatItemSkeleton compact={compact} hideAgentName={hideAgentName} />
          <ChatItemSkeleton compact={compact} hideAgentName={hideAgentName} />
        </div>
      );
    }

    if (visibleChats.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center min-h-[12rem]">
          <NotFound vertical noBorder message="No chats" className="mt-0" />
        </div>
      );
    }

    if (filteredChats.length === 0) {
      return null;
    }

    return (
      <div className="space-y-1">
        {filteredChats.map((chat) =>
          onSelect ? (
            <button
              key={chat.id}
              type="button"
              onClick={() => onSelect(chat.id)}
              className="block w-full text-left group cursor-pointer"
            >
              {renderChatItem(chat)}
            </button>
          ) : (
            <div key={chat.id} className="block group cursor-pointer">
              {renderChatItem(chat)}
            </div>
          )
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-4 px-3 sm:px-5">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search chats..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-8 border-gray-300 dark:border-zinc-600"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">{renderChatList()}</div>
    </div>
  );
}
