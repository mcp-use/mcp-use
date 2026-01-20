import { JSONDisplay } from "@/client/components/shared/JSONDisplay";
import { Button } from "@/client/components/ui/button";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Copy,
} from "lucide-react";
import {
  clearRpcLogs,
  getAllRpcLogs,
  subscribeToRpcLogs,
  type RpcLogEntry,
} from "mcp-use/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface RenderableRpcItem {
  id: string;
  serverId: string;
  direction: string;
  method: string;
  timestamp: string;
  payload: unknown;
}

interface JsonRpcLoggerViewProps {
  serverIds?: string[]; // Optional filter for specific server IDs
  onCountChange?: (count: number) => void; // Callback when message count changes
  onClearRef?: React.MutableRefObject<(() => Promise<void>) | null>; // Ref to expose clearMessages function
  onExportRef?: React.MutableRefObject<(() => Promise<void>) | null>; // Ref to expose exportAllMessages function
}

/**
 * Renders a scrollable JSON-RPC log viewer with realtime updates and optional filtering.
 *
 * Displays a list of RPC messages (newest first), allows expanding items to view JSON payloads,
 * and updates the parent about the current message count.
 *
 * @param serverIds - Optional array of server IDs to restrict displayed logs to those servers.
 * @param onCountChange - Optional callback invoked with the current number of displayed messages whenever it changes.
 * @param onClearRef - Optional mutable ref that receives a `clearMessages` function which clears displayed logs and the underlying RPC log store.
 * @returns A React element that presents and manages JSON-RPC log entries (supports realtime subscription, filtering, expansion, and clearing).
 */
