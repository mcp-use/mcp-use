import { Button } from "@/client/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { useInspector } from "@/client/context/InspectorContext";
import { MCPResourceReadEvent, Telemetry } from "@/client/telemetry";
import type {
  CompleteRequestParams,
  CompleteResult,
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ResourceResult } from "./resources";
import {
  ResourceResultDisplay,
  ResourcesList,
  ResourcesTabHeader,
} from "./resources";
import type { ResourcesViewTab } from "./resources/ResourcesTabHeader";
import { ResourceTemplatePanel } from "./resources/ResourceTemplatePanel";
import { RpcPanel } from "./shared";
import { useConfig } from "./chat/useConfig";
import { useCompletion } from "../hooks/useCompletion";
import { copyToClipboard } from "@/client/utils/clipboard";

export interface ResourcesTabRef {
  focusSearch: () => void;
  blurSearch: () => void;
}

interface ResourcesTabProps {
  resources: Resource[];
  readResource: (uri: string) => Promise<any>;
  serverId: string;
  isConnected: boolean;
  mcpServerUrl: string;
  refreshResources?: () => Promise<void>;
  /**
   * Resource templates from the MCP server (e.g. `file:///{path}`).
   * When provided and non-empty, a "Templates" tab toggle appears in the
   * resources list header so users can select and fill in template URIs.
   */
  resourceTemplates?: ResourceTemplate[];
  /**
   * The MCP complete() function. When provided, template variable fields
   * and resource-related fields show autocomplete suggestions as the user
   * types. Omit to fall back to plain inputs.
   */
  complete?: (params: CompleteRequestParams) => Promise<CompleteResult>;
}

/**
 * Render the Resources tab UI and manage its interactions (resource list,
 * selection, result display, search, keyboard navigation, mobile/desktop
 * layouts, copy/download/fullscreen actions, RPC logger, and – when the server
 * supports it – resource template completion).
 *
 * @param ref - Optional ref exposing `focusSearch()` and `blurSearch()`.
 * @param resources - Array of concrete resources to show.
 * @param readResource - Reads a resource by URI.
 * @param serverId - Server identifier for telemetry and RPC logger scope.
 * @param isConnected - Gates resource reads and completion requests.
 * @param resourceTemplates - Optional list of URI template resources.
 * @param complete - Optional MCP complete() for template variable suggestions.
 */
