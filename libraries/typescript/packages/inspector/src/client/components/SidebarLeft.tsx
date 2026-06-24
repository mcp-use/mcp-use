import { Button } from "@/client/components/ui/button";
import { Plus, Trash2, MessageSquare, Check, X, Database } from "lucide-react";
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
    clearAllSessions,
    storageEstimate
  } = useChatSessions();

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const usagePercentage = storageEstimate && storageEstimate.quota > 0
    ? (storageEstimate.usage / storageEstimate.quota) * 100
    : 0;

  // Warn if > 80% quota or > 500MB (since 500MB of JSON text is huge for this app)
  const isWarning = usagePercentage > 80 || (storageEstimate?.usage || 0) > 500 * 1024 * 1024;

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
      <div className="p-4 pb-2">
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
      {(sessions.length > 0 || (storageEstimate && storageEstimate.usage > 0)) && (
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2">
          {storageEstimate && storageEstimate.usage > 0 && (
            <div className="px-3 pb-1 pt-1">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground mb-1.5">
                <span className="flex items-center gap-1">
                  <Database className="size-3" /> Storage
                </span>
                <span className={cn(isWarning && "text-amber-500 font-medium")}>
                  {formatBytes(storageEstimate.usage)}
                </span>
              </div>
              <div className="h-1 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={cn("h-full bg-zinc-300 dark:bg-zinc-600 transition-all duration-500", isWarning && "bg-amber-500")}
                  style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                />
              </div>
              {isWarning && (
                <p className="text-[10px] text-amber-500 mt-1.5 leading-tight text-center">
                  Storage is large. Consider clearing old chats.
                </p>
              )}
            </div>
          )}

          {sessions.length > 0 && (
            isConfirmingClear ? (
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
            )
          )}
        </div>
      )}
    </aside>
  );
}