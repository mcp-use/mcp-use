import { Spinner } from "@/client/components/ui/spinner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import {
  useInspector,
  type EmbeddedConfig,
  type TabType,
} from "@/client/context/InspectorContext";
import { useAutoConnect } from "@/client/hooks/useAutoConnect";
import { cn } from "@/client/lib/utils";
import { useKeyboardShortcuts } from "@/client/hooks/useKeyboardShortcuts";
import { useSavedRequests } from "@/client/hooks/useSavedRequests";
import {
  MCPCommandPaletteOpenEvent,
  MCPTabNavigationEvent,
  MCPSessionDurationEvent,
  captureInspectorEvent,
} from "@/client/telemetry";
import {
  getDefaultInspectorProxyAddress,
  getStoredConnectionConfig,
  isAliasOnlyConnectionUpdate,
  normalizeConnectionMode,
  protocolModeFromNegotiation,
  protocolNegotiationForMode,
  saveStoredConnectionConfig,
  toMcpServerConfig,
  type EditableConnectionConfig,
} from "@/client/utils/connectionUpdates";
import { isInspectorSamplingAvailable } from "@/client/utils/samplingProtocol";
import { getServerDisplayName } from "@/client/utils/servers";
import { useMcpClient, type McpServer } from "@mcp-use/client/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { CommandPalette } from "./CommandPalette";
import { LayoutContent } from "./LayoutContent";
import { LayoutHeader } from "./LayoutHeader";
import { InspectorSidebar } from "./layout/sidebar/InspectorSidebar";
import { SidebarRpcPanel } from "./layout/sidebar/SidebarRpcPanel";
import { MobileInspectorToolbar } from "./layout/mobile/MobileInspectorToolbar";
import { useTunnelConnectionSync } from "./layout/useTunnelConnectionSync";

interface LayoutProps {
  children: ReactNode;
}