export function JsonRpcLoggerView({
  serverIds,
  onCountChange,
  onClearRef,
  onExportRef,
}: JsonRpcLoggerViewProps = {}) {
  const [items, setItems] = useState<RenderableRpcItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchQuery] = useState("");

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearMessages = async () => {
    // Clear local state
    setItems([]);
    setExpanded(new Set());
    onCountChange?.(0);

    // Clear from mcp-use/react RPC logger
    if (serverIds && serverIds.length > 0) {
      serverIds.forEach((serverId) => clearRpcLogs(serverId));
    } else {
      clearRpcLogs(); // Clear all
    }
  };

  const copyToClipboard = async (payload: unknown) => {
    try {
      const jsonString = JSON.stringify(payload, null, 2);
      await navigator.clipboard.writeText(jsonString);
      toast.success("Message copied to clipboard");
    } catch (error) {
      console.error("Failed to copy message:", error);
      toast.error("Failed to copy to clipboard");
    }
  };

  const exportAllMessages = async () => {
    try {
      const jsonString = JSON.stringify(filteredItems, null, 2);
      await navigator.clipboard.writeText(jsonString);
      toast.success(
        `All messages copied to clipboard (${filteredItems.length})`
      );
    } catch (error) {
      console.error("Failed to copy all messages:", error);
      toast.error("Failed to copy to clipboard");
    }
  };

  // Normalize serverIds to a stable string for dependency comparison
  const serverIdsKey = useMemo(() => {
    if (!serverIds || serverIds.length === 0) return "";
    return [...serverIds].sort().join(",");
  }, [serverIds]);

  // Expose clearMessages via ref if provided
  useEffect(() => {
    if (onClearRef) {
      onClearRef.current = clearMessages;
    }
    return () => {
      if (onClearRef) {
        onClearRef.current = null;
      }
    };
  }, [onClearRef, clearMessages]);

  // Expose exportAllMessages via ref if provided
  useEffect(() => {
    if (onExportRef) {
      onExportRef.current = exportAllMessages;
    }
    return () => {
      if (onExportRef) {
        onExportRef.current = null;
      }
    };
  }, [onExportRef, exportAllMessages]);

  // Notify parent of initial count
  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  useEffect(() => {
    console.log("[RPC Logger] Subscribing to RPC logs for servers:", serverIds);

    // Load existing logs
    const existingLogs = getAllRpcLogs();
    const filteredLogs =
      serverIds && serverIds.length > 0
        ? existingLogs.filter((log) => serverIds.includes(log.serverId))
        : existingLogs;

    // Convert to renderable items
    const initialItems = filteredLogs
      .map((log): RenderableRpcItem => {
        const msg: any = log.message;
        const method: string =
          typeof msg?.method === "string"
            ? msg.method
            : msg?.result !== undefined
              ? "result"
              : msg?.error !== undefined
                ? "error"
                : "unknown";

        return {
          id: `${log.timestamp}-${Math.random().toString(36).slice(2)}`,
          serverId: log.serverId,
          direction: log.direction.toUpperCase(),
          method,
          timestamp: log.timestamp,
          payload: log.message,
        };
      })
      .reverse(); // Newest first

    setItems(initialItems);
    onCountChange?.(initialItems.length);

    // Subscribe to new logs
    const unsubscribe = subscribeToRpcLogs((entry: RpcLogEntry) => {
      // Filter by serverIds if specified
      if (
        serverIds &&
        serverIds.length > 0 &&
        !serverIds.includes(entry.serverId)
      ) {
        return;
      }

      const msg: any = entry.message;
      const method: string =
        typeof msg?.method === "string"
          ? msg.method
          : msg?.result !== undefined
            ? "result"
            : msg?.error !== undefined
              ? "error"
              : "unknown";

      const item: RenderableRpcItem = {
        id: `${entry.timestamp}-${Math.random().toString(36).slice(2)}`,
        serverId: entry.serverId,
        direction: entry.direction.toUpperCase(),
        method,
        timestamp: entry.timestamp,
        payload: entry.message,
      };

      console.log("[RPC Logger] New RPC log:", {
        method,
        direction: entry.direction,
        serverId: entry.serverId,
      });
      setItems((prev) => {
        const newItems = [item, ...prev].slice(0, 1000);
        onCountChange?.(newItems.length);
        return newItems;
      });
    });

    return () => {
      unsubscribe();
      console.log("[RPC Logger] Unsubscribed from RPC logs");
    };
  }, [serverIdsKey, onCountChange]); // Use normalized key to prevent unnecessary reconnections when serverIds array reference changes but contents are the same

  const filteredItems = useMemo(() => {
    let result = items;

    // Filter by serverIds if provided
    if (serverIds && serverIds.length > 0) {
      const serverIdSet = new Set(serverIds);
      result = result.filter((item) => serverIdSet.has(item.serverId));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const queryLower = searchQuery.toLowerCase();
      result = result.filter((item) => {
        return (
          item.serverId.toLowerCase().includes(queryLower) ||
          item.method.toLowerCase().includes(queryLower) ||
          item.direction.toLowerCase().includes(queryLower) ||
          JSON.stringify(item.payload).toLowerCase().includes(queryLower)
        );
      });
    }

    // Sort by timestamp (newest first)
    result = [...result].sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return result;
  }, [items, searchQuery, serverIds]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-xs text-muted-foreground">
              {"No messages yet"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {"JSON-RPC messages will appear here"}
            </div>
          </div>
        ) : (
          filteredItems.map((it) => {
            const isExpanded = expanded.has(it.id);
            return (
              <div
                key={it.id}
                className="group hover:bg-muted/50 transition-all duration-200 overflow-hidden"
              >
                <div
                  className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleExpanded(it.id)}
                >
                  <div className="flex-shrink-0">
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground transition-transform" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-muted-foreground font-mono text-xs">
                      {new Date(it.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`flex items-center justify-center px-1 py-0.5 rounded ${
                        it.direction === "RECEIVE"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "bg-green-500/10 text-green-600 dark:text-green-400"
                      }`}
                      title={
                        it.direction === "RECEIVE" ? "Incoming" : "Outgoing"
                      }
                    >
                      {it.direction === "RECEIVE" ? (
                        <ArrowDownToLine className="h-3 w-3" />
                      ) : (
                        <ArrowUpFromLine className="h-3 w-3" />
                      )}
                    </span>
                    <span className="text-xs font-mono text-foreground truncate">
                      {it.method}
                    </span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t bg-muted/20">
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">
                          Message Payload
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(it.payload);
                          }}
                          className="h-6 px-2"
                          title="Copy message to clipboard"
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          <span className="text-xs">Copy</span>
                        </Button>
                      </div>
                      <div className="max-h-[40vh] overflow-auto rounded-sm bg-background/60 p-2">
                        <JSONDisplay data={it.payload} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default JsonRpcLoggerView;
