import { Button } from "@/client/components/ui/button";
import { ChevronDown, ChevronUp, Wrench, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/client/lib/utils";
import type { McpServer } from "mcp-use/react";
import { useInspector } from "@/client/context/InspectorContext";
import { useEffect, useState, useMemo } from "react";
import { useChatSessions } from "../context/ChatSessionsContext";

interface SidebarRightProps {
  selectedServer?: McpServer;
}

export function SidebarRight({ selectedServer }: SidebarRightProps) {
  const { setActiveTab } = useInspector();
  const { activeMessages } = useChatSessions();
  const [uptime, setUptime] = useState("0s");

  // Basic mock uptime counter
  useEffect(() => {
    if (!selectedServer || selectedServer.state !== "ready") return;
    const start = Date.now();
    const interval = setInterval(() => {
      const diff = Date.now() - start;
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      if (hours > 0) setUptime(`${hours}h ${mins}m ${secs}s`);
      else if (mins > 0) setUptime(`${mins}m ${secs}s`);
      else setUptime(`${secs}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [selectedServer?.state]);

  if (!selectedServer) return null;

  const tools = selectedServer.tools || [];
  const previewTools = tools.slice(0, 2); // Show top 2 tools

  // Extract real tool calls from active chat session
  const recentToolCalls = useMemo(() => {
    const calls: Array<{
      toolName: string;
      args: Record<string, unknown>;
      result?: any;
      state?: string;
      timestamp: number;
    }> = [];

    // Parse messages backward to get most recent first
    for (let i = activeMessages.length - 1; i >= 0; i--) {
      const msg = activeMessages[i];
      
      // Look for tool calls in parts
      if (msg.parts) {
        for (const part of msg.parts) {
          if (part.type === "tool-invocation" && part.toolInvocation) {
            calls.push({
              toolName: part.toolInvocation.toolName,
              args: part.toolInvocation.args || {},
              result: part.toolInvocation.result,
              state: part.toolInvocation.state,
              timestamp: msg.timestamp,
            });
          }
        }
      }
      
      // Look for tool calls array (older format fallback)
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          calls.push({
            toolName: tc.toolName,
            args: tc.args || {},
            result: tc.result,
            state: tc.result ? "result" : "pending",
            timestamp: msg.timestamp,
          });
        }
      }
      
      // Only keep the 5 most recent
      if (calls.length >= 5) break;
    }
    
    return calls.slice(0, 5);
  }, [activeMessages]);

  return (
    <aside className="w-[300px] h-full flex flex-col bg-white dark:bg-[#000000] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm shrink-0 overflow-hidden hidden xl:flex">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">MCP Inspector</h2>
        <div className="flex gap-1">
          <button className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
          <button className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <ChevronUp className="size-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
        {/* Status Section */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground">Status</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-start flex-col gap-1">
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="size-3.5" />
                Connected
              </span>
              <span className="text-xs text-muted-foreground ml-5">{selectedServer.name || "Local MCP Server"}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="size-3.5" />
              <span className="text-xs">Uptime: {uptime}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wrench className="size-3.5" />
              <span className="text-xs">{tools.length} Tools Available</span>
            </div>
          </div>
        </div>

        {/* Tools Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground">Tools</h3>
            <span className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md font-medium text-muted-foreground">
              {tools.length}
            </span>
          </div>
          <div className="space-y-2">
            {previewTools.map((tool) => (
              <div key={tool.name} className="p-3 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <Wrench className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">{tool.name}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {tool.description || "No description provided."}
                </p>
              </div>
            ))}
          </div>
          <Button 
            variant="outline" 
            className="w-full h-8 text-xs bg-transparent border-zinc-200 dark:border-zinc-800"
            onClick={() => setActiveTab("tools")}
          >
            View all tools
          </Button>
        </div>

        {/* Recent Tool Calls Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground">Recent Tool Calls</h3>
            <span className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md font-medium text-muted-foreground">
              {recentToolCalls.length}
            </span>
          </div>
          
          {recentToolCalls.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4 opacity-70">
              No tools called in this session yet.
            </div>
          ) : (
            <div className="space-y-2">
              {recentToolCalls.map((call, index) => {
                const isError = call.state === "error" || (call.result && call.result.isError);
                const isSuccess = call.state === "result" && !isError;
                const isPending = call.state === "pending" || call.state === "streaming";
                
                return (
                  <div key={index} className="p-3 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-mono truncate mr-2" title={`${call.toolName}(...)`}>
                        {call.toolName}
                      </span>
                      {isSuccess && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                          <CheckCircle2 className="size-3" /> Success
                        </span>
                      )}
                      {isError && (
                        <span className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 font-medium shrink-0">
                          Error
                        </span>
                      )}
                      {isPending && (
                        <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium shrink-0">
                          Pending...
                        </span>
                      )}
                    </div>
                    
                    {/* Display args summary or result summary if available */}
                    <div className="text-xs text-muted-foreground line-clamp-2">
                      {isSuccess && call.result 
                        ? (typeof call.result === 'object' ? JSON.stringify(call.result).slice(0, 60) + '...' : String(call.result).slice(0, 60))
                        : (Object.keys(call.args).length > 0 ? JSON.stringify(call.args).slice(0, 60) : 'No arguments')}
                    </div>
                    
                    <div className="flex items-center justify-end gap-2 mt-2 text-[10px] text-muted-foreground">
                      <span>{new Date(call.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <Button 
            variant="outline" 
            className="w-full h-8 text-xs bg-transparent border-zinc-200 dark:border-zinc-800"
            onClick={() => setActiveTab("tools")} // Using tools tab for now since there's no dedicated calls tab
          >
            View all calls
          </Button>
        </div>
      </div>
    </aside>
  );
}