export function ResourcesTab({
  ref,
  resources,
  readResource,
  serverId,
  isConnected,
  mcpServerUrl,
  refreshResources,
  resourceTemplates = [],
  complete,
}: ResourcesTabProps & { ref?: React.RefObject<ResourcesTabRef | null> }) {
  // State
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null
  );
  const { selectedResourceUri, setSelectedResourceUri } = useInspector();
  const { llmConfig } = useConfig({ mcpServerUrl });
  const [currentResult, setCurrentResult] = useState<ResourceResult | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab] = useState<"resources">("resources");
  const [previewMode, setPreviewMode] = useState(true);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [isCopied, setIsCopied] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resourceDisplayRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // ── Template state ────────────────────────────────────────────────────────
  /** Which sub-view is shown in the left panel (resources vs templates) */
  const [viewTab, setViewTab] = useState<ResourcesViewTab>("resources");
  /** The currently-selected resource template */
  const [selectedTemplate, setSelectedTemplate] =
    useState<ResourceTemplate | null>(null);

  // Completion hook for resource template variable suggestions
  const { fetchResourceTemplateCompletion } = useCompletion({
    complete,
    isConnected,
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

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
    if (selectedResource || selectedTemplate) {
      setMobileView("detail");
    } else {
      setMobileView("list");
    }
  }, [selectedResource, selectedTemplate]);

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

  const handleRefresh = useCallback(async () => {
    if (!refreshResources) return;
    setIsRefreshing(true);
    try {
      await refreshResources();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshResources]);

  const filteredResources = useMemo(() => {
    if (!searchQuery) return resources;
    const query = searchQuery.toLowerCase();
    return resources.filter(
      (resource) =>
        resource.name.toLowerCase().includes(query) ||
        resource.description?.toLowerCase().includes(query) ||
        resource.uri.toLowerCase().includes(query)
    );
  }, [resources, searchQuery]);

  const handleResourceSelect = useCallback(
    async (resource: Resource) => {
      setSelectedResource(resource);
      setSelectedTemplate(null);

      // Automatically read the resource when selected
      if (isConnected) {
        setIsLoading(true);
        const timestamp = Date.now();

        try {
          const result = await readResource(resource.uri);

          // Track successful resource read
          const telemetry = Telemetry.getInstance();
          telemetry
            .capture(
              new MCPResourceReadEvent({
                resourceUri: resource.uri,
                serverId,
                success: true,
              })
            )
            .catch(() => {
              // Silently fail - telemetry should not break the application
            });

          setCurrentResult({
            uri: resource.uri,
            result,
            timestamp,
            resourceAnnotations: {
              ...(resource.annotations as Record<string, any>),
              ...(((resource as any)._meta as Record<string, any>) || {}),
            },
          });
        } catch (error) {
          // Track failed resource read
          const telemetry = Telemetry.getInstance();
          telemetry
            .capture(
              new MCPResourceReadEvent({
                resourceUri: resource.uri,
                serverId,
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              })
            )
            .catch(() => {
              // Silently fail - telemetry should not break the application
            });

          setCurrentResult({
            uri: resource.uri,
            result: {
              contents: [],
              _meta: {},
            },
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp,
            resourceAnnotations: {
              ...(resource.annotations as Record<string, any>),
              ...(((resource as any)._meta as Record<string, any>) || {}),
            },
          });
        } finally {
          setIsLoading(false);
        }
      }
    },
    [readResource, serverId, isConnected]
  );

  // ── Template selection / reading ──────────────────────────────────────────

  const handleTemplateSelect = useCallback((template: ResourceTemplate) => {
    setSelectedTemplate(template);
    setSelectedResource(null);
    setCurrentResult(null);
  }, []);

  /** Called by ResourceTemplatePanel when the user clicks "Read Resource" */
  const handleTemplateRead = useCallback(
    async (uri: string) => {
      if (!isConnected) return;
      setIsLoading(true);
      const timestamp = Date.now();
      try {
        const result = await readResource(uri);
        setCurrentResult({ uri, result, timestamp });
      } catch (error) {
        setCurrentResult({
          uri,
          result: { contents: [], _meta: {} },
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp,
        });
      } finally {
        setIsLoading(false);
        if (isMobile) setMobileView("detail");
      }
    },
    [readResource, isConnected, isMobile]
  );

  // ── Keyboard navigation ───────────────────────────────────────────────────

  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery, activeTab, viewTab]);

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

      const items =
        viewTab === "resources" ? filteredResources : resourceTemplates;

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
        if (viewTab === "resources") {
          const resource = filteredResources[focusedIndex];
          if (resource) handleResourceSelect(resource);
        } else {
          const template = resourceTemplates[focusedIndex];
          if (template) handleTemplateSelect(template);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedIndex, 
    filteredResources,
    resourceTemplates,
    viewTab,
    handleResourceSelect,
    handleTemplateSelect,
  ]);

  useEffect(() => {
    if (focusedIndex >= 0 && viewTab === "resources") {
      const itemId = `resource-${filteredResources[focusedIndex]?.uri}`;
      const element = document.getElementById(itemId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [focusedIndex, filteredResources, viewTab]);

  // ── Auto-selection from context ───────────────────────────────────────────

  // Handle auto-selection from context
  useEffect(() => {
    if (selectedResourceUri && resources.length > 0) {
      const resource = resources.find((r) => r.uri === selectedResourceUri);

      if (resource && selectedResource?.uri !== resource.uri) {
        setSelectedResourceUri(null);
        setTimeout(() => {
          handleResourceSelect(resource);
          const element = document.getElementById(`resource-${resource.uri}`);
          if (element) {
            element.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
        }, 100);
      }
    }
  }, [
    selectedResourceUri,
    resources,
    selectedResource,
    handleResourceSelect,
    setSelectedResourceUri,
  ]);

  // Sync selectedResource with updated resources list (for HMR support)
  // When resources change via HMR, update selectedResource to the new object reference
  useEffect(() => {
    if (selectedResource) {
      const updated = resources.find((r) => r.uri === selectedResource.uri);
      if (updated && updated !== selectedResource) {
        const hasChanges =
          updated.description !== selectedResource.description ||
          updated.mimeType !== selectedResource.mimeType ||
          updated.name !== selectedResource.name;
        if (hasChanges) setSelectedResource(updated);
      }
    }
  }, [resources, selectedResource]);

  const handleCopy = useCallback(async () => {
    if (!currentResult) return;
    try {
      await copyToClipboard(JSON.stringify(currentResult.result, null, 2));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("[ResourcesTab] Failed to copy result:", error);
    }
  }, [currentResult]);

  const handleDownload = useCallback(() => {
    if (!currentResult) return;
    try {
      const blob = new globalThis.Blob(
        [JSON.stringify(currentResult.result, null, 2)],
        {
          type: "application/json",
        }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resource-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[ResourcesTab] Failed to download result:", error);
    }
  }, [currentResult]);

  const handleFullscreen = useCallback(async () => {
    if (!resourceDisplayRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await resourceDisplayRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("[ResourcesTab] Failed to toggle fullscreen:", error);
    }
  }, []);

  // ── Shared sub-components ─────────────────────────────────────────────────

  /** Left list panel contents — resources or templates depending on viewTab */
  const renderLeftList = () => {
    if (viewTab === "templates") {
      if (resourceTemplates.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No resource templates available
            </p>
          </div>
        );
      }
      return (
        <div className="overflow-y-auto flex-1 overscroll-contain">
          {resourceTemplates.map((tpl, index) => (
            <button
              key={tpl.uriTemplate}
              type="button"
              id={`template-${tpl.uriTemplate}`}
              data-testid={`template-item-${tpl.name}`}
              onClick={() => handleTemplateSelect(tpl)}
              className={`w-full text-left cursor-pointer p-2 sm:p-4 border-b dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors group ${
                selectedTemplate?.uriTemplate === tpl.uriTemplate
                  ? "bg-zinc-50 dark:bg-zinc-800 border-l-4 border-l-zinc-500"
                  : ""
              } ${focusedIndex === index && viewTab === "templates" ? "ring-2 ring-zinc-500 dark:ring-zinc-400 ring-inset" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm font-mono truncate">
                  {tpl.name}
                </p>
                <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                  {tpl.uriTemplate}
                </p>
                {tpl.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                    {tpl.description}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      );
    }

    return (
      <ResourcesList
        resources={filteredResources}
        selectedResource={selectedResource}
        onResourceSelect={handleResourceSelect}
        focusedIndex={viewTab === "resources" ? focusedIndex : -1}
      />
    );
  };

  /** Right detail panel — ResourceTemplatePanel or ResourceResultDisplay */
  const renderDetail = () => {
    if (selectedTemplate && viewTab === "templates") {
      return (
        <ResourceTemplatePanel
          template={selectedTemplate}
          isConnected={isConnected}
          onRead={handleTemplateRead}
          onFetchSuggestions={(templateUri, varName, value) =>
            fetchResourceTemplateCompletion(templateUri, varName, value)
          }
        />
      );
    }

    return (
      <ResourceResultDisplay
        result={currentResult}
        isLoading={isLoading}
        previewMode={previewMode}
        serverId={serverId}
        readResource={readResource}
        onTogglePreview={() => setPreviewMode(!previewMode)}
        onCopy={handleCopy}
        onDownload={handleDownload}
        onFullscreen={handleFullscreen}
        isCopied={isCopied}
        selectedResource={selectedResource}
        llmConfig={llmConfig}
      />
    );
  };

  const sharedHeaderProps = {
    activeTab,
    viewTab,
    isSearchExpanded,
    searchQuery,
    filteredResourcesCount: filteredResources.length,
    templatesCount: resourceTemplates.length,
    onViewTabChange: (tab: ResourcesViewTab) => {
      setViewTab(tab);
      setSelectedResource(null);
      setSelectedTemplate(null);
      setCurrentResult(null);
    },
    onSearchExpand: () => setIsSearchExpanded(true),
    onSearchChange: setSearchQuery,
    onSearchBlur: handleSearchBlur,
    onTabSwitch: () => {},
    searchInputRef: searchInputRef as React.RefObject<HTMLInputElement>,
    onRefresh: refreshResources ? handleRefresh : undefined,
    isRefreshing,
  };

  // ── Mobile layout ─────────────────────────────────────────────────────────

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
                setSelectedResource(null);
                setSelectedTemplate(null);
                setMobileView("list");
              }}
              className="p-0 h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center text-sm font-medium">
              <button
                onClick={() => {
                  setSelectedResource(null);
                  setSelectedTemplate(null);
                  setMobileView("list");
                }}
                className="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
              >
                Resources
              </button>
              {mobileView === "detail" && (
                <>
                  <span className="mx-2 text-muted-foreground">/</span>
                  <span className="text-foreground">
                    {selectedTemplate ? selectedTemplate.name : "Content"}
                  </span>
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
                <ResourcesTabHeader {...sharedHeaderProps} />
                <div className="flex flex-col h-full">{renderLeftList()}</div>
              </motion.div>
            )}

            {mobileView === "detail" && (
              <motion.div
                key="detail"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 bg-white dark:bg-zinc-900 z-10"
              >
                <div ref={resourceDisplayRef} className="h-full">
                  {renderDetail()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // ── Desktop layout ────────────────────────────────────────────────────────

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize="33%">
        <ResizablePanelGroup
          orientation="vertical"
          className="h-full border-r dark:border-zinc-700"
        >
          <ResizablePanel minSize="30%">
            <div className="flex flex-col h-full overflow-hidden">
              <ResourcesTabHeader {...sharedHeaderProps} />
              {renderLeftList()}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <RpcPanel serverId={serverId} />
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize="67%">
        <div
          ref={resourceDisplayRef}
          className="h-full bg-white dark:bg-zinc-900"
        >
          {renderDetail()}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

ResourcesTab.displayName = "ResourcesTab";
