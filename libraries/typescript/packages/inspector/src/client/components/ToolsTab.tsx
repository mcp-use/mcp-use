import { Button } from "@/client/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@/client/components/ui/resizable";
import { useInspector } from "@/client/context/InspectorContext";
import {
  MCPToolExecutionEvent,
  MCPToolSavedEvent,
  Telemetry,
} from "@/client/telemetry";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { RpcPanel } from "./shared";
import type { SavedRequest, ToolResult } from "./tools";
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
  refreshTools?: () => Promise<void>;
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
  refreshTools,
}: ToolsTabProps & { ref?: React.RefObject<ToolsTabRef | null> }) {
  // State
  const [isRefreshing, setIsRefreshing] = useState(false);
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
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail" | "response">(
    "list"
  );
  const [isMaximized, setIsMaximized] = useState(false);

  const leftPanelRef = usePanelRef();
  const toolParamsPanelRef = usePanelRef();

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

  const handleMaximize = useCallback(() => {
    if (!isMaximized) {
      // Maximize: collapse left panel and top panel
      if (leftPanelRef.current) {
        leftPanelRef.current.collapse();
      }
      if (toolParamsPanelRef.current) {
        toolParamsPanelRef.current.collapse();
      }
      setIsMaximized(true);
    } else {
      // Restore: expand left panel and top panel
      if (leftPanelRef.current) {
        leftPanelRef.current.expand();
      }
      if (toolParamsPanelRef.current) {
        toolParamsPanelRef.current.expand();
      }
      setIsMaximized(false);
    }
  }, [isMaximized, leftPanelRef, toolParamsPanelRef]);

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

  const handleRefresh = useCallback(async () => {
    if (!refreshTools) return;
    setIsRefreshing(true);
    try {
      await refreshTools();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshTools]);

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

  // Sync selectedTool with updated tools list (for HMR support)
  // When tools change via HMR, update selectedTool to the new object reference
  // or clear it if the tool was removed
  useEffect(() => {
    if (selectedTool) {
      const updatedTool = tools.find((t) => t.name === selectedTool.name);
      if (!updatedTool) {
        // Tool was removed - clear selection
        setSelectedTool(null);
        setSelectedToolName(null);
      } else if (updatedTool !== selectedTool) {
        // Tool definition changed - update the reference
        // We compare by reference to detect if it's a different object
        const hasChanges =
          JSON.stringify(updatedTool.inputSchema) !==
            JSON.stringify(selectedTool.inputSchema) ||
          updatedTool.description !== selectedTool.description;
        if (hasChanges) {
          setSelectedTool(updatedTool);
        }
      }
    }
  }, [tools, selectedTool, setSelectedToolName]);

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

      // Extract tool metadata BEFORE executing to detect widget tools
      const toolMeta =
        (selectedTool as any)?._meta || (selectedTool as any)?.metadata;

      // Check tool metadata for widget resources (MCP Apps or ChatGPT Apps)
      const mcpAppsResourceUri = toolMeta?.ui?.resourceUri;
      const openaiOutputTemplate = toolMeta?.["openai/outputTemplate"];
      const widgetResourceUri = mcpAppsResourceUri || openaiOutputTemplate;

      // Pre-fetch widget resource if this is a widget tool (Issue #930 fix)
      let preFetchedResource: any = null;
      if (widgetResourceUri && typeof widgetResourceUri === "string") {
        // Create result entry with loading state BEFORE executing tool
        const pendingResultEntry: ToolResult = {
          toolName: selectedTool.name,
          args: parsedArgs,
          result: null, // No result yet
          timestamp: startTime,
          duration: 0,
          toolMeta,
          appsSdkResource: {
            uri: widgetResourceUri,
            resourceData: null,
            isLoading: true,
          },
        };

        // For widget components, replace results instead of appending
        setResults([pendingResultEntry]);

        // Pre-fetch the resource BEFORE executing the tool
        try {
          preFetchedResource = await readResource(widgetResourceUri);

          // Update result entry with fetched resource (but no tool result yet)
          setResults((prev) =>
            prev.map((r, idx) =>
              idx === 0
                ? {
                    ...r,
                    appsSdkResource: {
                      uri: widgetResourceUri,
                      resourceData: preFetchedResource,
                      isLoading: false,
                    },
                  }
                : r
            )
          );

          // Small delay to ensure widget iframe loads and shows pending state
          // before we update it with the result (prevents race condition for fast tools)
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          // Continue with tool execution even if resource fetch fails
        }
      }

      // Use a 10 minute timeout for tool calls, as tools may trigger sampling/elicitation
      // which can take a long time (waiting for LLM responses or human input)
      const result = await callTool(selectedTool.name, parsedArgs, {
        timeout: 600000, // 10 minutes
        resetTimeoutOnProgress: true, // Reset timeout when progress is received
        signal: controller.signal, // Pass abort signal
      });
      const duration = Date.now() - startTime;

      // Update toolMeta with result's _meta if present (for dynamic metadata from tool execution)
      // This is important for HMR where tool results may have updated metadata
      const updatedToolMeta = result?._meta
        ? { ...toolMeta, ...result._meta }
        : toolMeta;

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

      // Widget resource was already fetched before tool execution (if applicable)
      // Now we just need to update the result with tool output
      let appsSdkResource:
        | {
            uri: string;
            resourceData: any;
            isLoading?: boolean;
            error?: string;
          }
        | undefined;

      if (widgetResourceUri && typeof widgetResourceUri === "string") {
        // Use pre-fetched resource if available
        let resourceData = preFetchedResource;

        // If pre-fetch failed or didn't happen, fetch now as fallback
        if (!resourceData) {
          try {
            resourceData = await readResource(widgetResourceUri);
          } catch (fetchError) {
            resourceData = null;
          }
        }

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

        appsSdkResource = resourceData
          ? {
              uri: widgetResourceUri,
              resourceData: {
                ...resourceData,
                structuredContent,
              },
              isLoading: false,
            }
          : {
              uri: widgetResourceUri,
              resourceData: null,
              isLoading: false,
              error: "Failed to fetch widget resource",
            };

        // Update the result with the tool output
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === 0
              ? {
                  ...r,
                  result,
                  duration,
                  appsSdkResource,
                  toolMeta: updatedToolMeta, // Include updated tool metadata for dual-protocol widget detection
                }
              : r
          )
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
            toolMeta: updatedToolMeta,
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

      const hasWidgetResource =
        toolMeta?.ui?.resourceUri || toolMeta?.["openai/outputTemplate"];
      if (hasWidgetResource) {
        setResults([errorResult]);
      } else {
        setResults((prev) => [errorResult, ...prev]);
      }
    } finally {
      setIsExecuting(false);
    }
  }, [selectedTool, toolArgs, isExecuting, callTool, readResource, serverId]);

  const handleCopyResult = useCallback(async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
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
                  onRefresh={refreshTools ? handleRefresh : undefined}
                  isRefreshing={isRefreshing}
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
                  serverId={serverId}
                  readResource={readResource}
                  onCopy={handleCopyResult}
                  onDelete={handleDeleteResult}
                  onFullscreen={handleFullscreen}
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
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel
        id="left-panel"
        defaultSize="33%"
        minSize="20%"
        collapsible
        className="flex flex-col h-full relative"
        panelRef={leftPanelRef}
      >
        <ResizablePanelGroup
          orientation="vertical"
          className="h-full border-r dark:border-zinc-700"
        >
          <ResizablePanel minSize="30%">
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
                onRefresh={refreshTools ? handleRefresh : undefined}
                isRefreshing={isRefreshing}
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

          <RpcPanel serverId={serverId} />
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize="67%">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel
            defaultSize="40%"
            collapsible
            panelRef={toolParamsPanelRef}
          >
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

          <ResizablePanel defaultSize="60%">
            <div className="flex flex-col h-full">
              <ToolResultDisplay
                results={filteredResults}
                copiedResult={copiedResult}
                serverId={serverId}
                readResource={readResource}
                onCopy={handleCopyResult}
                onDelete={handleDeleteResult}
                onFullscreen={handleFullscreen}
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
