import { Button } from "@/client/components/ui/button";
import type { Tool } from "@mcp-use/modelcontextprotocol-sdk/types.js";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronLeft, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SavedRequest, ToolResult } from "./tools";

import { Badge } from "@/client/components/ui/badge";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { useInspector } from "@/client/context/InspectorContext";
import {
  MCPToolExecutionEvent,
  MCPToolSavedEvent,
  Telemetry,
} from "@/client/telemetry";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { JsonRpcLoggerView } from "./logging/JsonRpcLoggerView";
import {
  SavedRequestsList,
  SaveRequestDialog,
  ToolExecutionPanel,
  ToolResultDisplay,
  ToolsList,
  ToolsTabHeader,
} from "./tools";

export interface ToolsTabRef {
  focusSearch: () => void;
  blurSearch: () => void;
}

interface ToolsTabProps {
  tools: Tool[];
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    options?: {
      timeout?: number;
      maxTotalTimeout?: number;
      resetTimeoutOnProgress?: boolean;
      signal?: AbortSignal;
    }
  ) => Promise<any>;
  readResource: (uri: string) => Promise<any>;
  serverId: string;
  isConnected: boolean;
}

const SAVED_REQUESTS_KEY = "mcp-inspector-saved-requests";

/**
 * Render the Tools tab UI for browsing, executing, and managing tools and saved requests.
 *
 * Renders a responsive interface with a searchable tools list and saved-requests list, a tool execution panel, a results history (with copying, deleting, fullscreen, preview and Apps SDK resource integration), and an RPC message logger. Supports mobile-specific navigation, resizable panels for desktop, saved request persistence, keyboard navigation, execution abort/timeout handling, and telemetry for executions and saved requests.
 *
 * @param ref - Optional imperative ref exposing `focusSearch` and `blurSearch` methods.
 * @param tools - Array of available tools to list and execute.
 * @param callTool - Function to invoke a tool by name with arguments and options (timeout, reset behavior, abort signal).
 * @param readResource - Function to fetch a resource by URI (used for Apps SDK output templates).
 * @param serverId - Identifier for the current server (used for telemetry and RPC filtering).
 * @param isConnected - Whether the inspector is connected to the server (affects execution UI).
 * @returns The React element for the Tools tab.
 */
