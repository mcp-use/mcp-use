import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { ResizablePanel, usePanelRef } from "@/client/components/ui/resizable";
import { ChevronDown, Copy, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { JsonRpcLoggerView } from "../logging/JsonRpcLoggerView";

interface RpcPanelProps {
  serverId: string;
  className?: string;
}

/**
 * Reusable RPC Messages panel component for displaying and managing JSON-RPC messages.
 *
 * Provides a collapsible panel with message count badge, clear/export actions, and
 * integrated JsonRpcLoggerView. Manages its own state for collapse/expand behavior
 * and panel resizing.
 *
 * @param serverId - Server ID for filtering RPC messages in the logger view.
 * @param className - Optional additional CSS classes for the panel wrapper.
 * @returns The RpcPanel React element.
 */
export function RpcPanel({ serverId, className }: RpcPanelProps) {
  const [rpcMessageCount, setRpcMessageCount] = useState(0);
  const [rpcPanelCollapsed, setRpcPanelCollapsed] = useState(true);
  const rpcPanelRef = usePanelRef();
  const clearRpcMessagesRef = useRef<(() => Promise<void>) | null>(null);
  const exportRpcMessagesRef = useRef<(() => Promise<void>) | null>(null);

  const handleResize = (size: { asPercentage: number; inPixels: number }) => {
    console.log("[handleResize] size:", size);
    // Auto-expand when manually resized above collapsed size
    if (rpcPanelCollapsed && size.inPixels > 46) {
      setRpcPanelCollapsed(false);
    }
    // Auto-collapse when resized close to collapsed size
    else if (!rpcPanelCollapsed && size.inPixels <= 46) {
      setRpcPanelCollapsed(true);
    }
  };

  return (
    <ResizablePanel
      panelRef={rpcPanelRef}
      defaultSize={38}
      collapsible
      minSize={46}
      collapsedSize={46}
      onResize={handleResize}
      className={`flex flex-col border-t dark:border-zinc-700 ${className || ""}`}
    >
      <div
        data-testid="rpc-panel-toggle"
        className="group flex items-center justify-between p-3 shrink-0 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (rpcPanelCollapsed) {
            setRpcPanelCollapsed(false);
            setTimeout(() => {
              rpcPanelRef.current?.resize("50%");
            }, 100);
          } else {
            rpcPanelRef.current?.resize(38);

            setTimeout(() => {
              setRpcPanelCollapsed(true);
            }, 100);
          }
        }}
      >
        <div className="flex items-center justify-between gap-2 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">RPC Messages</h3>
            {rpcMessageCount > 0 && (
              <Badge
                data-testid="rpc-message-count"
                variant="secondary"
                className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
              >
                {rpcMessageCount}
              </Badge>
            )}
          </div>
          {rpcMessageCount > 0 && !rpcPanelCollapsed && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  exportRpcMessagesRef.current?.();
                }}
                className="h-6 w-6 p-0"
                title="Copy all messages to clipboard"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clearRpcMessagesRef.current?.();
                }}
                className="h-6 w-6 p-0"
                title="Clear all messages"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            rpcPanelCollapsed ? "" : "rotate-180"
          }`}
        />
      </div>
      <div
        className={`flex-1 overflow-hidden min-h-0 ${rpcPanelCollapsed ? "hidden" : ""}`}
      >
        <JsonRpcLoggerView
          serverIds={[serverId]}
          onCountChange={setRpcMessageCount}
          onClearRef={clearRpcMessagesRef}
          onExportRef={exportRpcMessagesRef}
        />
      </div>
    </ResizablePanel>
  );
}

RpcPanel.displayName = "RpcPanel";
