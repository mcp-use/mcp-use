import { Button } from "@/client/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/client/components/ui/avatar";
import { Plus, Trash2, MessageSquare, Check, X } from "lucide-react";
import { cn } from "@/client/lib/utils";
import { useChatSessions, type ChatSession } from "../context/ChatSessionsContext";
import { useMemo, useState, useRef, useEffect } from "react";

export function SidebarLeft() {
  const { 
    sessions, 
    activeSessionId, 
    setActiveSessionId, 
    createSession, 
    deleteSession, 
    clearAllSessions 
  } = useChatSessions();

  const [isNaming, setIsNaming] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input whenever it becomes visible
  useEffect(() => {
    if (isNaming && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isNaming]);

  const handleNewSessionClick = () => {
    setNewSessionName("");
    setIsNaming(true);
  };

  const handleConfirm = async () => {
    const name = newSessionName.trim() || "New Session";
    await createSession(name);
    setIsNaming(false);
    setNewSessionName("");
  };

  const handleCancel = () => {
    setIsNaming(false);
    setNewSessionName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

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
      {/* New Session Button / Inline Name Input */}
      <div className="p-4 pb-2">
        {isNaming ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground px-1">Name your session</p>
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Debug session..."
                maxLength={50}
                className={cn(
                  "flex-1 min-w-0 text-sm px-3 py-1.5 rounded-md border",
                  "bg-transparent border-zinc-300 dark:border-zinc-700",
                  "text-foreground placeholder:text-muted-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400",
                  "transition-shadow"
                )}
              />
              {/* Confirm */}
              <button
                onClick={handleConfirm}
                title="Create session (Enter)"
                className="p-1.5 rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors shrink-0"
              >
                <Check className="size-4" />
              </button>
              {/* Cancel */}
              <button
                onClick={handleCancel}
                title="Cancel (Esc)"
                className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full justify-between bg-transparent border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={handleNewSessionClick}
          >
            <span className="flex items-center gap-2">
              <Plus className="size-4" />
              New Session
            </span>
          </Button>
        )}
      </div>

      {/* Chat History List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-6 pb-4 pt-2 scrollbar-thin">
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
