import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { useInspector } from "@/client/context/InspectorContext";
import { MCPPromptCallEvent, Telemetry } from "@/client/telemetry";
import type { Prompt } from "@mcp-use/modelcontextprotocol-sdk/types.js";
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
import type { ImperativePanelHandle } from "react-resizable-panels";
import { JsonRpcLoggerView } from "./logging/JsonRpcLoggerView";
import type { PromptResult, SavedPrompt } from "./prompts";
import {
  PromptExecutionPanel,
  PromptResultDisplay,
  PromptsList,
  PromptsTabHeader,
  SavedPromptsList,
} from "./prompts";

export interface PromptsTabRef {
  focusSearch: () => void;
  blurSearch: () => void;
}

interface PromptsTabProps {
  prompts: Prompt[];
  callPrompt: (name: string, args?: Record<string, unknown>) => Promise<any>;
  serverId: string;
  isConnected: boolean;
}

const SAVED_PROMPTS_KEY = "mcp-inspector-saved-prompts";

/**
 * Render the Prompts tab UI for browsing, selecting, executing, saving, and inspecting prompts.
 *
 * The component manages prompt selection, argument state, execution results, saved prompts (persisted
 * to localStorage), keyboard navigation, responsive mobile/desktop layouts, RPC message viewing,
 * and exposes `focusSearch` / `blurSearch` via the forwarded ref.
 *
 * @param ref - Optional forwarded ref exposing `focusSearch` and `blurSearch` methods.
 * @param prompts - The list of available prompts to display.
 * @param callPrompt - Function invoked to execute a prompt by name with an arguments object.
 * @param serverId - Identifier for the current server; used for RPC scoping and telemetry.
 * @param isConnected - Whether the application is currently connected to the backend (controls execution availability).
 * @returns The PromptsTab UI element.
 */
