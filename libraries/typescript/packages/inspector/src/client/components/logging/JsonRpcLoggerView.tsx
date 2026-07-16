import { McpIcon } from "@/client/components/ui/client-icons";
import { JSONDisplay } from "@/client/components/shared/JSONDisplay";
import { Button } from "@/client/components/ui/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@/client/components/ui/checkbox-group";
import { Input } from "@/client/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useRpcLogVirtualizer } from "@/client/hooks/use-rpc-log-virtualizer";
import { ensureRpcTrafficBridge } from "@/client/rpc-traffic-bridge";
import { getRpcTrafficMethod } from "@/client/rpc-traffic-coalesce";
import {
  rpcTrafficStore,
  type RpcTrafficEntry,
  type RpcTrafficSource,
} from "@/client/rpc-traffic-store";
import { copyToClipboard } from "@/client/utils/browser";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Download,
  PanelsTopLeft,
  Search,
  Trash2,
} from "lucide-react";
import { clearRpcLogs } from "@mcp-use/client/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

ensureRpcTrafficBridge();

interface JsonRpcLoggerViewProps {
  serverIds?: string[];
  onCountChange?: (count: number) => void;
  onClearRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  onExportRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

export function JsonRpcLoggerView({
  serverIds,
  onCountChange,
  onClearRef,
  onExportRef,
}: JsonRpcLoggerViewProps = {}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilters, setSourceFilters] = useState<Set<RpcTrafficSource>>(
    () => new Set(["mcp", "widget"])
  );
  const items = useSyncExternalStore(
    rpcTrafficStore.subscribe,
    rpcTrafficStore.getSnapshot,
    rpcTrafficStore.getSnapshot
  );

  const copyMessageToClipboard = async (payload: unknown) => {
    try {
      const jsonString = JSON.stringify(payload, null, 2);
      await copyToClipboard(jsonString);
      toast.success("Message copied to clipboard");
    } catch (error) {
      console.error("Failed to copy message:", error);
      toast.error("Failed to copy to clipboard");
    }
  };

  const scopedItems = useMemo(() => {
    if (!serverIds?.length) return items;
    const serverIdSet = new Set(serverIds);
    return items.filter((item) => serverIdSet.has(item.serverId));
  }, [items, serverIds]);

  const sourceCheckedIndices = useMemo(() => {
    const indices = new Set<number>();
    if (sourceFilters.has("mcp")) indices.add(0);
    if (sourceFilters.has("widget")) indices.add(1);
    return indices;
  }, [sourceFilters]);

