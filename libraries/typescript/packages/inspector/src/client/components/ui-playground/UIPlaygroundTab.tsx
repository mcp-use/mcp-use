/**
 * UI Playground Tab
 *
 * Comprehensive widget testing interface with:
 * - Device emulation (mobile/tablet/desktop)
 * - CSP mode switching (permissive/widget-declared)
 * - Traffic logs (reuses JsonRpcLoggerView)
 * - CSP violation tracking
 * - Widget state inspection
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { useMemo, useState } from "react";
import { useWidgetDebug } from "../../context/WidgetDebugContext";
import { detectWidgetProtocol } from "../../utils/widget-detection";
import { MCPAppsRenderer } from "../MCPAppsRenderer";
import { JsonRpcLoggerView } from "../logging/JsonRpcLoggerView";
import { Button } from "../ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { CspDebugPanel } from "./CspDebugPanel";
import { DeviceEmulationControls } from "./DeviceEmulationControls";

interface UIPlaygroundTabProps {
  tools: Tool[];
  serverId: string;
  readResource: (uri: string) => Promise<any>;
  isConnected: boolean;
}

export function UIPlaygroundTab({
  tools,
  serverId,
  readResource,
  isConnected,
}: UIPlaygroundTabProps) {
  const { playground, updatePlaygroundSettings, activeWidgetId, widgets } =
    useWidgetDebug();

  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [toolResult, setToolResult] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Filter tools to only show those with widget support
  const widgetTools = useMemo(() => {
    return tools.filter((tool) => {
      const protocol = detectWidgetProtocol(tool._meta, null);
      return protocol === "mcp-apps" || protocol === "chatgpt-app";
    });
  }, [tools]);

  const selectedTool = useMemo(() => {
    return tools.find((t) => t.name === selectedToolName) || null;
  }, [tools, selectedToolName]);

  const widgetProtocol = useMemo(() => {
    if (!selectedTool) return null;
    return detectWidgetProtocol(selectedTool._meta, toolResult);
  }, [selectedTool, toolResult]);

  const resourceUri = useMemo(() => {
    if (!selectedTool?._meta) return null;
    const meta = selectedTool._meta as Record<string, any>;
    return meta.ui?.resourceUri || meta["openai/outputTemplate"] || null;
  }, [selectedTool]);

  const handleExecuteTool = async () => {
    if (!selectedTool || !isConnected) return;

    setIsExecuting(true);
    try {
      // Note: callTool would need to be passed as prop
      // For now, show placeholder
      setToolResult({
        content: [{ type: "text", text: "Tool execution result" }],
      });
    } catch (error) {
      console.error("Tool execution failed:", error);
    } finally {
      setIsExecuting(false);
    }
  };

  const activeWidget = activeWidgetId ? widgets.get(activeWidgetId) : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">UI Playground</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Test widgets with device emulation and debugging tools
        </p>
      </div>

      {/* Main Content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Panel: Controls */}
        <ResizablePanel defaultSize={30} minSize={20}>
          <div className="h-full overflow-auto p-4 space-y-6">
            {/* Tool Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Widget Tool</label>
              <Select
                value={selectedToolName || ""}
                onValueChange={setSelectedToolName}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a tool with UI..." />
                </SelectTrigger>
                <SelectContent>
                  {widgetTools.map((tool) => {
                    const protocol = detectWidgetProtocol(tool._meta, null);
                    return (
                      <SelectItem key={tool.name} value={tool.name}>
                        <div className="flex items-center gap-2">
                          <span>{tool.name}</span>
                          <span className="text-xs text-zinc-500">
                            ({protocol === "mcp-apps" ? "MCP Apps" : "ChatGPT"})
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {widgetTools.length === 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No tools with UI support found. Connect to an MCP server with
                  widget tools.
                </p>
              )}
            </div>

            {/* Device Emulation */}
            <DeviceEmulationControls />

            {/* CSP Mode */}
            <div className="space-y-2">
              <label className="text-sm font-medium">CSP Mode</label>
              <Select
                value={playground.cspMode}
                onValueChange={(value: "permissive" | "widget-declared") =>
                  updatePlaygroundSettings({ cspMode: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="permissive">
                    <div className="flex flex-col items-start">
                      <span>Permissive</span>
                      <span className="text-xs text-zinc-500">
                        Allow all resources (development)
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="widget-declared">
                    <div className="flex flex-col items-start">
                      <span>Widget-Declared</span>
                      <span className="text-xs text-zinc-500">
                        Honor widget CSP (production)
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedTool && (
              <Button
                onClick={handleExecuteTool}
                disabled={isExecuting || !isConnected}
                className="w-full"
              >
                {isExecuting ? "Executing..." : "Execute Tool"}
              </Button>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Right Panel: Widget + Debug Tabs */}
        <ResizablePanel defaultSize={70} minSize={40}>
          <Tabs defaultValue="widget" className="h-full flex flex-col">
            <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <TabsList>
                <TabsTrigger value="widget">Widget</TabsTrigger>
                <TabsTrigger value="traffic">
                  Traffic Logs
                  {activeWidgetId && (
                    <span className="ml-2 text-xs">
                      ({/* count would go here */})
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="csp">CSP Debug</TabsTrigger>
                <TabsTrigger value="state">State</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-auto">
              <TabsContent value="widget" className="h-full m-0 p-4">
                {widgetProtocol === "mcp-apps" &&
                resourceUri &&
                selectedTool ? (
                  <MCPAppsRenderer
                    serverId={serverId}
                    toolCallId={`playground-${selectedTool.name}-${Date.now()}`}
                    toolName={selectedTool.name}
                    toolInput={{}}
                    toolOutput={toolResult}
                    toolMetadata={selectedTool._meta as Record<string, any>}
                    resourceUri={resourceUri}
                    readResource={readResource}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center text-zinc-500 dark:text-zinc-400">
                      <p className="text-sm">
                        Select a tool with MCP Apps support to test widgets
                      </p>
                      <p className="text-xs mt-2">
                        ChatGPT Apps SDK widgets will also be supported here
                      </p>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="traffic" className="h-full m-0">
                {activeWidgetId ? (
                  <JsonRpcLoggerView serverIds={[`widget-${activeWidgetId}`]} />
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                    <p className="text-sm">
                      Execute a tool to see traffic logs
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="csp" className="h-full m-0">
                {activeWidgetId ? (
                  <CspDebugPanel widgetId={activeWidgetId} />
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                    <p className="text-sm">
                      Execute a tool to see CSP violations
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="state" className="h-full m-0 p-4">
                {activeWidget ? (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium mb-2">Host Context</h4>
                      <pre className="bg-zinc-100 dark:bg-zinc-900 rounded p-3 text-xs overflow-auto">
                        {JSON.stringify(activeWidget.hostContext, null, 2)}
                      </pre>
                    </div>
                    {activeWidget.widgetState && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">
                          Widget State
                        </h4>
                        <pre className="bg-zinc-100 dark:bg-zinc-900 rounded p-3 text-xs overflow-auto">
                          {JSON.stringify(activeWidget.widgetState, null, 2)}
                        </pre>
                      </div>
                    )}
                    {activeWidget.modelContext && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">
                          Model Context
                        </h4>
                        <pre className="bg-zinc-100 dark:bg-zinc-900 rounded p-3 text-xs overflow-auto">
                          {JSON.stringify(activeWidget.modelContext, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                    <p className="text-sm">
                      Execute a tool to see widget state
                    </p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
