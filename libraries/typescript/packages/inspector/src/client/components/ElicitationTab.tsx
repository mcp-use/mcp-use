import type { ElicitResult } from "@mcp-use/modelcontextprotocol-sdk/types.js";
import type { PendingElicitationRequest } from "@/client/types/elicitation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import {
  ElicitationTabHeader,
  ElicitationRequestsList,
  ElicitationRequestDisplay,
} from "./elicitation";
import { useInspector } from "@/client/context/InspectorContext";
import { formatRelativeTime } from "@/client/utils/time";

interface ElicitationTabProps {
  pendingRequests: PendingElicitationRequest[];
  onApprove: (requestId: string, result: ElicitResult) => void;
  onReject: (requestId: string, error?: string) => void;
  serverId: string;
  isConnected: boolean;
}

export function ElicitationTab({
  pendingRequests = [],
  onApprove,
  onReject,
  serverId: _serverId,
  isConnected,
}: ElicitationTabProps) {
  const { selectedElicitationRequestId, setSelectedElicitationRequestId } =
    useInspector();
  const [selectedRequest, setSelectedRequest] =
    useState<PendingElicitationRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const requestDisplayRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userHasScrolledRef = useRef(false);

  // Handle auto-selection from context (similar to SamplingTab)
  useEffect(() => {
    console.log("[ElicitationTab] Auto-selection check:", {
      selectedElicitationRequestId,
      pendingRequestsCount: pendingRequests.length,
      currentSelectedId: selectedRequest?.id,
    });

    if (selectedElicitationRequestId && pendingRequests.length > 0) {
      const request = pendingRequests.find(
        (r) => r.id === selectedElicitationRequestId
      );

      console.log(
        "[ElicitationTab] Found request for auto-selection:",
        !!request,
        request?.id
      );

      if (request) {
        console.log("[ElicitationTab] Auto-selecting request:", request.id);
        // Clear the context selection first
        setSelectedElicitationRequestId(null);
        // Then set the local state immediately
        setSelectedRequest(request);
        // Scroll after a short delay
        setTimeout(() => {
          const requestElement = document.getElementById(
            `elicitation-request-${request.id}`
          );
          console.log(
            "[ElicitationTab] Scrolling to element:",
            !!requestElement
          );
          if (requestElement) {
            requestElement.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
        }, 100);
      }
    }
  }, [
    selectedElicitationRequestId,
    pendingRequests,
    setSelectedElicitationRequestId,
  ]);

  // Listen for custom navigation events from toast
  useEffect(() => {
    const handleNavigate = (event: globalThis.Event) => {
      const customEvent = event as globalThis.CustomEvent<{
        requestId: string;
      }>;
      const requestId = customEvent.detail.requestId;

      console.log(
        "[ElicitationTab] Custom navigate event received:",
        requestId
      );

      // Find and select the request immediately
      const request = pendingRequests.find((r) => r.id === requestId);
      if (request) {
        console.log(
          "[ElicitationTab] Selecting request from event:",
          requestId
        );
        setSelectedRequest(request);
        setTimeout(() => {
          const requestElement = document.getElementById(
            `elicitation-request-${requestId}`
          );
          if (requestElement) {
            requestElement.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
        }, 200);
      }
    };

    window.addEventListener("navigate-to-elicitation", handleNavigate);
    return () =>
      window.removeEventListener("navigate-to-elicitation", handleNavigate);
  }, [pendingRequests]);

  // Auto-scroll to top when new requests arrive (only if user hasn't scrolled)
  useEffect(() => {
    if (
      autoScroll &&
      pendingRequests.length > 0 &&
      listRef.current &&
      !userHasScrolledRef.current
    ) {
      listRef.current.scrollTop = 0;
    }
  }, [pendingRequests.length, autoScroll]);

  // Track user scroll to disable auto-scroll
  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;

    const handleScroll = () => {
      if (listElement.scrollTop > 0) {
        userHasScrolledRef.current = true;
        setAutoScroll(false);
      }
    };

    listElement.addEventListener("scroll", handleScroll);
    return () => listElement.removeEventListener("scroll", handleScroll);
  }, []);

  // Reset user scroll tracking when requests are cleared
  useEffect(() => {
    if (pendingRequests.length === 0) {
      userHasScrolledRef.current = false;
      setAutoScroll(true);
    }
  }, [pendingRequests.length]);

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

  // Filter requests based on search query
  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return pendingRequests;

    const query = searchQuery.toLowerCase();
    return pendingRequests.filter(
      (request) =>
        request.serverName.toLowerCase().includes(query) ||
        request.request.message.toLowerCase().includes(query) ||
        JSON.stringify(request.request || {})
          .toLowerCase()
          .includes(query)
    );
  }, [pendingRequests, searchQuery]);

  // Reset focused index when filtered requests change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery]);

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

      const items = filteredRequests;

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
        const request = filteredRequests[focusedIndex];
        if (request) {
          handleRequestSelect(request);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusedIndex, filteredRequests]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId = `elicitation-request-${filteredRequests[focusedIndex]?.id}`;
      const element = document.getElementById(itemId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [focusedIndex, filteredRequests]);

  const handleRequestSelect = useCallback(
    (request: PendingElicitationRequest) => {
      setSelectedRequest(request);
    },
    []
  );

  const handleCancelAll = useCallback(() => {
    if (
      window.confirm(
        "Are you sure you want to cancel all elicitation requests? This cannot be undone."
      )
    ) {
      pendingRequests.forEach((request) => {
        onReject(request.id, "User cancelled all requests");
      });
      setSelectedRequest(null);
    }
  }, [pendingRequests, onReject]);

  const handleCopy = useCallback(async () => {
    if (!selectedRequest) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            id: selectedRequest.id,
            serverName: selectedRequest.serverName,
            timestamp: selectedRequest.timestamp,
            request: selectedRequest.request,
          },
          null,
          2
        )
      );
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("[ElicitationTab] Failed to copy request:", error);
    }
  }, [selectedRequest]);

  const handleDownload = useCallback(() => {
    if (!selectedRequest) return;
    try {
      const blob = new globalThis.Blob(
        [
          JSON.stringify(
            {
              id: selectedRequest.id,
              serverName: selectedRequest.serverName,
              timestamp: selectedRequest.timestamp,
              request: selectedRequest.request,
            },
            null,
            2
          ),
        ],
        {
          type: "application/json",
        }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `elicitation-request-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[ElicitationTab] Failed to download request:", error);
    }
  }, [selectedRequest]);

  const handleFullscreen = useCallback(async () => {
    if (!requestDisplayRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await requestDisplayRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("[ElicitationTab] Failed to toggle fullscreen:", error);
    }
  }, []);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <CheckSquare className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">
          Not connected to server
        </p>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={40} minSize={30}>
        <ResizablePanelGroup
          direction="vertical"
          className="h-full border-r dark:border-zinc-700"
        >
          <ResizablePanel defaultSize={75} minSize={30}>
            <ElicitationTabHeader
              isSearchExpanded={isSearchExpanded}
              searchQuery={searchQuery}
              filteredRequestsCount={filteredRequests.length}
              requestsCount={pendingRequests.length}
              onSearchExpand={() => setIsSearchExpanded(true)}
              onSearchChange={setSearchQuery}
              onSearchBlur={handleSearchBlur}
              onCancelAll={handleCancelAll}
              searchInputRef={
                searchInputRef as React.RefObject<HTMLInputElement>
              }
            />

            <div className="flex flex-col h-full">
              <ElicitationRequestsList
                requests={filteredRequests}
                selectedRequest={selectedRequest}
                onRequestSelect={handleRequestSelect}
                focusedIndex={focusedIndex}
                formatRelativeTime={formatRelativeTime}
                listRef={listRef}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={60} minSize={40}>
        <div
          ref={requestDisplayRef}
          className="h-full bg-white dark:bg-zinc-900"
        >
          <ElicitationRequestDisplay
            request={selectedRequest}
            onApprove={onApprove}
            onReject={onReject}
            onClose={() => setSelectedRequest(null)}
            previewMode={previewMode}
            onTogglePreview={() => setPreviewMode(!previewMode)}
            isCopied={isCopied}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onFullscreen={handleFullscreen}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
