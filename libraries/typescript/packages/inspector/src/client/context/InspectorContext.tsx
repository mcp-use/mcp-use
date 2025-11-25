import type { ReactNode } from "react";
import { createContext, use, useCallback, useState } from "react";

export type TabType = "tools" | "prompts" | "resources" | "chat" | "notifications";

interface InspectorState {
  selectedServerId: string | null;
  activeTab: TabType;
  selectedToolName: string | null;
  selectedPromptName: string | null;
  selectedResourceUri: string | null;
  tunnelUrl: string | null;
}

interface InspectorContextType extends InspectorState {
  setSelectedServerId: (serverId: string | null) => void;
  setActiveTab: (tab: TabType) => void;
  setSelectedToolName: (toolName: string | null) => void;
  setSelectedPromptName: (promptName: string | null) => void;
  setSelectedResourceUri: (resourceUri: string | null) => void;
  setTunnelUrl: (tunnelUrl: string | null) => void;
  navigateToItem: (
    serverId: string,
    tab: TabType,
    itemIdentifier?: string
  ) => void;
  clearSelection: () => void;
}

const InspectorContext = createContext<InspectorContextType | undefined>(
  undefined
);

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InspectorState>({
    selectedServerId: null,
    activeTab: "tools",
    selectedToolName: null,
    selectedPromptName: null,
    selectedResourceUri: null,
    tunnelUrl: null,
  });

  const setSelectedServerId = useCallback((serverId: string | null) => {
    setState((prev) => ({ ...prev, selectedServerId: serverId }));
  }, []);

  const setActiveTab = useCallback((tab: TabType) => {
    setState((prev) => ({ ...prev, activeTab: tab }));
  }, []);

  const setSelectedToolName = useCallback((toolName: string | null) => {
    setState((prev) => ({ ...prev, selectedToolName: toolName }));
  }, []);

  const setSelectedPromptName = useCallback((promptName: string | null) => {
    setState((prev) => ({ ...prev, selectedPromptName: promptName }));
  }, []);

  const setSelectedResourceUri = useCallback((resourceUri: string | null) => {
    setState((prev) => ({ ...prev, selectedResourceUri: resourceUri }));
  }, []);

  const setTunnelUrl = useCallback((tunnelUrl: string | null) => {
    setState((prev) => ({ ...prev, tunnelUrl }));
  }, []);

  const navigateToItem = useCallback(
    (serverId: string, tab: TabType, itemIdentifier?: string) => {
      console.warn("[InspectorContext] navigateToItem called:", {
        serverId,
        tab,
        itemIdentifier,
      });

      const newState = {
        selectedServerId: serverId,
        activeTab: tab,
        selectedToolName: tab === "tools" ? itemIdentifier || null : null,
        selectedPromptName: tab === "prompts" ? itemIdentifier || null : null,
        selectedResourceUri:
          tab === "resources" ? itemIdentifier || null : null,
      };

      console.warn("[InspectorContext] Setting new state:", newState);

      // Update all state atomically in a single setState call
      setState(newState);
    },
    []
  );

  const clearSelection = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedToolName: null,
      selectedPromptName: null,
      selectedResourceUri: null,
    }));
  }, []);

  const value = {
    ...state,
    setSelectedServerId,
    setActiveTab,
    setSelectedToolName,
    setSelectedPromptName,
    setSelectedResourceUri,
    setTunnelUrl,
    navigateToItem,
    clearSelection,
  };

  return <InspectorContext value={value}>{children}</InspectorContext>;
}

export function useInspector() {
  const context = use(InspectorContext);
  if (!context) {
    throw new Error("useInspector must be used within InspectorProvider");
  }
  return context;
}