  const toggleSourceFilter = useCallback((source: RpcTrafficSource) => {
    setSourceFilters((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const filteredItems = useMemo(() => {
    let result = scopedItems;

    if (sourceFilters.size > 0) {
      result = result.filter((item) => sourceFilters.has(item.source));
    }

    const queryLower = searchQuery.trim().toLowerCase();
    if (queryLower) {
      result = result.filter((item) => {
        const method = getMethod(item);
        return (
          item.serverId.toLowerCase().includes(queryLower) ||
          item.widgetId?.toLowerCase().includes(queryLower) ||
          item.source.includes(queryLower) ||
          method.toLowerCase().includes(queryLower) ||
          item.direction.toLowerCase().includes(queryLower) ||
          JSON.stringify(item.message).toLowerCase().includes(queryLower)
        );
      });
    }

    return [...result].reverse();
  }, [scopedItems, searchQuery, sourceFilters]);

  const { totalHeight, visibleItems } = useRpcLogVirtualizer(
    filteredItems,
    expanded,
    scrollRef
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearMessages = useCallback(async () => {
    const sources =
      sourceFilters.size === 0 || sourceFilters.size === 2
        ? undefined
        : ([...sourceFilters] satisfies RpcTrafficSource[]);

    if (!sources || sources.includes("mcp")) {
      if (serverIds?.length) {
        serverIds.forEach((serverId) => clearRpcLogs(serverId));
      } else {
        clearRpcLogs();
      }
    }
    rpcTrafficStore.clear({ serverIds, sources });
    setExpanded(new Set());
  }, [serverIds, sourceFilters]);

  const copyFilteredMessages = useCallback(async () => {
    try {
      await copyToClipboard(JSON.stringify(filteredItems, null, 2));
      toast.success(`Copied ${filteredItems.length} messages`);
    } catch (error) {
      console.error("Failed to copy messages:", error);
      toast.error("Failed to copy to clipboard");
    }
  }, [filteredItems]);

  const downloadFilteredMessages = useCallback(() => {
    const blob = new Blob([JSON.stringify(filteredItems, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mcp-rpc-traffic-${new Date()
      .toISOString()
      .replaceAll(":", "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredItems]);

  useEffect(() => {
    onCountChange?.(filteredItems.length);
  }, [filteredItems.length, onCountChange]);

  useEffect(() => {
    if (onClearRef) onClearRef.current = clearMessages;
    return () => {
      if (onClearRef) onClearRef.current = null;
    };
  }, [clearMessages, onClearRef]);

  useEffect(() => {
    if (onExportRef) onExportRef.current = copyFilteredMessages;
    return () => {
      if (onExportRef) onExportRef.current = null;
    };
  }, [copyFilteredMessages, onExportRef]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-2">
        <h2 className="text-xs font-medium text-foreground">RPC Logs</h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            onClick={copyFilteredMessages}
            disabled={filteredItems.length === 0}
            aria-label="Copy filtered RPC traffic"
            title="Copy filtered"
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            onClick={downloadFilteredMessages}
            disabled={filteredItems.length === 0}
            aria-label="Download filtered RPC traffic as JSON"
            title="Download JSON"
          >
            <Download className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            onClick={clearMessages}
            disabled={items.length === 0}
            aria-label="Clear RPC traffic"
            title="Clear"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 p-2 pt-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search RPC traffic"
            className="h-8 pl-7 text-xs shadow-none"
          />
        </div>
        <CheckboxGroup
          checkedIndices={sourceCheckedIndices}
          orientation="horizontal"
          aria-label="Filter RPC traffic by source"
          className="w-auto shrink-0"
        >
          <CheckboxItem
            index={0}
            label="MCP"
            size="sm"
            checked={sourceFilters.has("mcp")}
            onToggle={() => toggleSourceFilter("mcp")}
          />
          <CheckboxItem
            index={1}
            label="UI"
            size="sm"
            checked={sourceFilters.has("widget")}
            onToggle={() => toggleSourceFilter("widget")}
          />
        </CheckboxGroup>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto pb-10"
        style={{
          maskImage:
            "linear-gradient(to bottom, black 0, black calc(100% - 3rem), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0, black calc(100% - 3rem), transparent 100%)",
        }}
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
          <div className="relative w-full" style={{ height: totalHeight }}>
            {visibleItems.map(({ item, top, height }) => (
              <RpcLogRow
                key={item.id}
                item={item}
                top={top}
                height={height}
                expanded={expanded.has(item.id)}
                onToggle={() => toggleExpanded(item.id)}
                onCopy={() => copyMessageToClipboard(item.message)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RpcLogRow({
  item,
  top,
  height,
  expanded,
  onToggle,
  onCopy,
}: {
  item: RpcTrafficEntry;
  top: number;
  height: number;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const method = getMethod(item);
  const direction = getDirectionLabel(item);
  const repeatSuffix =
    item.repeatCount && item.repeatCount > 1 ? ` ×${item.repeatCount}` : "";

  return (
    <div
      className="absolute inset-x-0 overflow-hidden"
      style={{ top, height }}
      data-testid={`rpc-message-${method.replace(/\//g, "-")}`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground transition-colors hover:text-foreground"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex size-4 shrink-0 items-center justify-center">
                {item.direction === "receive" ? (
                  <ArrowDownLeft className="size-3.5 text-blue-500" />
                ) : (
                  <ArrowUpRight className="size-3.5 text-emerald-500" />
                )}
              </span>
            }
            nativeButton={false}
          />
          <TooltipContent side="left">{direction}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {item.source === "mcp" ? (
                  <McpIcon className="size-3" />
                ) : (
                  <PanelsTopLeft className="size-3" />
                )}
              </span>
            }
            nativeButton={false}
          />
          <TooltipContent side="left">
            {item.source === "mcp" ? "MCP server" : "UI widget"}
          </TooltipContent>
        </Tooltip>

        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {method}
          {repeatSuffix ? (
            <span className="text-muted-foreground">{repeatSuffix}</span>
          ) : null}
        </span>

        <Tooltip>
          <TooltipTrigger
            render={
              <time
                dateTime={item.timestamp}
                className="shrink-0 cursor-default font-mono text-[10px] tabular-nums text-muted-foreground underline decoration-dotted underline-offset-2"
              >
                {new Date(item.timestamp).toLocaleTimeString()}
              </time>
            }
            nativeButton={false}
          />
          <TooltipContent side="left">
            {new Date(item.timestamp).toLocaleString()}
          </TooltipContent>
        </Tooltip>
      </button>

      {expanded ? (
        <div className="relative mx-3 mb-2 max-h-44 overflow-auto rounded-lg p-2 pr-8">
          <JSONDisplay
            data={item.message}
            className="[&_pre]:!text-[10px] [&_pre]:!leading-4"
          />
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={onCopy}
            className="absolute right-1 top-1 size-6 rounded-full p-0"
            title="Copy message"
            aria-label="Copy message"
          >
            <Copy className="size-3" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function getMethod(entry: RpcTrafficEntry): string {
  const fromMessage = getRpcTrafficMethod(entry.message);
  if (fromMessage) return fromMessage;
  const message = entry.message as {
    result?: unknown;
    error?: unknown;
  };
  if (message?.result !== undefined) return "result";
  if (message?.error !== undefined) return "error";
  return "unknown";
}

function getDirectionLabel(entry: RpcTrafficEntry): string {
  if (entry.source === "widget") {
    return entry.direction === "send" ? "Host → Widget" : "Widget → Host";
  }
  return entry.direction === "send" ? "Inspector → MCP" : "MCP → Inspector";
}
