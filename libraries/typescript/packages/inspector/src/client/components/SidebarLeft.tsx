import { Button } from "@/client/components/ui/button";
import { Plus, Trash2, MessageSquare, Check, X } from "lucide-react";
import { cn } from "@/client/lib/utils";
import { useChatSessions, type ChatSession } from "../context/ChatSessionsContext";
import { useState } from "react";

export function SidebarLeft() {
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    deleteSession,
    clearAllSessions
  } = useChatSessions();

  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  const renderSession = (chat: ChatSession) => {
    const isActive = chat.id === activeSessionId;

    return (
      <div
        key={chat.id}
        className={cn(
          "group relative w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors cursor-pointer",
          isActive
            ? "bg-zinc-100 dark:bg-zinc-800 text-foreground font-medium"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-foreground/80 hover:text-foreground"
        )}
        onClick={() => setActiveSessionId(chat.id)}
      >
        <span className="truncate pr-8">{chat.title}</span>

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
  };

  return (
    <aside className="w-64 h-full flex flex-col bg-white dark:bg-[#000000] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm shrink-0 overflow-hidden">
      {/* New Sessions Button */}
      <div className="p-4 pb-2.5 border-b border-zinc-200 dark:border-zinc-800">
        <Button
          variant="outline"
          className="w-full justify-between bg-transparent border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={() => createSession()}
        >
          <span className="flex items-center gap-2">
            <Plus className="size-4" />
            New Sessions
          </span>
        </Button>
      </div>

      {/* Chat History List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-6 pb-4 pt-2 scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm opacity-60">
            <MessageSquare className="size-8 mb-2 opacity-40" />
            <p>No chat history</p>
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map(renderSession)}
          </div>
        )}
      </div>

      {/* Footer / Clear All */}
      {sessions.length > 0 && (
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2">
          {isConfirmingClear ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground px-1">Delete all chat history?</p>
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  className="flex-1 text-xs text-red-500 px-2"
                  onClick={() => { clearAllSessions(); setIsConfirmingClear(false); }}
                >
                  <Check className="size-3 mr-1" />
                  Yes, clear
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 text-xs text-muted-foreground px-2"
                  onClick={() => setIsConfirmingClear(false)}
                >
                  <X className="size-3 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground text-xs justify-start px-3"
              onClick={() => setIsConfirmingClear(true)}
            >
              <Trash2 className="size-3.5 mr-2" />
              Clear All Chats
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}