export function ToolsTab({
  ref,
  tools,
  callTool,
  readResource,
  serverId,
  isConnected,
}: ToolsTabProps & { ref?: React.RefObject<ToolsTabRef | null> }) {
  // State
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedSavedRequest, setSelectedSavedRequest] =
    useState<SavedRequest | null>(null);
  const { selectedToolName, setSelectedToolName } = useInspector();
  const [toolArgs, setToolArgs] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<ToolResult[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [copiedResult, setCopiedResult] = useState<number | null>(null);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"tools" | "saved">("tools");
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [previewMode, setPreviewMode] = useState(true);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail" | "response">(
    "list"
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const [rpcMessageCount, setRpcMessageCount] = useState(0);
  const [rpcPanelCollapsed, setRpcPanelCollapsed] = useState(true);
  const [_rpcPanelSize, _setRpcPanelSize] = useState<number | undefined>(
    undefined
  );

  // Refs for resizable panels
  const leftPanelRef = useRef<any>(null);
  const topPanelRef = useRef<any>(null);
  const bottomPanelRef = useRef<any>(null);
  const rpcPanelRef = useRef<ImperativePanelHandle>(null);
  const clearRpcMessagesRef = useRef<(() => Promise<void>) | null>(null);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Handle mobile view transitions
  useEffect(() => {
    if (selectedTool) {
      setMobileView("detail");
    } else {
      setMobileView("list");
    }
  }, [selectedTool]);

  // Switch to response view when execution finishes (if on mobile)
  useEffect(() => {
    if (isMobile && results.length > 0 && !isExecuting) {
      setMobileView("response");
    }
  }, [results, isExecuting, isMobile]);

  // Expose focusSearch and blurSearch methods via ref
  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      setIsSearchExpanded(true);
      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 0);
    },
    blurSearch: () => {
      setSearchQuery("");
      setIsSearchExpanded(false);
      if (searchInputRef.current) {
        searchInputRef.current.blur();
      }
    },
  }));

  // Load saved requests from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_REQUESTS_KEY);
      if (saved) {
        setSavedRequests(JSON.parse(saved));
      }
    } catch (error) {
      console.error("[ToolsTab] Failed to load saved requests:", error);
    }
  }, []);

  // Save to localStorage whenever savedRequests changes
  const saveSavedRequests = useCallback((requests: SavedRequest[]) => {
    try {
      localStorage.setItem(SAVED_REQUESTS_KEY, JSON.stringify(requests));
      setSavedRequests(requests);
    } catch (error) {
      console.error("[ToolsTab] Failed to save requests:", error);
    }
  }, []);

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;

    const query = searchQuery.toLowerCase();
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(query) ||
        tool.description?.toLowerCase().includes(query)
    );
  }, [tools, searchQuery]);

  const handleToolSelect = useCallback((tool: Tool) => {
    setSelectedTool(tool);
    // Initialize args with default values based on tool input schema
    const initialArgs: Record<string, unknown> = {};
    if (tool.inputSchema?.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        const typedProp = prop as any;
        if (typedProp.default !== undefined) {
          initialArgs[key] = typedProp.default;
        } else if (typedProp.type === "string") {
          initialArgs[key] = "";
        } else if (typedProp.type === "number") {
          initialArgs[key] = 0;
        } else if (typedProp.type === "boolean") {
          initialArgs[key] = false;
        } else if (typedProp.type === "array") {
          // Initialize as empty JSON string to preserve formatting
          initialArgs[key] = "[]";
        } else if (typedProp.type === "object") {
          // Initialize as empty JSON string to preserve formatting
          initialArgs[key] = "{}";
        }
      });
    }
    setToolArgs(initialArgs);
  }, []);

  const loadSavedRequest = useCallback(
    (request: SavedRequest) => {
      const tool = tools.find((t) => t.name === request.toolName);
      if (tool) {
        setSelectedTool(tool);
        setToolArgs(request.args);
        setSelectedSavedRequest(request);
      }
    },
    [tools]
  );

  // Auto-focus the search input when expanded
  useEffect(() => {
    if (isSearchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchExpanded]);

  const handleSearchBlur = useCallback(() => {
    if (!searchQuery.trim()) {
      setIsSearchExpanded(false);
    }
  }, [searchQuery]);

  // Collapse search when switching away from tools tab
  useEffect(() => {
    if (activeTab !== "tools") {
      setIsSearchExpanded(false);
    }
  }, [activeTab]);

  // Reset focused index when filtered tools change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery, activeTab]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";

      if (isInputFocused || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const items = activeTab === "tools" ? filteredTools : savedRequests;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev + 1;
          return next >= items.length ? 0 : next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? items.length - 1 : next;
        });
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        if (activeTab === "tools") {
          const tool = filteredTools[focusedIndex];
          if (tool) {
            handleToolSelect(tool);
          }
        } else {
          const request = savedRequests[focusedIndex];
          if (request) {
            loadSavedRequest(request);
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedIndex,
    filteredTools,
    savedRequests,
    activeTab,
    handleToolSelect,
    loadSavedRequest,
  ]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId =
        activeTab === "tools"
          ? `tool-${filteredTools[focusedIndex]?.name}`
          : `saved-${savedRequests[focusedIndex]?.id}`;
      const element = document.getElementById(itemId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [focusedIndex, filteredTools, savedRequests, activeTab]);

  // Handle auto-selection from context
  useEffect(() => {
    if (selectedToolName && tools.length > 0) {
      const tool = tools.find((t) => t.name === selectedToolName);

      if (tool && selectedTool?.name !== tool.name) {
        setSelectedToolName(null);
        const timeoutId = setTimeout(() => {
          handleToolSelect(tool);
          const toolElement = document.getElementById(`tool-${tool.name}`);
          if (toolElement) {
            toolElement.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
        }, 100);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [
    selectedToolName,
    tools,
    selectedTool,
    handleToolSelect,
    setSelectedToolName,
  ]);

  const handleArgChange = useCallback(
    (key: string, value: string) => {
      setToolArgs((prev) => {
        const newArgs = { ...prev };

        if (selectedTool?.inputSchema?.properties?.[key]) {
          const prop = selectedTool.inputSchema.properties[key] as any;
          const expectedType = prop.type;

          // Keep object/array types as strings to preserve formatting and cursor position
          if (expectedType === "object" || expectedType === "array") {
            newArgs[key] = value;
          } else if (expectedType === "string") {
            newArgs[key] = value;
          } else {
            // For other types (number, boolean, etc.), try to parse
            try {
              newArgs[key] = JSON.parse(value);
            } catch {
              newArgs[key] = value;
            }
          }
        } else {
          // If no schema info, keep as string to be safe
          newArgs[key] = value;
        }

        return newArgs;
      });
    },
    [selectedTool]
  );

  const executeTool = useCallback(async () => {
    if (!selectedTool || isExecuting) return;

    // Create abort controller for this execution
    const controller = new AbortController();
    setAbortController(controller);
    setIsExecuting(true);
    const startTime = Date.now();

    try {
      // Parse JSON strings for object/array types before execution
      const parsedArgs = { ...toolArgs };
      if (selectedTool.inputSchema?.properties) {
        Object.entries(selectedTool.inputSchema.properties).forEach(
          ([key, prop]) => {
            const typedProp = prop as any;
            const expectedType = typedProp.type;
            const value = parsedArgs[key];

            // Parse JSON strings for object/array types
            if (
              (expectedType === "object" || expectedType === "array") &&
              typeof value === "string"
            ) {
              try {
                parsedArgs[key] = JSON.parse(value);
              } catch {
                // If parsing fails, keep the string value
                // The tool execution will handle the error
              }
            }
          }
        );
      }

      // Use a 10 minute timeout for tool calls, as tools may trigger sampling/elicitation
      // which can take a long time (waiting for LLM responses or human input)
      const result = await callTool(selectedTool.name, parsedArgs, {
        timeout: 600000, // 10 minutes
        resetTimeoutOnProgress: true, // Reset timeout when progress is received
        signal: controller.signal, // Pass abort signal
      });
      const duration = Date.now() - startTime;

      // Track successful tool execution
      const telemetry = Telemetry.getInstance();
      telemetry
        .capture(
          new MCPToolExecutionEvent({
            toolName: selectedTool.name,
            serverId,
            success: true,
            duration,
          })
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        });

      // Extract tool metadata from tool definition
      const toolMeta =
        (selectedTool as any)?._meta || (selectedTool as any)?.metadata;

      // Check tool metadata for Apps SDK component
      const openaiOutputTemplate = toolMeta?.["openai/outputTemplate"];
      let appsSdkResource:
        | {
            uri: string;
            resourceData: any;
            isLoading?: boolean;
            error?: string;
          }
        | undefined;

      if (openaiOutputTemplate && typeof openaiOutputTemplate === "string") {
        // Create the result entry with loading state first
        const resultEntry: ToolResult = {
          toolName: selectedTool.name,
          args: toolArgs,
          result,
          timestamp: startTime,
          duration,
          toolMeta,
          appsSdkResource: {
            uri: openaiOutputTemplate,
            resourceData: null,
            isLoading: true,
          },
        };

        // For Apps SDK components, replace results instead of appending
        setResults([resultEntry]);

        // Fetch the resource in the background
        try {
          const resourceData = await readResource(openaiOutputTemplate);

          // Extract structured content from result
          let structuredContent = null;
          if (result?.structuredContent) {
            structuredContent = result.structuredContent;
          } else if (Array.isArray(result) && result[0]) {
            const firstResult = result[0];
            if (firstResult.output?.value?.structuredContent) {
              structuredContent = firstResult.output.value.structuredContent;
            } else if (firstResult.structuredContent) {
              structuredContent = firstResult.structuredContent;
            } else if (firstResult.output?.value) {
              structuredContent = firstResult.output.value;
            }
          }

          // Fallback to entire result
          if (!structuredContent) {
            structuredContent = result;
          }

          appsSdkResource = {
            uri: openaiOutputTemplate,
            resourceData: {
              ...resourceData,
              structuredContent,
            },
            isLoading: false,
          };
        } catch (error) {
          appsSdkResource = {
            uri: openaiOutputTemplate,
            resourceData: null,
            isLoading: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        // Update the result with the fetched resource
        setResults((prev) =>
          prev.map((r, idx) => (idx === 0 ? { ...r, appsSdkResource } : r))
        );
      } else {
        // Normal result without Apps SDK resource - keep history
        setResults((prev) => [
          {
            toolName: selectedTool.name,
            args: toolArgs,
            result,
            timestamp: startTime,
            duration,
            toolMeta,
          },
          ...prev,
        ]);
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      // Track failed tool execution
      const telemetry = Telemetry.getInstance();
      telemetry
        .capture(
          new MCPToolExecutionEvent({
            toolName: selectedTool.name,
            serverId,
            success: false,
            duration,
            error: error instanceof Error ? error.message : String(error),
          })
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        });

      const toolMeta =
        (selectedTool as any)?._meta || (selectedTool as any)?.metadata;

      // For Apps SDK tools, replace results; otherwise append
      const errorResult = {
        toolName: selectedTool.name,
        args: toolArgs,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        timestamp: startTime,
        duration,
        toolMeta,
      };

      const isAppsSdkTool = toolMeta?.["openai/outputTemplate"];
      if (isAppsSdkTool) {
        setResults([errorResult]);
      } else {
        setResults((prev) => [errorResult, ...prev]);
      }
    } finally {
      setIsExecuting(false);
    }
  }, [selectedTool, toolArgs, isExecuting, callTool, readResource, serverId]);

  const handleCopyResult = useCallback(async (index: number, result: any) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopiedResult(index);
      setTimeout(() => setCopiedResult(null), 2000);
    } catch (error) {
      console.error("[ToolsTab] Failed to copy result:", error);
    }
  }, []);

  const handleDeleteResult = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Filter results to only show executions of the currently selected tool
  const filteredResults = useMemo(() => {
    if (!selectedTool) return [];
    return results.filter((r) => r.toolName === selectedTool.name);
  }, [results, selectedTool]);

  const handleFullscreen = useCallback(
    (index: number) => {
      const result = filteredResults[index];
      if (result) {
        const newWindow = window.open("", "_blank", "width=800,height=600");
        if (newWindow) {
          newWindow.document.write(`
            <html>
              <head>
                <title>${result.toolName} Result</title>
                <style>
                  body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
                  pre { white-space: pre-wrap; word-wrap: break-word; }
                </style>
              </head>
              <body>
                <h2>${result.toolName}</h2>
                <pre>${JSON.stringify(result.result, null, 2)}</pre>
              </body>
            </html>
          `);
          newWindow.document.close();
        }
      }
    },
    [results]
  );

  const handleMaximize = useCallback(() => {
    if (!isMaximized) {
      // Maximize: collapse left panel and top panel
      if (leftPanelRef.current) {
        leftPanelRef.current.collapse();
      }
      if (topPanelRef.current) {
        topPanelRef.current.collapse();
      }
      setIsMaximized(true);
    } else {
      // Restore: expand left panel and top panel
      if (leftPanelRef.current) {
        leftPanelRef.current.expand();
      }
      if (topPanelRef.current) {
        topPanelRef.current.expand();
      }
      setIsMaximized(false);
    }
  }, [isMaximized]);

  const openSaveDialog = useCallback(() => {
    if (!selectedTool) return;
    setRequestName("");
    setSaveDialogOpen(true);
  }, [selectedTool]);

  const saveRequest = useCallback(() => {
    if (!selectedTool) return;

    const newRequest: SavedRequest = {
      id: `${Date.now()}-${Math.random()}`,
      name:
        requestName.trim() ||
        `${selectedTool.name} - ${new Date().toLocaleString()}`,
      toolName: selectedTool.name,
      args: toolArgs,
      savedAt: Date.now(),
      serverId: (selectedTool as any)._serverId,
      serverName: (selectedTool as any)._serverName,
    };

    saveSavedRequests([...savedRequests, newRequest]);

    // Track tool saved
    const telemetry = Telemetry.getInstance();
    telemetry
      .capture(
        new MCPToolSavedEvent({
          toolName: selectedTool.name,
          serverId,
        })
      )
      .catch(() => {
        // Silently fail - telemetry should not break the application
      });

    setSaveDialogOpen(false);
    setRequestName("");
  }, [
    selectedTool,
    requestName,
    toolArgs,
    savedRequests,
    saveSavedRequests,
    serverId,
  ]);

  const deleteSavedRequest = useCallback(
    (id: string) => {
      saveSavedRequests(savedRequests.filter((r) => r.id !== id));
      // Clear selection if the deleted request was selected
      if (selectedSavedRequest?.id === id) {
        setSelectedSavedRequest(null);
      }
    },
    [savedRequests, saveSavedRequests, selectedSavedRequest]
  );

  if (isMobile) {
    return (
      <div className="h-full flex flex-col overflow-hidden relative bg-background">
        {/* Breadcrumbs / Header - Only show when not on list view */}
        {mobileView !== "list" && (
          <div className="flex items-center gap-2 p-2 border-b shrink-0 bg-background z-10">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (mobileView === "response") {
                  setMobileView("detail");
                } else {
                  setSelectedTool(null);
                  setMobileView("list");
                }
              }}
              className="p-0 h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center text-sm font-medium">
              <button
                onClick={() => {
                  setSelectedTool(null);
                  setMobileView("list");
                }}
                className="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
              >
                Tools
              </button>
              {mobileView === "detail" && (
                <>
                  <span className="mx-2 text-muted-foreground">/</span>
                  <button
                    onClick={() => {
                      setMobileView("response");
                    }}
                    className={
                      mobileView === "detail"
                        ? "text-foreground hover:underline"
                        : mobileView === "response"
                          ? "text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                          : "text-muted-foreground"
                    }
                  >
                    Execute
                  </button>
                </>
              )}
              {mobileView === "response" && (
                <>
                  <span className="mx-2 text-muted-foreground">/</span>
                  <span className="text-foreground">Response</span>
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            {mobileView === "list" && (
              <motion.div
                key="list"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 flex flex-col bg-background z-0"
              >
                <ToolsTabHeader
                  activeTab={activeTab}
                  isSearchExpanded={isSearchExpanded}
                  searchQuery={searchQuery}
                  filteredToolsCount={filteredTools.length}
                  savedRequestsCount={savedRequests.length}
                  onSearchExpand={() => setIsSearchExpanded(true)}
                  onSearchChange={setSearchQuery}
                  onSearchBlur={handleSearchBlur}
                  onTabSwitch={() =>
                    setActiveTab(activeTab === "tools" ? "saved" : "tools")
                  }
                  searchInputRef={
                    searchInputRef as React.RefObject<HTMLInputElement>
                  }
                />
                {activeTab === "tools" ? (
                  <ToolsList
                    tools={filteredTools}
                    selectedTool={selectedTool}
                    onToolSelect={handleToolSelect}
                    focusedIndex={focusedIndex}
                  />
                ) : (
                  <SavedRequestsList
                    savedRequests={savedRequests}
                    selectedRequest={selectedSavedRequest}
                    onLoadRequest={loadSavedRequest}
                    onDeleteRequest={deleteSavedRequest}
                    focusedIndex={focusedIndex}
                  />
                )}
              </motion.div>
            )}

            {mobileView === "detail" && (
              <motion.div
                key="detail"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 bg-background z-10"
              >
                <ToolExecutionPanel
                  selectedTool={selectedTool}
                  toolArgs={toolArgs}
                  isExecuting={isExecuting}
                  isConnected={isConnected}
                  onArgChange={handleArgChange}
                  onExecute={executeTool}
                  onSave={openSaveDialog}
                />
              </motion.div>
            )}

            {mobileView === "response" && (
              <motion.div
                key="response"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 bg-background z-20"
              >
                <ToolResultDisplay
                  results={filteredResults}
                  copiedResult={copiedResult}
                  previewMode={previewMode}
                  serverId={serverId}
                  readResource={readResource}
                  onCopy={handleCopyResult}
                  onDelete={handleDeleteResult}
                  onFullscreen={handleFullscreen}
                  onTogglePreview={() => setPreviewMode(!previewMode)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <SaveRequestDialog
          isOpen={saveDialogOpen}
          requestName={requestName}
          defaultPlaceholder={`${selectedTool?.name} - ${new Date().toLocaleString()}`}
          onRequestNameChange={setRequestName}
          onSave={saveRequest}
          onCancel={() => setSaveDialogOpen(false)}
        />
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel
        ref={leftPanelRef}
        defaultSize={33}
        collapsible
        className="flex flex-col h-full relative"
      >
        <ResizablePanelGroup
          direction="vertical"
          className="h-full border-r dark:border-zinc-700"
        >
          <ResizablePanel defaultSize={75} minSize={30}>
            <div className="flex flex-col h-full overflow-hidden">
              <ToolsTabHeader
                activeTab={activeTab}
                isSearchExpanded={isSearchExpanded}
                searchQuery={searchQuery}
                filteredToolsCount={filteredTools.length}
                savedRequestsCount={savedRequests.length}
                onSearchExpand={() => setIsSearchExpanded(true)}
                onSearchChange={setSearchQuery}
                onSearchBlur={handleSearchBlur}
                onTabSwitch={() =>
                  setActiveTab(activeTab === "tools" ? "saved" : "tools")
                }
                searchInputRef={
                  searchInputRef as React.RefObject<HTMLInputElement>
                }
              />

              {activeTab === "tools" ? (
                <ToolsList
                  tools={filteredTools}
                  selectedTool={selectedTool}
                  onToolSelect={handleToolSelect}
                  focusedIndex={focusedIndex}
                />
              ) : (
                <SavedRequestsList
                  savedRequests={savedRequests}
                  selectedRequest={selectedSavedRequest}
                  onLoadRequest={loadSavedRequest}
                  onDeleteRequest={deleteSavedRequest}
                  focusedIndex={focusedIndex}
                />
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            ref={rpcPanelRef}
            defaultSize={0}
            collapsible
            minSize={5}
            collapsedSize={5}
            style={{
              minHeight: 45,
            }}
            onCollapse={() => {
              setRpcPanelCollapsed(true);
            }}
            onExpand={() => {
              setRpcPanelCollapsed(false);
            }}
            className="flex flex-col border-t dark:border-zinc-700"
          >
            <div
              className="group flex items-center justify-between p-3 shrink-0 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (rpcPanelCollapsed) {
                  // Expand to 25% of parent height
                  rpcPanelRef.current?.resize(25);
                  setRpcPanelCollapsed(false);
                } else {
                  // Collapse to minimum size
                  rpcPanelRef.current?.resize(5);
                  setRpcPanelCollapsed(true);
                }
              }}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">RPC Messages</h3>
                {rpcMessageCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
                  >
                    {rpcMessageCount}
                  </Badge>
                )}
                {rpcMessageCount > 0 && !rpcPanelCollapsed && (
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
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={67}>
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel ref={topPanelRef} defaultSize={40} collapsible>
            <ToolExecutionPanel
              selectedTool={selectedTool}
              toolArgs={toolArgs}
              isExecuting={isExecuting}
              isConnected={isConnected}
              onArgChange={handleArgChange}
              onExecute={executeTool}
              onSave={openSaveDialog}
              onCancel={() => {
                if (abortController) {
                  abortController.abort();
                }
              }}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel ref={bottomPanelRef} defaultSize={60}>
            <div className="flex flex-col h-full">
              <ToolResultDisplay
                results={filteredResults}
                copiedResult={copiedResult}
                previewMode={previewMode}
                serverId={serverId}
                readResource={readResource}
                onCopy={handleCopyResult}
                onDelete={handleDeleteResult}
                onFullscreen={handleFullscreen}
                onTogglePreview={() => setPreviewMode(!previewMode)}
                onMaximize={handleMaximize}
                isMaximized={isMaximized}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <SaveRequestDialog
        isOpen={saveDialogOpen}
        requestName={requestName}
        defaultPlaceholder={`${
          selectedTool?.name
        } - ${new Date().toLocaleString()}`}
        onRequestNameChange={setRequestName}
        onSave={saveRequest}
        onCancel={() => setSaveDialogOpen(false)}
      />
    </ResizablePanelGroup>
  );
}

ToolsTab.displayName = "ToolsTab";