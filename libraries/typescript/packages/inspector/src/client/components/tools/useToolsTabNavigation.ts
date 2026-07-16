import type { Tool } from "@modelcontextprotocol/client";
import type { SavedRequest } from "./SavedRequestsList";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";

export function useToolsTabNavigation({
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
}: {
  ref?: RefObject<{ focusSearch: () => void; blurSearch: () => void } | null>;
  activeTab: "tools" | "saved";
  filteredTools: Tool[];
  savedRequests: SavedRequest[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedTool: Tool | null;
  results: unknown[];
  isExecuting: boolean;
  handleToolSelect: (tool: Tool) => void;
  loadSavedRequest: (request: SavedRequest) => void;
  refreshTools?: () => Promise<void>;
  selectedToolName: string | null;
  tools: Tool[];
  setSelectedToolName: (name: string | null) => void;
}) {
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail" | "response">(
    "list"
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    setMobileView(selectedTool ? "detail" : "list");
  }, [selectedTool]);

  useEffect(() => {
    if (isMobile && results.length > 0 && !isExecuting) {
      setMobileView("response");
    }
  }, [results, isExecuting, isMobile]);

  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      setIsSearchExpanded(true);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    },
    blurSearch: () => {
      setSearchQuery("");
      setIsSearchExpanded(false);
      searchInputRef.current?.blur();
    },
  }));

  useEffect(() => {
    if (isSearchExpanded) searchInputRef.current?.focus();
  }, [isSearchExpanded]);

  const handleSearchBlur = useCallback(() => {
    if (!searchQuery.trim()) setIsSearchExpanded(false);
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

  useEffect(() => {
    if (activeTab !== "tools") setIsSearchExpanded(false);
  }, [activeTab]);

  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery, activeTab]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";
      if (isInputFocused || e.metaKey || e.ctrlKey || e.altKey) return;

      const items = activeTab === "tools" ? filteredTools : savedRequests;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1 >= items.length ? 0 : prev + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 < 0 ? items.length - 1 : prev - 1));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        if (activeTab === "tools") {
          const tool = filteredTools[focusedIndex];
          if (tool) handleToolSelect(tool);
        } else {
          const request = savedRequests[focusedIndex];
          if (request) loadSavedRequest(request);
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

  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId =
        activeTab === "tools"
          ? `tool-${filteredTools[focusedIndex]?.name}`
          : `saved-${savedRequests[focusedIndex]?.id}`;
      document
        .getElementById(itemId)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [focusedIndex, filteredTools, savedRequests, activeTab]);

  useEffect(() => {
    if (!selectedToolName || tools.length === 0) return;
    const tool = tools.find((t) => t.name === selectedToolName);
    if (tool) {
      setSelectedToolName(null);
      const timeoutId = setTimeout(() => {
        handleToolSelect(tool);
        document
          .getElementById(`tool-${tool.name}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [selectedToolName, tools, handleToolSelect, setSelectedToolName]);

  return {
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
  };
}
