import { Button } from "@/client/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/client/components/ui/avatar";
import { Plus, Command, Trash2, MessageSquare } from "lucide-react";
import { cn } from "@/client/lib/utils";
import { useChatSessions, type ChatSession } from "../context/ChatSessionsContext";
import { useMemo } from "react";

export function SidebarLeft() {
  const { 
    sessions, 
    activeSessionId, 
    setActiveSessionId, 
    createSession, 
    deleteSession, 
    clearAllSessions 
  } = useChatSessions();

  // Group sessions by time
  const groupedSessions = useMemo(() => {
    const now = Date.now();
    const msInDay = 24 * 60 * 60 * 1000;
    
    const today: ChatSession[] = [];
    const yesterday: ChatSession[] = [];
    const last7Days: ChatSession[] = [];
    const older: ChatSession[] = [];

    sessions.forEach(session => {
      const diff = now - session.updatedAt;
      if (diff < msInDay) {
        today.push(session);
      } else if (diff < msInDay * 2) {
        yesterday.push(session);
      } else if (diff < msInDay * 7) {
        last7Days.push(session);
      } else {
        older.push(session);
      }
    });

    return { today, yesterday, last7Days, older };
  }, [sessions]);

  const renderGroup = (title: string, group: ChatSession[]) => {
    if (group.length === 0) return null;
    
    return (
      <div className="space-y-1">
        <h3 className="px-2 text-xs font-medium text-muted-foreground mb-2">{title}</h3>
        {group.map((chat) => {
          const isActive = chat.id === activeSessionId;
          const timeLabel = new Intl.DateTimeFormat('en-US', { 
            hour: 'numeric', minute: 'numeric', 
            ...(title !== "Today" && title !== "Yesterday" && { weekday: 'short' })
          }).format(new Date(chat.updatedAt));

          return (
            <div
              key={chat.id}
              className={cn(
                "group relative w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors cursor-pointer",
                isActive 
                  ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium" 
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-foreground/80 hover:text-foreground"
              )}
              onClick={() => setActiveSessionId(chat.id)}
            >
              <span className="truncate pr-8">{chat.title}</span>
              
              {/* Time Label (hides on hover to show trash icon) */}
              <span className="text-xs text-muted-foreground shrink-0 group-hover:hidden">
                {timeLabel}
              </span>

              {/* Delete Button (shows on hover) */}
              <button 
                className="absolute right-2 p-1 text-muted-foreground hover:text-red-500 hidden group-hover:block transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(chat.id);
                }}
                title="Delete Chat"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside className="w-64 h-full flex flex-col bg-white dark:bg-[#000000] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm shrink-0 overflow-hidden">
      {/* New Chat Button */}
      <div className="p-4">
        <Button
          variant="outline"
          className="w-full justify-between bg-transparent border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={() => createSession()}
        >
          <span className="flex items-center gap-2">
            <Plus className="size-4" />
            New Chat
          </span>
        </Button>
      </div>

      {/* Chat History List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-6 pb-4 scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm opacity-60">
            <MessageSquare className="size-8 mb-2 opacity-40" />
            <p>No chat history</p>
          </div>
        ) : (
          <>
            {renderGroup("Today", groupedSessions.today)}
            {renderGroup("Yesterday", groupedSessions.yesterday)}
            {renderGroup("Last 7 Days", groupedSessions.last7Days)}
            {renderGroup("Older", groupedSessions.older)}
          </>
        )}
      </div>

      {/* Footer / Clear All */}
      {sessions.length > 0 && (
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
          <Button 
            variant="ghost" 
            className="w-full text-muted-foreground hover:text-red-500 text-xs justify-start px-3"
            onClick={() => {
              if (window.confirm("Are you sure you want to clear all chat history?")) {
                clearAllSessions();
              }
            }}
          >
            <Trash2 className="size-3.5 mr-2" />
            Clear All Chats
          </Button>
        </div>
      )}
    </aside>
  );
}
