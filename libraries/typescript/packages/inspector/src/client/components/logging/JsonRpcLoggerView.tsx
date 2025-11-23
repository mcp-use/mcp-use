import { useEffect, useRef, useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { JSONDisplay } from "@/client/components/shared/JSONDisplay";

type RpcDirection = "send" | "receive" | string;

interface RpcEventMessage {
  serverId: string;
  direction: RpcDirection;
  message: unknown; // raw JSON-RPC payload (request/response/error)
  timestamp?: string;
}

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
}

export function JsonRpcLoggerView({
  serverIds,
  onCountChange,
  onClearRef,
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
    
    // Also clear server-side buffer to prevent replay of old events
    try {
      const params = new URLSearchParams();
      if (serverIds && serverIds.length > 0) {
        params.set("serverIds", serverIds.join(","));
      }
      const response = await fetch(`/inspector/api/rpc/log?${params.toString()}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        console.warn("[RPC Logger] Failed to clear server buffer:", response.status);
      }
    } catch (err) {
      console.warn("[RPC Logger] Error clearing server buffer:", err);
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

  // Notify parent of initial count
  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  useEffect(() => {
    let es: globalThis.EventSource | null = null;
    try {
      const params = new URLSearchParams();
      params.set("replay", "3");
      // Add timestamp to ensure fresh connection
      params.set("_t", Date.now().toString());
      if (serverIds && serverIds.length > 0) {
        params.set("serverIds", serverIds.join(","));
      }
      const streamUrl = `/inspector/api/rpc/stream?${params.toString()}`;
      console.log("[RPC Logger] Connecting to SSE stream:", streamUrl);
      es = new globalThis.EventSource(streamUrl);
      es.onopen = () => {
        console.log("[RPC Logger] SSE connection opened");
      };
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as {
            type?: string;
          } & RpcEventMessage;
          if (!data || data.type !== "rpc") return;

          const { serverId, direction, message, timestamp } = data;
          const msg: any = message as any;
          const method: string =
            typeof msg?.method === "string"
              ? msg.method
              : msg?.result !== undefined
                ? "result"
                : msg?.error !== undefined
                  ? "error"
                  : "unknown";

          const item: RenderableRpcItem = {
            id: `${timestamp ?? Date.now()}-${Math.random().toString(36).slice(2)}`,
            serverId: typeof serverId === "string" ? serverId : "unknown",
            direction:
              typeof direction === "string" ? direction.toUpperCase() : "",
            method,
            timestamp: timestamp ?? new Date().toISOString(),
            payload: message,
          };

          console.log("[RPC Logger] Received RPC event:", { method, direction, serverId });
          setItems((prev) => {
            const newItems = [item, ...prev].slice(0, 1000);
            onCountChange?.(newItems.length);
            return newItems;
          });
        } catch (err) {
          console.error("[RPC Logger] Error parsing SSE message:", err);
        }
      };
      es.onerror = (err) => {
        console.error("[RPC Logger] SSE connection error:", err);
        try {
          es?.close();
        } catch {
          // Ignore close errors
        }
      };
    } catch (err) {
      console.error("[RPC Logger] Failed to create SSE connection:", err);
    }

    return () => {
      try {
        es?.close();
        console.log("[RPC Logger] SSE connection closed");
      } catch {
        // Ignore close errors
      }
    };
  }, [serverIdsKey]); // Use normalized key to prevent unnecessary reconnections when serverIds array reference changes but contents are the same

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

    return result;
  }, [items, searchQuery, serverIds]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
          
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
      >
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