/**
 * Render the application layout that orchestrates header, main content, command palette, and server connection modal.
 *
 * This component wires MCP client and inspector state, synchronizes URL query parameters (server, tab, tunnelUrl, embedded),
 * manages keyboard shortcuts, auto-connect flow, aggregated tool/prompt/resource lists.
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
    updateServerMetadata,
    updateServer,
    storageLoaded: configLoaded,
  } = useMcpClient();

  const updateConnectionConfig = useCallback(
    async (id: string, config: EditableConnectionConfig) => {
      try {
        await updateServer(id, toMcpServerConfig(config));
        saveStoredConnectionConfig(id, config);
      } catch (error) {
        console.error(`[Layout] Failed to update connection ${id}:`, error);
      }
    },
    [updateServer]
  );

  const updateConnectionMetadata = useCallback(
    async (id: string, metadata: { name: string }) => {
      try {
        await updateServerMetadata(id, metadata);
      } catch (error) {
        console.error(
          `[Layout] Failed to update connection metadata for ${id}:`,
          error
        );
      }
    },
    [updateServerMetadata]
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("inspector-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [rpcLoggerOpen, setRpcLoggerOpen] = useState(() => {
    try {
      return localStorage.getItem("inspector-rpc-logger-open") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "inspector-sidebar-collapsed",
        sidebarCollapsed ? "true" : "false"
      );
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    try {
      localStorage.setItem("inspector-rpc-logger-open", String(rpcLoggerOpen));
    } catch {
      // Storage is optional.
    }
  }, [rpcLoggerOpen]);
  const { savedRequests } = useSavedRequests();

  // Initialize embedded mode from URL params once on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const embedded = urlParams.get("embedded") === "true";
    const embeddedConfigParam = urlParams.get("embeddedConfig");

    if (embedded) {
      let config: EmbeddedConfig = {};
      if (embeddedConfigParam) {
        try {
          config = JSON.parse(embeddedConfigParam);
        } catch (error) {
          console.error("Failed to parse embeddedConfig:", error);
        }
      }
      setEmbeddedMode(true, config);

      // Apply defaultTab from embeddedConfig (overrides ?tab= param)
      if (config.defaultTab) {
        setActiveTab(config.defaultTab);
      }
    }
  }, []); // Only run once on mount

  // Read tunnelUrl from query parameters and store in context
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const tunnelUrlParam = urlParams.get("tunnelUrl");
    if (tunnelUrlParam !== null) {
      setTunnelUrl(tunnelUrlParam);
    }
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
        "server-metadata",
        "connection-settings",
      ];
      if (validTabs.includes(tab as TabType)) {
        setActiveTab(tab as TabType);
      }
    }
  }, [location.search, setActiveTab]);

  // Tab navigation telemetry
  const previousTabRef = useRef<string | null>(null);

  // Session duration tracking
  const sessionStartRef = useRef<number>(Date.now());
  const tabsVisitedRef = useRef<Set<string>>(new Set());
  const toolsExecutedRef = useRef<number>(0);

  useEffect(() => {
    const handler = () => {
      toolsExecutedRef.current++;
    };
    window.addEventListener("mcp-tool-executed", handler);
    return () => window.removeEventListener("mcp-tool-executed", handler);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        const durationSeconds = Math.round(
          (Date.now() - sessionStartRef.current) / 1000
        );
        captureInspectorEvent(
          new MCPSessionDurationEvent({
            durationSeconds,
            tabsVisited: tabsVisitedRef.current.size,
            toolsExecuted: toolsExecutedRef.current,
          })
        ).catch(() => {});
      } catch {
        // ignore telemetry errors
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Sync the URL ?tab= param whenever the active tab changes
  const handleTabChange = useCallback(
    (tab: TabType) => {
      try {
        captureInspectorEvent(
          new MCPTabNavigationEvent({
            tab,
            previousTab: previousTabRef.current,
          })
        ).catch(() => {});
      } catch {
        // ignore telemetry errors
      }
      previousTabRef.current = tab;
      tabsVisitedRef.current.add(tab);

      setActiveTab(tab);
      const params = new URLSearchParams(location.search);
      params.set("tab", tab);
      navigate(`/?${params.toString()}`, { replace: true });
    },
    [setActiveTab, navigate, location.search]
  );

  // A bookmarked sampling URL can be restored before protocol negotiation
  // finishes. Once a modern connection is known, move to a supported tab.
  useEffect(() => {
    const selectedServer = connections.find(
      (connection) => connection.id === selectedServerId
    );
    if (
      activeTab === "sampling" &&
      selectedServer &&
      !isInspectorSamplingAvailable(selectedServer)
    ) {
      handleTabChange("tools");
    }
  }, [activeTab, connections, selectedServerId, handleTabChange]);

  // Listen for custom navigation events from toast (for sampling and elicitation requests)
  useEffect(() => {
    const handleNavigateToSampling = (event: globalThis.Event) => {
      const customEvent = event as globalThis.CustomEvent<{
        requestId: string;
      }>;
      const requestId = customEvent.detail.requestId;

      const selectedServer = connections.find(
        (connection) => connection.id === selectedServerId
      );

      // Modern connections neither advertise nor expose legacy sampling.
      if (
        selectedServerId &&
        selectedServer &&
        isInspectorSamplingAvailable(selectedServer)
      ) {
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
        handleTabChange("tools");
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
  }, [selectedServerId, connections, handleTabChange, navigateToItem]);

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
    addServer,
    removeConnection,
    configLoaded,
    embedded: isEmbedded,
  });

  // Shell inline style can stay #0c0c0d until a full reload; match VT backdrop for crossfade.
  useEffect(() => {
    const syncPageBg = () => {
      const bg = document.documentElement.classList.contains("dark")
        ? "#000000"
        : "#f3f3f3";
      document.documentElement.style.backgroundColor = bg;
      document.body.style.backgroundColor = bg;
    };
    syncPageBg();
    const observer = new MutationObserver(syncPageBg);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Track command palette open
  const handleCommandPaletteOpen = useCallback(
    (trigger: "keyboard" | "button") => {
      captureInspectorEvent(
        new MCPCommandPaletteOpenEvent({
          trigger,
        })
      ).catch(() => {
        // Silently fail - telemetry should not break the application
      });
      setIsCommandPaletteOpen(true);
    },
    []
  );

  const handleServerSelect = (serverId: string) => {
    const server = connections.find((c) => c.id === serverId);
    if (!server) return;
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

  const handleUpdateConnection = useCallback(
    (config: EditableConnectionConfig) => {
      if (!selectedServerId) return;

      const currentConnection =
        getStoredConnectionConfig<EditableConnectionConfig>(selectedServerId) ||
        connections.find(
          (connection: McpServer) => connection.id === selectedServerId
        );

      if (config.url !== selectedServerId) {
        removeConnection(selectedServerId);
        addServer(config.url, toMcpServerConfig(config));
      } else if (
        currentConnection &&
        isAliasOnlyConnectionUpdate(currentConnection, config)
      ) {
        updateConnectionMetadata(selectedServerId, {
          name: config.name || config.url,
        });
        saveStoredConnectionConfig(selectedServerId, config);
      } else {
        updateConnectionConfig(selectedServerId, config);
      }

      toast.success("Connection settings updated");
    },
    [
      selectedServerId,
      connections,
      removeConnection,
      addServer,
      updateConnectionMetadata,
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
      handleTabChange(tab);
    }
  };

  const selectedServer = connections.find((c) => c.id === selectedServerId);

  const isTunnelConnecting = useTunnelConnectionSync({
    tunnelUrl,
    selectedServerId,
    selectedServer,
    configLoaded,
    removeConnection,
    updateConnection: updateServer,
    connections,
  });

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
              _serverName: getServerDisplayName(conn),
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
              _serverName: getServerDisplayName(conn),
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
              _serverName: getServerDisplayName(conn),
            }))
          : []
      );

  // Sync URL query params with selected server state
  useEffect(() => {
    if (isTunnelConnecting) return;

    const searchParams = new URLSearchParams(location.search);
    // Note: searchParams.get() already URL-decodes, no need for decodeURIComponent
    const serverId = searchParams.get("server");

    // If server= is a URL and no matching connection exists, treat it as autoConnect=
    if (
      serverId &&
      (serverId.startsWith("http://") || serverId.startsWith("https://"))
    ) {
      const existingConnection = connections.find(
        (conn) => conn.id === serverId
      );

      if (!existingConnection) {
        // Redirect to use autoConnect= parameter instead
        const params = new URLSearchParams(searchParams);
        params.delete("server");
        params.set("autoConnect", serverId);
        navigate(`/?${params.toString()}`, { replace: true });
        return;
      }
    }

    // Update selected server if changed
    if (serverId !== selectedServerId) {
      setSelectedServerId(serverId);
    }
  }, [
    location.search,
    selectedServerId,
    setSelectedServerId,
    connections,
    navigate,
    isTunnelConnecting,
  ]);

  // Handle missing server connections - redirect to home when URL points at unknown server
  useEffect(() => {
    if (isTunnelConnecting) return;

    const searchParams = new URLSearchParams(location.search);
    const serverId = searchParams.get("server");
    if (!serverId) {
      return;
    }

    const serverConnection = connections.find((conn) => conn.id === serverId);

    if (!serverConnection) {
      const timeoutId = setTimeout(() => navigate("/"), 3000);
      return () => clearTimeout(timeoutId);
    }
  }, [location.search, navigate, connections, isTunnelConnecting]);

  // Handle mcp-inspector:connect_servers postMessage from parent frame.
  // Allows a host page to securely pass server configs (incl. auth) without
  // putting tokens in the URL.
  useEffect(() => {
    if (!isEmbedded) return;

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type !== "mcp-inspector:connect_servers") return;

      const serverList = event.data.servers;
      if (!Array.isArray(serverList) || serverList.length === 0) return;

      let firstServerId: string | null = null;
      for (const srv of serverList) {
        if (!srv.url || typeof srv.url !== "string") continue;

        const url: string = srv.url;
        const name: string = srv.name ?? "Server";

        const headers: Record<string, string> = {
          ...(srv.headers ?? {}),
        };
        if (srv.auth?.access_token) {
          const tokenType = srv.auth.token_type || "bearer";
          const formatted =
            tokenType.charAt(0).toUpperCase() + tokenType.slice(1);
          headers.Authorization = `${formatted} ${srv.auth.access_token}`;
        }

        const explicitProxyAddress =
          typeof srv.proxyConfig?.proxyAddress === "string"
            ? srv.proxyConfig.proxyAddress.trim()
            : "";
        let defaultProxyAddress = "";
        try {
          if (new URL(url).origin !== window.location.origin) {
            defaultProxyAddress = getDefaultInspectorProxyAddress();
          }
        } catch {
          defaultProxyAddress = getDefaultInspectorProxyAddress();
        }

        const proxyAddress = explicitProxyAddress || defaultProxyAddress;
        const connectionMode = normalizeConnectionMode(
          srv.connectionMode,
          srv.connectionType,
          !!explicitProxyAddress
        );
        const serverOptions = toMcpServerConfig({
          url,
          name,
          transportType: "http",
          connectionMode,
          protocolNegotiation: protocolNegotiationForMode(
            protocolModeFromNegotiation(srv.protocolNegotiation)
          ),
          connectionType: connectionMode === "proxy" ? "Via Proxy" : "Direct",
          proxyConfig:
            connectionMode === "proxy" && proxyAddress
              ? {
                  proxyAddress,
                  ...(Object.keys(headers).length > 0 ? { headers } : {}),
                }
              : undefined,
          headers,
          autoProxyFallback:
            connectionMode === "auto" && proxyAddress
              ? { enabled: true, proxyAddress }
              : false,
        });

        const existing = connections.find((c) => c.url === url);
        if (!existing) {
          addServer(url, serverOptions);
        }

        if (!firstServerId) {
          firstServerId = url;
        }
      }

      // Confirm back to parent
      if (window.parent !== window) {
        window.parent.postMessage(
          {
            type: "mcp-inspector:servers_connected",
            count: serverList.length,
          },
          "*"
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isEmbedded, connections, addServer]);

  // Auto-select the first ready server when new servers connect via postMessage.
  // This handles the case where connect_servers adds servers and we need to
  // navigate to one of them once it's ready.
  const postMessageAutoSelectRef = useRef(false);
  useEffect(() => {
    if (!isEmbedded || postMessageAutoSelectRef.current) return;
    if (selectedServerId) return;

    const readyServer = connections.find((c) => c.state === "ready");
    if (readyServer) {
      postMessageAutoSelectRef.current = true;
      setSelectedServerId(readyServer.id);
      const params = new URLSearchParams(location.search);
      params.set("server", readyServer.id);
      navigate(`/?${params.toString()}`, { replace: true });
    }
  }, [
    isEmbedded,
    connections,
    selectedServerId,
    setSelectedServerId,
    navigate,
    location.search,
  ]);

  // Centralized keyboard shortcuts
  useKeyboardShortcuts({
    onCommandPalette: () => handleCommandPaletteOpen("keyboard"),
    onToolsTab: () => {
      if (selectedServer) {
        handleTabChange("tools");
      }
    },
    onPromptsTab: () => {
      if (selectedServer) {
        handleTabChange("prompts");
      }
    },
    onResourcesTab: () => {
      if (selectedServer) {
        handleTabChange("resources");
      }
    },
    onChatTab: () => {
      if (selectedServer) {
        handleTabChange("chat");
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

  // Show loading until auto-connect finishes or saved connections hydrate a ?server= link
  const urlServerId = new URLSearchParams(location.search).get("server");
  const isBootstrappingServer =
    !configLoaded &&
    !!urlServerId &&
    !urlServerId.startsWith("http://") &&
    !urlServerId.startsWith("https://");
  const showBootScreen =
    isAutoConnecting || isBootstrappingServer || isTunnelConnecting;
  const layoutViewKey = selectedServer?.id ?? "home";
  const viewTransitionKey = showBootScreen ? "boot" : layoutViewKey;
  const [displayKey, setDisplayKey] = useState(viewTransitionKey);

  useLayoutEffect(() => {
    if (viewTransitionKey === displayKey) return;

    const apply = () => flushSync(() => setDisplayKey(viewTransitionKey));

    if (typeof document.startViewTransition === "function") {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }, [viewTransitionKey, displayKey]);

  const showDisplayBoot = displayKey === "boot";
  const displayServer =
    showDisplayBoot || displayKey === "home"
      ? undefined
      : connections.find((c) => c.id === displayKey);

  // Apply embedded styling
  const isSingleTab = isEmbedded && embeddedConfig.singleTab;

  const containerStyle: React.CSSProperties = isEmbedded
    ? {
        backgroundColor: embeddedConfig.backgroundColor || "#f3f3f3",
        padding: isSingleTab ? "0" : embeddedConfig.padding || "0.5rem",
      }
    : {};

  const containerClassName = isEmbedded
    ? isSingleTab
      ? "h-screen flex flex-col"
      : "h-screen flex flex-col gap-2 sm:gap-4"
    : "h-screen bg-[#f3f3f3] dark:bg-black flex flex-col overflow-x-hidden px-4 lg:px-0 pb-[calc(var(--mobile-toolbar-height)+env(safe-area-inset-bottom))] lg:pb-4";

  const mainClassName = isSingleTab
    ? "flex-1 w-full bg-white dark:bg-black p-0 overflow-auto"
    : cn(
        "flex-1 min-h-0 min-w-0 max-w-full w-full bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-x-hidden overflow-y-auto",
        !displayServer && "lg:mx-4",
        displayServer && "lg:mr-4"
      );

  const bodyClassName = isSingleTab
    ? "flex-1 min-h-0"
    : "flex min-w-0 flex-1 min-h-0 overflow-hidden";

  const headerProps = {
    connections,
    selectedServer: displayServer,
    activeTab,
    onServerSelect: handleServerSelect,
    onTabChange: handleTabChange,
    embedded: isEmbedded,
    sidebarCollapsed,
  };

  return (
    <TooltipProvider>
      <div className="inspector-view-transition h-screen overflow-x-hidden bg-[#f3f3f3] dark:bg-black">
        {showDisplayBoot ? (
          <div className="flex h-full items-center justify-center bg-[#f3f3f3] dark:bg-black">
            <div className="flex flex-col items-center gap-4">
              <Spinner className="h-8 w-8 text-zinc-600 dark:text-zinc-400" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Connecting to MCP server...
              </p>
            </div>
          </div>
        ) : (
          <div className={containerClassName} style={containerStyle}>
            {/* Header - hidden in single-tab mode */}
            {!isSingleTab && <LayoutHeader {...headerProps} />}

            <div className={bodyClassName}>
              {displayServer && !isSingleTab && (
                <InspectorSidebar
                  activeTab={activeTab}
                  onTabChange={handleTabChange}
                  selectedServer={displayServer}
                  visibleTabs={embeddedConfig.visibleTabs}
                  collapsed={sidebarCollapsed}
                  onCollapsedChange={setSidebarCollapsed}
                  rpcLoggerOpen={rpcLoggerOpen}
                  onRpcLoggerOpenChange={setRpcLoggerOpen}
                  onCommandPaletteOpen={() =>
                    handleCommandPaletteOpen("button")
                  }
                />
              )}
              <main className={mainClassName}>
                <LayoutContent
                  selectedServer={displayServer}
                  activeTab={activeTab}
                  toolsSearchRef={toolsSearchRef}
                  promptsSearchRef={promptsSearchRef}
                  resourcesSearchRef={resourcesSearchRef}
                  onUpdateConnection={handleUpdateConnection}
                >
                  {children}
                </LayoutContent>
              </main>
              {displayServer && !isSingleTab && (
                <SidebarRpcPanel
                  serverId={displayServer.id}
                  open={rpcLoggerOpen}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {!isSingleTab && !showDisplayBoot && (
        <MobileInspectorToolbar
          serverId={displayServer?.id}
          rpcLoggerOpen={rpcLoggerOpen}
          onRpcLoggerOpenChange={setRpcLoggerOpen}
        />
      )}

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
    </TooltipProvider>
  );
}