export function PromptsTab({
  ref,
  prompts,
  callPrompt,
  serverId,
  isConnected,
}: PromptsTabProps & { ref?: React.RefObject<PromptsTabRef | null> }) {
  // State
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedSavedPrompt, setSelectedSavedPrompt] =
    useState<SavedPrompt | null>(null);
  const { selectedPromptName, setSelectedPromptName } = useInspector();
  const [promptArgs, setPromptArgs] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<PromptResult[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [copiedResult, setCopiedResult] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"prompts" | "saved">("prompts");
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [_saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [_promptName, setPromptName] = useState("");
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail" | "response">(
    "list"
  );
  const [rpcMessageCount, setRpcMessageCount] = useState(0);
  const [rpcPanelCollapsed, setRpcPanelCollapsed] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const rpcPanelRef = useRef<ImperativePanelHandle>(null);
  const clearRpcMessagesRef = useRef<(() => Promise<void>) | null>(null);
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const topPanelRef = useRef<ImperativePanelHandle>(null);

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
    if (selectedPrompt) {
      setMobileView("detail");
    } else {
      setMobileView("list");
    }
  }, [selectedPrompt]);

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

  // Load saved prompts from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_PROMPTS_KEY);
      if (saved) {
        const parsedPrompts = JSON.parse(saved);
        setSavedPrompts(parsedPrompts);
      }
    } catch (error) {
      console.error("[PromptsTab] Failed to load saved prompts:", error);
    }
  }, []);

  // Save to localStorage whenever savedPrompts changes
  const saveSavedPrompts = useCallback((prompts: SavedPrompt[]) => {
    try {
      localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts));
    } catch (error) {
      console.error("[PromptsTab] Failed to save prompts:", error);
    }
  }, []);

  // Auto-focus search input when expanded
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

  // Filter prompts based on search query
  const filteredPrompts = useMemo(() => {
    if (!searchQuery.trim()) return prompts;

    const query = searchQuery.toLowerCase();
    return prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.description?.toLowerCase().includes(query)
    );
  }, [prompts, searchQuery]);

  const handlePromptSelect = useCallback((prompt: Prompt) => {
    setSelectedPrompt(prompt);
    // Initialize args with default values based on prompt input schema
    const initialArgs: Record<string, unknown> = {};
    if (prompt.arguments) {
      // Handle MCP SDK structure: arguments is an array of PromptArgument objects
      prompt.arguments.forEach((arg) => {
        initialArgs[arg.name] = "";
      });
    }
    setPromptArgs(initialArgs);
  }, []);

  const loadSavedPrompt = useCallback(
    (prompt: SavedPrompt) => {
      const promptObj = prompts.find((p) => p.name === prompt.promptName);
      if (promptObj) {
        setSelectedPrompt(promptObj);
        setPromptArgs(prompt.args);
        setSelectedSavedPrompt(prompt);
      }
    },
    [prompts]
  );

  // Reset focused index when filtered prompts change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery, activeTab]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      // Check if any input is focused
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";

      // Don't handle if input is focused or if modifiers are pressed
      if (isInputFocused || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const items = activeTab === "prompts" ? filteredPrompts : savedPrompts;

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
        if (activeTab === "prompts") {
          const prompt = filteredPrompts[focusedIndex];
          if (prompt) {
            handlePromptSelect(prompt);
          }
        } else {
          const prompt = savedPrompts[focusedIndex];
          if (prompt) {
            loadSavedPrompt(prompt);
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedIndex,
    filteredPrompts,
    savedPrompts,
    activeTab,
    handlePromptSelect,
    loadSavedPrompt,
  ]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId =
        activeTab === "prompts"
          ? `prompt-${filteredPrompts[focusedIndex]?.name}`
          : `saved-prompt-${savedPrompts[focusedIndex]?.id}`;
      const element = document.getElementById(itemId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [focusedIndex, filteredPrompts, savedPrompts, activeTab]);

  // Handle auto-selection from context
  useEffect(() => {
    console.warn("[PromptsTab] Auto-selection effect triggered:", {
      selectedPromptName,
      promptsCount: prompts.length,
      currentSelectedPrompt: selectedPrompt?.name,
    });

    if (selectedPromptName && prompts.length > 0) {
      const prompt = prompts.find((p) => p.name === selectedPromptName);
      console.warn("[PromptsTab] Prompt lookup result:", {
        selectedPromptName,
        promptFound: !!prompt,
        promptName: prompt?.name,
        shouldSelect: prompt && selectedPrompt?.name !== prompt.name,
      });

      if (prompt && selectedPrompt?.name !== prompt.name) {
        console.warn("[PromptsTab] Selecting prompt:", prompt.name);
        // Clear the selection from context after processing
        setSelectedPromptName(null);
        // Use setTimeout to ensure the component is fully rendered
        const timeoutId = setTimeout(() => {
          handlePromptSelect(prompt);
          // Scroll to the selected prompt
          const promptElement = document.getElementById(
            `prompt-${prompt.name}`
          );
          if (promptElement) {
            console.warn("[PromptsTab] Scrolling to prompt element");
            promptElement.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
        }, 100);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [
    selectedPromptName,
    prompts,
    selectedPrompt,
    handlePromptSelect,
    setSelectedPromptName,
  ]);

  const handleArgChange = useCallback((key: string, value: any) => {
    setPromptArgs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const executePrompt = useCallback(async () => {
    if (!selectedPrompt || isExecuting) return;

    setIsExecuting(true);
    const startTime = Date.now();

    try {
      const result = await callPrompt(selectedPrompt.name, promptArgs);
      const duration = Date.now() - startTime;

      // Track successful prompt call
      const telemetry = Telemetry.getInstance();
      telemetry
        .capture(
          new MCPPromptCallEvent({
            promptName: selectedPrompt.name,
            serverId,
            success: true,
          })
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        });

      setResults((prev) => [
        {
          promptName: selectedPrompt.name,
          args: promptArgs,
          result,
          timestamp: startTime,
          duration,
        },
        ...prev,
      ]);
    } catch (error) {
      // Track failed prompt call
      const telemetry = Telemetry.getInstance();
      telemetry
        .capture(
          new MCPPromptCallEvent({
            promptName: selectedPrompt.name,
            serverId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          })
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        });

      const errorResult = {
        promptName: selectedPrompt.name,
        args: promptArgs,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        timestamp: startTime,
        duration: Date.now() - startTime,
      };

      setResults((prev) => [
        ...prev,
        { ...errorResult, result: { messages: [] } },
      ]);
    } finally {
      setIsExecuting(false);
    }
  }, [selectedPrompt, promptArgs, isExecuting, callPrompt, serverId]);

  const handleCopyResult = useCallback(async (index: number, result: any) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopiedResult(index);
      setTimeout(() => setCopiedResult(null), 2000);
    } catch (error) {
      console.error("[PromptsTab] Failed to copy result:", error);
    }
  }, []);

  const handleDeleteResult = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFullscreen = useCallback(
    (index: number) => {
      // On mobile, show fullscreen view
      if (isMobile) {
        setMobileView("response");
      } else {
        // On desktop, open in new window
        const result = results[index];
        if (result) {
          const newWindow = window.open("", "_blank", "width=800,height=600");
          if (newWindow) {
            const resultData = result.result;
            newWindow.document.write(`
            <html>
              <head>
                <title>${result.promptName} Result</title>
                <style>
                  body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
                  pre { white-space: pre-wrap; word-wrap: break-word; }
                </style>
              </head>
              <body>
                <h2>${result.promptName}</h2>
                <pre>${JSON.stringify(resultData, null, 2)}</pre>
              </body>
            </html>
          `);
            newWindow.document.close();
          }
        }
      }
    },
    [isMobile, results]
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
    if (!selectedPrompt) return;
    setPromptName("");
    setSaveDialogOpen(true);
  }, [selectedPrompt]);

  const deleteSavedPrompt = useCallback(
    (id: string) => {
      saveSavedPrompts(savedPrompts.filter((p) => p.id !== id));
      // Clear selection if the deleted prompt was selected
      if (selectedSavedPrompt?.id === id) {
        setSelectedSavedPrompt(null);
      }
    },
    [savedPrompts, saveSavedPrompts, selectedSavedPrompt]
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
                  setSelectedPrompt(null);
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
                  setSelectedPrompt(null);
                  setMobileView("list");
                }}
                className="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
              >
                Prompts
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
                <PromptsTabHeader
                  activeTab={activeTab}
                  isSearchExpanded={isSearchExpanded}
                  searchQuery={searchQuery}
                  filteredPromptsCount={filteredPrompts.length}
                  savedPromptsCount={savedPrompts.length}
                  onSearchExpand={() => setIsSearchExpanded(true)}
                  onSearchChange={setSearchQuery}
                  onSearchBlur={handleSearchBlur}
                  onTabSwitch={() =>
                    setActiveTab(activeTab === "prompts" ? "saved" : "prompts")
                  }
                  searchInputRef={
                    searchInputRef as React.RefObject<HTMLInputElement>
                  }
                />
                {activeTab === "prompts" ? (
                  <PromptsList
                    prompts={filteredPrompts}
                    selectedPrompt={selectedPrompt}
                    onPromptSelect={handlePromptSelect}
                    focusedIndex={focusedIndex}
                  />
                ) : (
                  <SavedPromptsList
                    savedPrompts={savedPrompts}
                    selectedPrompt={selectedSavedPrompt}
                    onLoadPrompt={loadSavedPrompt}
                    onDeletePrompt={deleteSavedPrompt}
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
                <PromptExecutionPanel
                  selectedPrompt={selectedPrompt}
                  promptArgs={promptArgs}
                  isExecuting={isExecuting}
                  isConnected={isConnected}
                  onArgChange={handleArgChange}
                  onExecute={executePrompt}
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
                <PromptResultDisplay
                  results={results}
                  copiedResult={copiedResult}
                  onCopy={handleCopyResult}
                  onDelete={handleDeleteResult}
                  onFullscreen={handleFullscreen}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
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
              <PromptsTabHeader
                activeTab={activeTab}
                isSearchExpanded={isSearchExpanded}
                searchQuery={searchQuery}
                filteredPromptsCount={filteredPrompts.length}
                savedPromptsCount={savedPrompts.length}
                onSearchExpand={() => setIsSearchExpanded(true)}
                onSearchChange={setSearchQuery}
                onSearchBlur={handleSearchBlur}
                onTabSwitch={() =>
                  setActiveTab(activeTab === "prompts" ? "saved" : "prompts")
                }
                searchInputRef={
                  searchInputRef as React.RefObject<HTMLInputElement>
                }
              />

              {activeTab === "prompts" ? (
                <PromptsList
                  prompts={filteredPrompts}
                  selectedPrompt={selectedPrompt}
                  onPromptSelect={handlePromptSelect}
                  focusedIndex={focusedIndex}
                />
              ) : (
                <SavedPromptsList
                  savedPrompts={savedPrompts}
                  selectedPrompt={selectedSavedPrompt}
                  onLoadPrompt={loadSavedPrompt}
                  onDeletePrompt={deleteSavedPrompt}
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
            onCollapse={() => setRpcPanelCollapsed(true)}
            onExpand={() => setRpcPanelCollapsed(false)}
            className="flex flex-col border-t dark:border-zinc-700"
          >
            <div
              className="group flex items-center justify-between p-3 shrink-0 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (rpcPanelCollapsed) {
                  rpcPanelRef.current?.resize(25);
                  setRpcPanelCollapsed(false);
                } else {
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
                  !rpcPanelCollapsed ? "" : "rotate-180"
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
            <PromptExecutionPanel
              selectedPrompt={selectedPrompt}
              promptArgs={promptArgs}
              isExecuting={isExecuting}
              isConnected={isConnected}
              onArgChange={handleArgChange}
              onExecute={executePrompt}
              onSave={openSaveDialog}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50}>
            <div className="flex flex-col h-full">
              <PromptResultDisplay
                results={results}
                copiedResult={copiedResult}
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
    </ResizablePanelGroup>
  );
}

PromptsTab.displayName = "PromptsTab";
