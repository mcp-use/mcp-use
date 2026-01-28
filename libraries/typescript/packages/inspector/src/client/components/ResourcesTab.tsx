import { Button } from "@/client/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { useInspector } from "@/client/context/InspectorContext";
import { MCPResourceReadEvent, Telemetry } from "@/client/telemetry";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
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
import type { ResourceResult } from "./resources";
import {
  ResourceResultDisplay,
  ResourcesList,
  ResourcesTabHeader,
} from "./resources";
import { RpcPanel } from "./shared";
import { useConfig } from "./chat/useConfig";

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
}

/**
 * Render the Resources tab UI and manage its interactions (resource list, selection, result display, search, keyboard navigation, mobile/desktop layouts, copy/download/fullscreen actions, and RPC logger).
 *
 * @param ref - Optional ref exposing `focusSearch()` and `blurSearch()` methods for programmatic search focus control.
 * @param resources - Array of resources to show and filter.
 * @param readResource - Function to read a resource by its URI; used when a resource is selected.
 * @param serverId - Identifier for the server; used for telemetry and RPC logger scope.
 * @param isConnected - When `true`, selecting a resource triggers `readResource`; when `false`, reads are skipped.
 * @returns The ResourcesTab React element.
 */
export function ResourcesTab({
  ref,
  resources,
  readResource,
  serverId,
  isConnected,
  mcpServerUrl,
}: ResourcesTabProps & { ref?: React.RefObject<ResourcesTabRef | null> }) {
  // State
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
    if (selectedResource) {
      setMobileView("detail");
    } else {
      setMobileView("list");
    }
  }, [selectedResource]);

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
            resourceAnnotations: resource.annotations as Record<string, any>,
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
            resourceAnnotations: resource.annotations as Record<string, any>,
          });
        } finally {
          setIsLoading(false);
        }
      }
    },
    [readResource, serverId, isConnected]
  );

  // Reset focused index when filtered resources change
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

      const items = filteredResources;

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
        const resource = filteredResources[focusedIndex];
        if (resource) {
          handleResourceSelect(resource);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusedIndex, filteredResources, handleResourceSelect]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId = `resource-${filteredResources[focusedIndex]?.uri}`;
      const element = document.getElementById(itemId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [focusedIndex, filteredResources]);

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
      const updatedResource = resources.find(
        (r) => r.uri === selectedResource.uri
      );
      if (updatedResource && updatedResource !== selectedResource) {
        // Resource definition changed - update the reference
        const hasChanges =
          updatedResource.description !== selectedResource.description ||
          updatedResource.mimeType !== selectedResource.mimeType ||
          updatedResource.name !== selectedResource.name;
        if (hasChanges) {
          setSelectedResource(updatedResource);
        }
      }
    }
  }, [resources, selectedResource]);

  const handleCopy = useCallback(async () => {
    if (!currentResult) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(currentResult.result, null, 2)
      );
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
                  setMobileView("list");
                }}
                className="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
              >
                Resources
              </button>
              {mobileView === "detail" && (
                <>
                  <span className="mx-2 text-muted-foreground">/</span>
                  <span className="text-foreground">Content</span>
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
                <ResourcesTabHeader
                  activeTab={activeTab}
                  isSearchExpanded={isSearchExpanded}
                  searchQuery={searchQuery}
                  filteredResourcesCount={filteredResources.length}
                  onSearchExpand={() => setIsSearchExpanded(true)}
                  onSearchChange={setSearchQuery}
                  onSearchBlur={handleSearchBlur}
                  onTabSwitch={() => {}}
                  searchInputRef={
                    searchInputRef as React.RefObject<HTMLInputElement>
                  }
                />
                <div className="flex flex-col h-full">
                  <ResourcesList
                    resources={filteredResources}
                    selectedResource={selectedResource}
                    onResourceSelect={handleResourceSelect}
                    focusedIndex={focusedIndex}
                  />
                </div>
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
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize="33%">
        <ResizablePanelGroup
          orientation="vertical"
          className="h-full border-r dark:border-zinc-700"
        >
          <ResizablePanel minSize="30%">
            <div className="flex flex-col h-full overflow-hidden">
              <ResourcesTabHeader
                activeTab={activeTab}
                isSearchExpanded={isSearchExpanded}
                searchQuery={searchQuery}
                filteredResourcesCount={filteredResources.length}
                onSearchExpand={() => setIsSearchExpanded(true)}
                onSearchChange={setSearchQuery}
                onSearchBlur={handleSearchBlur}
                onTabSwitch={() => {}}
                searchInputRef={
                  searchInputRef as React.RefObject<HTMLInputElement>
                }
              />

              <ResourcesList
                resources={filteredResources}
                selectedResource={selectedResource}
                onResourceSelect={handleResourceSelect}
                focusedIndex={focusedIndex}
              />
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
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

ResourcesTab.displayName = "ResourcesTab";
