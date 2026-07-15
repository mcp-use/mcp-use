import { Button } from "@/client/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@/client/components/ui/resizable";
import { useInspector } from "@/client/context/InspectorContext";
import { MCPToolSavedEvent, captureInspectorEvent } from "@/client/telemetry";
import type { Tool } from "@modelcontextprotocol/client";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, Database, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { InspectorScrollArea, ListTabHeader } from "./shared";
import type { SavedRequest } from "./tools/SavedRequestsList";
import { SavedRequestsList } from "./tools/SavedRequestsList";
import { SaveRequestDialog } from "./tools/SaveRequestDialog";
import { ToolExecutionPanel } from "./tools/ToolExecutionPanel";
import { ToolResultDisplay } from "./tools/ToolResultDisplay";
import { ToolsList } from "./tools/ToolsList";
import {
  coerceExecutionArgByType,
  coerceTextInputValueByType,
  getToolPropertyType,
  parseObjectFromPaste,
} from "./tools/schema-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { useSavedRequests } from "@/client/hooks/useSavedRequests";
import { useToolExecution } from "./tools/useToolExecution";
import { useToolsTabNavigation } from "./tools/useToolsTabNavigation";

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

/**
 * Render the Tools tab UI for browsing, executing, and managing tools and saved requests.
 *
 * Renders a responsive interface with a searchable tools list and saved-requests list, a tool execution panel, a results history (with copying, deleting, fullscreen, preview and MCP Apps widget integration), and an RPC message logger. Supports mobile-specific navigation, resizable panels for desktop, saved request persistence, keyboard navigation, execution abort/timeout handling, and telemetry for executions and saved requests.
 *
 * @param ref - Optional imperative ref exposing `focusSearch` and `blurSearch` methods.
 * @param tools - Array of available tools to list and execute.
 * @param callTool - Function to invoke a tool by name with arguments and options (timeout, reset behavior, abort signal).
 * @param readResource - Function to fetch a resource by URI (used for MCP Apps widget prefetch).
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
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedSavedRequest, setSelectedSavedRequest] =
    useState<SavedRequest | null>(null);
  const { selectedToolName, setSelectedToolName } = useInspector();
  const [toolArgs, setToolArgs] = useState<Record<string, unknown>>({});
  const [setFields, setSetFields] = useState<Set<string>>(new Set());
  const [sendEmptyFields, setSendEmptyFields] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"tools" | "saved">("tools");
  const { savedRequests, saveSavedRequests } = useSavedRequests();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);

  // Auto-fill state
  const [autoFillDialog, setAutoFillDialog] = useState<{
    open: boolean;
    parsedObject: Record<string, unknown>;
    fieldsToUpdate: Array<{
      key: string;
      oldValue: unknown;
      newValue: unknown;
    }>;
    newFields: string[];
    resolve: ((value: boolean) => void) | null;
  }>({
    open: false,
    parsedObject: {},
    fieldsToUpdate: [],
    newFields: [],
    resolve: null,
  });
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(
    new Set()
  );

  const leftPanelRef = usePanelRef();
  const toolParamsPanelRef = usePanelRef();

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
    // Only initialize fields that have schema defaults; others start unset (not sent)
    const initialArgs: Record<string, unknown> = {};
    const initialSetFields = new Set<string>();
    if (tool.inputSchema?.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        const typedProp = prop as { default?: unknown };
        if (typedProp.default !== undefined) {
          initialArgs[key] = typedProp.default;
          initialSetFields.add(key);
        }
      });
    }
    setToolArgs(initialArgs);
    setSetFields(initialSetFields);
    setSendEmptyFields(new Set());
  }, []);

  const loadSavedRequest = useCallback(
    (request: SavedRequest) => {
      const tool = tools.find((t) => t.name === request.toolName);
      if (tool) {
        setSelectedTool(tool);
        setToolArgs(request.args);
        setSetFields(new Set(Object.keys(request.args)));
        setSendEmptyFields(new Set());
        setSelectedSavedRequest(request);
      }
    },
    [tools]
  );

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
          updatedTool.description !== selectedTool.description ||
          JSON.stringify((updatedTool as any)?._meta) !==
            JSON.stringify((selectedTool as any)?._meta);
        if (hasChanges) {
          setSelectedTool(updatedTool);
        }
      }
    }
  }, [tools, selectedTool, setSelectedToolName]);

  const handleArgChange = useCallback(
    (key: string, value: string) => {
      const rootSchema = (selectedTool?.inputSchema || {}) as Record<
        string,
        unknown
      >;
      const prop = selectedTool?.inputSchema?.properties?.[key];
      const expectedType = prop
        ? getToolPropertyType(prop, rootSchema)
        : "string";

      let processedValue: unknown;
      if (expectedType === "object" || expectedType === "array") {
        processedValue = value;
      } else if (expectedType === "string") {
        processedValue = value;
      } else {
        processedValue = coerceTextInputValueByType(value, expectedType);
      }

      setToolArgs((prev) => ({ ...prev, [key]: processedValue }));

      // Treat as empty: blank input. "{}" and "[]" are explicit values, not empty.
      const trimmed = String(value).trim();
      const isEmpty = trimmed === "";

      setSetFields((prev) => {
        const next = new Set(prev);
        if (isEmpty) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });

      // Clear "send empty" intent when user edits the field
      setSendEmptyFields((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [selectedTool]
  );

  const handleToggleEmpty = useCallback(
    (
      key: string,
      expectedType: "string" | "object" | "array",
      pressed: boolean
    ) => {
      if (pressed) {
        const emptyValue =
          expectedType === "array"
            ? "[]"
            : expectedType === "object"
              ? "{}"
              : "";
        setToolArgs((prev) => ({ ...prev, [key]: emptyValue }));
        setSetFields((prev) => new Set(prev).add(key));
        setSendEmptyFields((prev) => new Set(prev).add(key));
      } else {
        setSendEmptyFields((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setSetFields((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    []
  );

  const handleBulkPaste = useCallback(
    async (pastedText: string, _fieldKey: string): Promise<boolean> => {
      if (!selectedTool) return false;

      // Try to parse as object
      const parsedObject = parseObjectFromPaste(pastedText);
      if (!parsedObject) {
        // Not a valid object, allow normal paste
        return false;
      }

      const properties = selectedTool.inputSchema?.properties || {};
      const fieldNames = Object.keys(properties);
      const rootSchema = (selectedTool.inputSchema || {}) as Record<
        string,
        unknown
      >;

      // Find matching fields
      const fieldsToUpdate: Array<{
        key: string;
        oldValue: unknown;
        newValue: unknown;
      }> = [];
      const newFields: string[] = [];

      Object.entries(parsedObject).forEach(([key, value]) => {
        if (fieldNames.includes(key)) {
          const prop = properties[key];
          const expectedType = getToolPropertyType(prop, rootSchema);

          let processedValue: unknown = value;

          // For object/array fields, stringify the value
          if (expectedType === "object" || expectedType === "array") {
            if (typeof value === "object" && value !== null) {
              processedValue = JSON.stringify(value, null, 2);
            } else if (typeof value === "string") {
              processedValue = value;
            }
          } else if (typeof value === "object" && value !== null) {
            // Non-object/array field received an object, stringify it
            processedValue = JSON.stringify(value);
          } else {
            processedValue = String(value);
          }

          const currentValue = toolArgs[key];
          const hasValue =
            currentValue !== undefined &&
            currentValue !== null &&
            currentValue !== "";

          if (hasValue) {
            fieldsToUpdate.push({
              key,
              oldValue: currentValue,
              newValue: processedValue,
            });
          } else {
            newFields.push(key);
            // Apply immediately for empty fields
            handleArgChange(key, String(processedValue));
          }
        }
      });

      // If there are no matching fields at all, allow normal paste
      if (fieldsToUpdate.length === 0 && newFields.length === 0) {
        return false;
      }

      // If only new fields, no confirmation needed
      if (fieldsToUpdate.length === 0) {
        // Mark fields as auto-filled for visual feedback
        setAutoFilledFields(new Set(newFields));
        setTimeout(() => setAutoFilledFields(new Set()), 2000);
        return true;
      }

      // Show confirmation dialog for fields that would be overridden
      return new Promise<boolean>((resolve) => {
        setAutoFillDialog({
          open: true,
          parsedObject,
          fieldsToUpdate,
          newFields,
          resolve,
        });
      });
    },
    [selectedTool, toolArgs, handleArgChange]
  );

  // Handle auto-fill dialog confirmation
  const handleAutoFillConfirm = useCallback(() => {
    if (!autoFillDialog.resolve) return;

    // Apply all updates
    autoFillDialog.fieldsToUpdate.forEach(({ key, newValue }) => {
      handleArgChange(key, String(newValue));
    });

    // Mark all affected fields as auto-filled for visual feedback
    const allFields = [
      ...autoFillDialog.fieldsToUpdate.map((f) => f.key),
      ...autoFillDialog.newFields,
    ];
    setAutoFilledFields(new Set(allFields));
    setTimeout(() => setAutoFilledFields(new Set()), 2000);

    autoFillDialog.resolve(true);
    setAutoFillDialog({
      open: false,
      parsedObject: {},
      fieldsToUpdate: [],
      newFields: [],
      resolve: null,
    });
  }, [autoFillDialog, handleArgChange]);

  const handleAutoFillCancel = useCallback(() => {
    if (!autoFillDialog.resolve) return;

    autoFillDialog.resolve(false);
    setAutoFillDialog({
      open: false,
      parsedObject: {},
      fieldsToUpdate: [],
      newFields: [],
      resolve: null,
    });
  }, [autoFillDialog]);

  // Payload that will actually be sent (for copy, display)
  const payloadToSend = useMemo(() => {
    if (!selectedTool?.inputSchema?.properties) return {};
    const rootSchema = (selectedTool.inputSchema || {}) as Record<
      string,
      unknown
    >;
    const result: Record<string, unknown> = {};
    for (const key of setFields) {
      const prop = selectedTool.inputSchema.properties[key];
      if (!prop) continue;
      const expectedType = getToolPropertyType(prop, rootSchema);
      const rawValue = sendEmptyFields.has(key)
        ? expectedType === "array"
          ? "[]"
          : expectedType === "object"
            ? "{}"
            : ""
        : toolArgs[key];
      result[key] = coerceExecutionArgByType(rawValue, expectedType);
    }
    return result;
  }, [selectedTool, toolArgs, setFields, sendEmptyFields]);

  const {
    isExecuting,
    copiedResult,
    executeTool,
    handleCopyResult,
    handleDeleteResult,
    handleFullscreen,
    filteredResults,
    cancelExecution,
    results,
  } = useToolExecution({
    selectedTool,
    payloadToSend,
    toolArgs,
    callTool,
    readResource,
    serverId,
  });

  const {
    isSearchExpanded,
    setIsSearchExpanded,
    focusedIndex,
    searchInputRef,
    isMobile,
    mobileView,
    setMobileView,
    isRefreshing,
    handleSearchBlur,
    handleRefresh,
  } = useToolsTabNavigation({
    ref,
    activeTab,
    filteredTools,
    savedRequests,
    searchQuery,
    setSearchQuery,
    selectedTool,
    results,
    isExecuting,
    handleToolSelect,
    loadSavedRequest,
    refreshTools,
    selectedToolName,
    tools,
    setSelectedToolName,
  });

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
      args: payloadToSend,
      savedAt: Date.now(),
      serverId: (selectedTool as any)._serverId,
      serverName: (selectedTool as any)._serverName,
    };

    saveSavedRequests([...savedRequests, newRequest]);

    // Track tool saved
    captureInspectorEvent(
      new MCPToolSavedEvent({
        toolName: selectedTool.name,
        serverId,
      })
    ).catch(() => {
      // Silently fail - telemetry should not break the application
    });

    setSaveDialogOpen(false);
    setRequestName("");
  }, [
    selectedTool,
    requestName,
    payloadToSend,
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
                <InspectorScrollArea>
                  {(isScrolled) => (
                    <>
                      <ListTabHeader
                        isScrolled={isScrolled}
                        activeTab={activeTab}
                        isSearchExpanded={isSearchExpanded}
                        searchQuery={searchQuery}
                        primaryTabName="tools"
                        secondaryTabName="saved"
                        primaryTabTitle="Tools"
                        secondaryTabTitle="Saved"
                        primaryCount={filteredTools.length}
                        secondaryCount={savedRequests.length}
                        primaryIcon={Wrench}
                        secondaryIcon={Database}
                        searchPlaceholder="Search tools..."
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
                    </>
                  )}
                </InspectorScrollArea>
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
                  payloadToSend={payloadToSend}
                  isExecuting={isExecuting}
                  isConnected={isConnected}
                  onArgChange={handleArgChange}
                  onExecute={executeTool}
                  onSave={openSaveDialog}
                  onBulkPaste={handleBulkPaste}
                  autoFilledFields={autoFilledFields}
                  setFields={setFields}
                  sendEmptyFields={sendEmptyFields}
                  onToggleEmpty={handleToggleEmpty}
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
                  onRerunTool={executeTool}
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

        <AlertDialog
          open={autoFillDialog.open}
          onOpenChange={(open) => {
            if (!open) handleAutoFillCancel();
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Auto-fill fields from pasted object?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {autoFillDialog.fieldsToUpdate.length > 0 && (
                  <div className="mb-3">
                    <p className="font-medium mb-2">
                      The following fields will be updated:
                    </p>
                    <ul className="text-sm space-y-1 max-h-[200px] overflow-y-auto">
                      {autoFillDialog.fieldsToUpdate.map(
                        ({ key, oldValue, newValue }) => (
                          <li key={key} className="font-mono">
                            <span className="font-semibold">{key}:</span>{" "}
                            <span className="text-red-600 dark:text-red-400 line-through">
                              {typeof oldValue === "object"
                                ? JSON.stringify(oldValue).substring(0, 30) +
                                  "..."
                                : String(oldValue).substring(0, 30)}
                            </span>{" "}
                            →{" "}
                            <span className="text-green-600 dark:text-green-400">
                              {typeof newValue === "string" &&
                              newValue.length > 30
                                ? newValue.substring(0, 30) + "..."
                                : String(newValue).substring(0, 30)}
                            </span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}
                {autoFillDialog.newFields.length > 0 && (
                  <div>
                    <p className="font-medium mb-1">New fields to be filled:</p>
                    <p className="text-sm font-mono">
                      {autoFillDialog.newFields.join(", ")}
                    </p>
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleAutoFillCancel}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleAutoFillConfirm}>
                Auto-fill
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel
        id="left-panel"
        defaultSize="33%"
        minSize={250}
        collapsedSize={0}
        collapsible
        className="flex flex-col h-full relative"
        panelRef={leftPanelRef}
      >
        <div className="flex h-full flex-col overflow-hidden border-r dark:border-zinc-700">
          <InspectorScrollArea>
            {(isScrolled) => (
              <>
                <ListTabHeader
                  isScrolled={isScrolled}
                  activeTab={activeTab}
                  isSearchExpanded={isSearchExpanded}
                  searchQuery={searchQuery}
                  primaryTabName="tools"
                  secondaryTabName="saved"
                  primaryTabTitle="Tools"
                  secondaryTabTitle="Saved"
                  primaryCount={filteredTools.length}
                  secondaryCount={savedRequests.length}
                  primaryIcon={Wrench}
                  secondaryIcon={Database}
                  searchPlaceholder="Search tools..."
                  onSearchExpand={() => setIsSearchExpanded(true)}
                  onSearchChange={setSearchQuery}
                  onSearchBlur={handleSearchBlur}
                  onTabSwitch={() =>
                    setActiveTab(activeTab === "tools" ? "saved" : "tools")
                  }
                  searchInputRef={searchInputRef as React.RefObject<HTMLInputElement>}
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
              </>
            )}
          </InspectorScrollArea>
        </div>
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
              payloadToSend={payloadToSend}
              isExecuting={isExecuting}
              isConnected={isConnected}
              onArgChange={handleArgChange}
              onExecute={executeTool}
              onSave={openSaveDialog}
              onCancel={cancelExecution}
              onBulkPaste={handleBulkPaste}
              autoFilledFields={autoFilledFields}
              setFields={setFields}
              sendEmptyFields={sendEmptyFields}
              onToggleEmpty={handleToggleEmpty}
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
                onRerunTool={executeTool}
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

      <AlertDialog
        open={autoFillDialog.open}
        onOpenChange={(open) => {
          if (!open) handleAutoFillCancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Auto-fill fields from pasted object?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {autoFillDialog.fieldsToUpdate.length > 0 && (
                <div className="mb-3">
                  <p className="font-medium mb-2">
                    The following fields will be updated:
                  </p>
                  <ul className="text-sm space-y-1 max-h-[200px] overflow-y-auto">
                    {autoFillDialog.fieldsToUpdate.map(
                      ({ key, oldValue, newValue }) => (
                        <li key={key} className="font-mono">
                          <span className="font-semibold">{key}:</span>{" "}
                          <span className="text-red-600 dark:text-red-400 line-through">
                            {typeof oldValue === "object"
                              ? JSON.stringify(oldValue).substring(0, 30) +
                                "..."
                              : String(oldValue).substring(0, 30)}
                          </span>{" "}
                          →{" "}
                          <span className="text-green-600 dark:text-green-400">
                            {typeof newValue === "string" &&
                            newValue.length > 30
                              ? newValue.substring(0, 30) + "..."
                              : String(newValue).substring(0, 30)}
                          </span>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}
              {autoFillDialog.newFields.length > 0 && (
                <div>
                  <p className="font-medium mb-1">New fields to be filled:</p>
                  <p className="text-sm font-mono">
                    {autoFillDialog.newFields.join(", ")}
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleAutoFillCancel}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleAutoFillConfirm}>
              Auto-fill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResizablePanelGroup>
  );
}

ToolsTab.displayName = "ToolsTab";
