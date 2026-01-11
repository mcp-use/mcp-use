import { Spinner } from "@/client/components/ui/spinner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { useInspector, type TabType } from "@/client/context/InspectorContext";
import { useAutoConnect } from "@/client/hooks/useAutoConnect";
import { useKeyboardShortcuts } from "@/client/hooks/useKeyboardShortcuts";
import { useSavedRequests } from "@/client/hooks/useSavedRequests";
import { MCPCommandPaletteOpenEvent, Telemetry } from "@/client/telemetry";
import { useMcpClient } from "mcp-use/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { CommandPalette } from "./CommandPalette";
import { LayoutContent } from "./LayoutContent";
import { LayoutHeader } from "./LayoutHeader";
import { ServerConnectionModal } from "./ServerConnectionModal";

interface LayoutProps {
  children: ReactNode;
}

/**
 * Render the application layout that orchestrates header, main content, command palette, and server connection modal.
 *
 * This component wires MCP client and inspector state, synchronizes URL query parameters (server, tab, tunnelUrl, embedded),
 * manages keyboard shortcuts, auto-connect flow, aggregated tool/prompt/resource lists, and provides adapters for legacy
 * connection APIs while preserving backward compatibility.
 *
 * @param children - The main content to render within the layout's content area.
 * @returns The React element representing the application layout.
 */
export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    servers: connections,
    addServer,
    removeServer: removeConnection,
    updateServer,
    storageLoaded: configLoaded,
  } = useMcpClient();

  // Adapter functions for backward compatibility
  const addConnection = useCallback(
    (
      url: string,
      name?: string,
      proxyConfig?: any,
      transportType?: "http" | "sse"
    ) => {
      addServer(url, {
        url,
        name,
        proxyConfig,
        transportType,
        preventAutoAuth: true,
      });
    },
    [addServer]
  );

  const updateConnectionConfig = useCallback(
    async (id: string, config: any) => {
      try {
        await updateServer(id, config);
      } catch (error) {
        console.error(`[Layout] Failed to update connection ${id}:`, error);
      }
    },
    [updateServer]
  );
  const {
    selectedServerId,
    setSelectedServerId,
    activeTab,
    setActiveTab,
    navigateToItem,
    setTunnelUrl,
    tunnelUrl,
    isEmbedded,
    embeddedConfig,
    setEmbeddedMode,
  } = useInspector();

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null
  );
  const savedRequests = useSavedRequests();

  // Initialize embedded mode from URL params once on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const embedded = urlParams.get("embedded") === "true";
    const embeddedConfigParam = urlParams.get("embeddedConfig");

    if (embedded) {
      let config: { backgroundColor?: string; padding?: string } = {};
      if (embeddedConfigParam) {
        try {
          config = JSON.parse(embeddedConfigParam);
        } catch (error) {
          console.error("Failed to parse embeddedConfig:", error);
        }
      }
      setEmbeddedMode(true, config);
    }
  }, []); // Only run once on mount

  // Read tunnelUrl from query parameters and store in context
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const tunnelUrl = urlParams.get("tunnelUrl");
    setTunnelUrl(tunnelUrl);
  }, [location.search, setTunnelUrl]);

  // Read tab from query parameters and set active tab
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const tab = urlParams.get("tab");
    if (tab) {
      // Validate that tab is a valid TabType
      const validTabs: TabType[] = [
        "tools",
        "prompts",
        "resources",
        "chat",
        "sampling",
        "elicitation",
        "notifications",
      ];
      if (validTabs.includes(tab as TabType)) {
        setActiveTab(tab as TabType);
      }
    }
  }, [location.search, setActiveTab]);

  // Listen for custom navigation events from toast (for sampling and elicitation requests)
  useEffect(() => {
    const handleNavigateToSampling = (event: globalThis.Event) => {
      const customEvent = event as globalThis.CustomEvent<{
        requestId: string;
      }>;
      const requestId = customEvent.detail.requestId;

      // Switch to sampling tab and auto-select the request
      if (selectedServerId) {
        navigateToItem(selectedServerId, "sampling", requestId);
      }
    };

    const handleNavigateToElicitation = (event: globalThis.Event) => {
      const customEvent = event as globalThis.CustomEvent<{
        requestId: string;
      }>;
      const requestId = customEvent.detail.requestId;

      // Switch to elicitation tab and auto-select the request
      if (selectedServerId) {
        navigateToItem(selectedServerId, "elicitation", requestId);
      }
    };

    const handleNavigateToToolResult = (event: globalThis.Event) => {
      const customEvent = event as globalThis.CustomEvent<{
        toolName: string | null;
      }>;
      const toolName = customEvent.detail.toolName;

      // Switch to tools tab and auto-select the tool
      if (selectedServerId && toolName) {
        navigateToItem(selectedServerId, "tools", toolName);
      } else if (selectedServerId) {
        // If no toolName, just switch to tools tab
        setActiveTab("tools");
      }
    };

    window.addEventListener("navigate-to-sampling", handleNavigateToSampling);
    window.addEventListener(
      "navigate-to-elicitation",
      handleNavigateToElicitation
    );
    window.addEventListener(
      "navigate-to-tool-result",
      handleNavigateToToolResult
    );

    return () => {
      window.removeEventListener(
        "navigate-to-sampling",
        handleNavigateToSampling
      );
      window.removeEventListener(
        "navigate-to-elicitation",
        handleNavigateToElicitation
      );
      window.removeEventListener(
        "navigate-to-tool-result",
        handleNavigateToToolResult
      );
    };
  }, [selectedServerId, setActiveTab, navigateToItem]);

  // Refs for search inputs in tabs
  const toolsSearchRef = useRef<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>(null);
  const promptsSearchRef = useRef<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>(null);
  const resourcesSearchRef = useRef<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>(null);

  // Auto-connect handling extracted to custom hook
  const { isAutoConnecting } = useAutoConnect({
    connections,
    addConnection,
    removeConnection,
    configLoaded,
    embedded: isEmbedded,
  });

  // Track command palette open
  const handleCommandPaletteOpen = useCallback(
    (trigger: "keyboard" | "button") => {
      const telemetry = Telemetry.getInstance();
      telemetry
        .capture(
          new MCPCommandPaletteOpenEvent({
            trigger,
          })
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        });
      setIsCommandPaletteOpen(true);
    },
    []
  );

  const handleServerSelect = (serverId: string) => {
    const server = connections.find((c) => c.id === serverId);
    if (!server || server.state !== "ready") {
      toast.error("Server is not connected and cannot be inspected");
      return;
    }
    setSelectedServerId(serverId);
    // Preserve tunnelUrl and tab parameters if present
    const urlParams = new URLSearchParams(location.search);
    const tunnelUrl = urlParams.get("tunnelUrl");
    const tab = urlParams.get("tab");
    const params = new URLSearchParams();
    params.set("server", serverId);
    if (tunnelUrl) params.set("tunnelUrl", tunnelUrl);
    if (tab) params.set("tab", tab);
    navigate(`/?${params.toString()}`);
  };

  const handleOpenConnectionOptions = useCallback(
    (connectionId: string | null) => {
      setEditingConnectionId(connectionId);
    },
    []
  );

  const handleUpdateConnection = useCallback(
    (config: {
      url: string;
      name?: string;
      transportType: "http" | "sse";
      proxyConfig?: {
        proxyAddress?: string;
        customHeaders?: Record<string, string>;
      };
    }) => {
      if (!editingConnectionId) return;

      // If the URL changed, we need to remove the old one and add a new one
      if (config.url !== editingConnectionId) {
        removeConnection(editingConnectionId);
        addConnection(
          config.url,
          config.name,
          config.proxyConfig,
          config.transportType
        );
      } else {
        // Otherwise just update the existing connection
        updateConnectionConfig(editingConnectionId, {
          name: config.name,
          proxyConfig: config.proxyConfig,
          transportType: config.transportType,
        });
      }

      // Close the modal
      setEditingConnectionId(null);

      toast.success("Connection settings updated");
    },
    [
      editingConnectionId,
      removeConnection,
      addConnection,
      updateConnectionConfig,
    ]
  );

  const handleCommandPaletteNavigate = (
    tab: "tools" | "prompts" | "resources",
    itemName?: string,
    serverId?: string
  ) => {
    console.warn("[Layout] handleCommandPaletteNavigate called:", {
      tab,
      itemName,
      serverId,
    });

    // If a serverId is provided, navigate to that server
    if (serverId) {
      const server = connections.find((c) => c.id === serverId);
      console.warn("[Layout] Server lookup:", {
        serverId,
        serverFound: !!server,
        serverState: server?.state,
      });

      if (!server || server.state !== "ready") {
        console.warn("[Layout] Server not ready, showing error");
        toast.error("Server is not connected and cannot be inspected");
        return;
      }

      console.warn("[Layout] Calling navigateToItem:", {
        serverId,
        tab,
        itemName,
      });
      // Use the context's navigateToItem to set all state atomically
      navigateToItem(serverId, tab, itemName);
      // Navigate using query params
      // Preserve tunnelUrl and tab parameters if present
      const urlParams = new URLSearchParams(location.search);
      const tunnelUrl = urlParams.get("tunnelUrl");
      const existingTab = urlParams.get("tab");
      const params = new URLSearchParams();
      params.set("server", serverId);
      if (tunnelUrl) params.set("tunnelUrl", tunnelUrl);
      // Use the tab from the function parameter, or preserve existing tab if not changing
      if (tab) params.set("tab", tab);
      else if (existingTab) params.set("tab", existingTab);
      const newUrl = `/?${params.toString()}`;
      console.warn("[Layout] Navigating to:", newUrl);
      navigate(newUrl);
    } else {
      console.warn("[Layout] No serverId, just updating tab to:", tab);
      // No serverId provided, just update the tab for the current server
      setActiveTab(tab);
    }
  };

  const selectedServer = connections.find((c) => c.id === selectedServerId);

  // Aggregate tools, prompts, and resources from all connected servers
  // When a server is selected, use only that server's items
  // When no server is selected, aggregate from all ready servers and add server metadata
  const aggregatedTools = selectedServer
    ? selectedServer.tools.map((tool) => ({
        ...tool,
        _serverId: selectedServer.id,
      }))
    : connections.flatMap((conn) =>
        conn.state === "ready"
          ? conn.tools.map((tool) => ({
              ...tool,
              _serverId: conn.id,
              _serverName: conn.name,
            }))
          : []
      );

  const aggregatedPrompts = selectedServer
    ? selectedServer.prompts.map((prompt) => ({
        ...prompt,
        _serverId: selectedServer.id,
      }))
    : connections.flatMap((conn) =>
        conn.state === "ready"
          ? conn.prompts.map((prompt) => ({
              ...prompt,
              _serverId: conn.id,
              _serverName: conn.name,
            }))
          : []
      );

  const aggregatedResources = selectedServer
    ? selectedServer.resources.map((resource) => ({
        ...resource,
        _serverId: selectedServer.id,
      }))
    : connections.flatMap((conn) =>
        conn.state === "ready"
          ? conn.resources.map((resource) => ({
              ...resource,
              _serverId: conn.id,
              _serverName: conn.name,
            }))
          : []
      );

  // Sync URL query params with selected server state
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const serverParam = searchParams.get("server");
    const decodedServerId = serverParam
      ? decodeURIComponent(serverParam)
      : null;

    // Update selected server if changed
    if (decodedServerId !== selectedServerId) {
      setSelectedServerId(decodedServerId);
    }
  }, [location.search, selectedServerId, setSelectedServerId]);

  // Handle failed server connections - redirect to home
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const serverParam = searchParams.get("server");
    if (!serverParam) {
      return;
    }

    const decodedServerId = decodeURIComponent(serverParam);
    const serverConnection = connections.find(
      (conn) => conn.id === decodedServerId
    );

    // No connection found - wait for auto-connect, then redirect
    if (!serverConnection) {
      const timeoutId = setTimeout(() => navigate("/"), 3000);
      return () => clearTimeout(timeoutId);
    }

    // Connection failed - redirect after short delay
    if (serverConnection.state === "failed") {
      const timeoutId = setTimeout(() => navigate("/"), 2000);
      return () => clearTimeout(timeoutId);
    }
  }, [location.search, navigate, connections]);

  // Centralized keyboard shortcuts
  useKeyboardShortcuts({
    onCommandPalette: () => handleCommandPaletteOpen("keyboard"),
    onToolsTab: () => {
      if (selectedServer) {
        setActiveTab("tools");
      }
    },
    onPromptsTab: () => {
      if (selectedServer) {
        setActiveTab("prompts");
      }
    },
    onResourcesTab: () => {
      if (selectedServer) {
        setActiveTab("resources");
      }
    },
    onChatTab: () => {
      if (selectedServer) {
        setActiveTab("chat");
      }
    },
    onHome: () => {
      navigate("/");
    },
    onFocusSearch: () => {
      // Focus the search bar based on the active tab
      if (activeTab === "tools" && toolsSearchRef.current) {
        toolsSearchRef.current.focusSearch();
      } else if (activeTab === "prompts" && promptsSearchRef.current) {
        promptsSearchRef.current.focusSearch();
      } else if (activeTab === "resources" && resourcesSearchRef.current) {
        resourcesSearchRef.current.focusSearch();
      }
    },
    onBlurSearch: () => {
      // Blur the search bar based on the active tab
      if (activeTab === "tools" && toolsSearchRef.current) {
        toolsSearchRef.current.blurSearch();
      } else if (activeTab === "prompts" && promptsSearchRef.current) {
        promptsSearchRef.current.blurSearch();
      } else if (activeTab === "resources" && resourcesSearchRef.current) {
        resourcesSearchRef.current.blurSearch();
      }
    },
  });

  // Show loading spinner during auto-connection
  if (isAutoConnecting) {
    return (
      <div className="h-screen bg-white dark:bg-zinc-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-8 w-8 text-zinc-600 dark:text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connecting to MCP server...
          </p>
        </div>
      </div>
    );
  }

  // Apply embedded styling
  const containerStyle: React.CSSProperties = isEmbedded
    ? {
        backgroundColor: embeddedConfig.backgroundColor || "#f3f3f3",
        padding: embeddedConfig.padding || "0.5rem",
      }
    : {};

  const containerClassName = isEmbedded
    ? "h-screen flex flex-col gap-2 sm:gap-4"
    : "h-screen bg-[#f3f3f3] dark:bg-black flex flex-col px-2 py-2 sm:px-4 sm:py-4 gap-2 sm:gap-4";

  return (
    <TooltipProvider>
      <div className={containerClassName} style={containerStyle}>
        {/* Header */}
        <LayoutHeader
          connections={connections}
          selectedServer={selectedServer}
          activeTab={activeTab}
          onServerSelect={handleServerSelect}
          onTabChange={setActiveTab}
          onCommandPaletteOpen={() => handleCommandPaletteOpen("button")}
          onOpenConnectionOptions={handleOpenConnectionOptions}
          embedded={isEmbedded}
        />

        {/* Main Content */}
        <main className="flex-1 w-full mx-auto bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-zinc-700 p-0 overflow-auto">
          <LayoutContent
            selectedServer={selectedServer}
            activeTab={activeTab}
            toolsSearchRef={toolsSearchRef}
            promptsSearchRef={promptsSearchRef}
            resourcesSearchRef={resourcesSearchRef}
          >
            {children}
          </LayoutContent>
        </main>

        {/* Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onOpenChange={setIsCommandPaletteOpen}
          tools={aggregatedTools}
          prompts={aggregatedPrompts}
          resources={aggregatedResources}
          savedRequests={savedRequests}
          connections={connections}
          selectedServer={selectedServer}
          tunnelUrl={tunnelUrl}
          onNavigate={handleCommandPaletteNavigate}
          onServerSelect={handleServerSelect}
        />

        {/* Connection Options Dialog */}
        <ServerConnectionModal
          connection={
            editingConnectionId
              ? connections.find((c) => c.id === editingConnectionId) || null
              : null
          }
          open={editingConnectionId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditingConnectionId(null);
            }
          }}
          onConnect={handleUpdateConnection}
        />
      </div>
    </TooltipProvider>
  );
}
