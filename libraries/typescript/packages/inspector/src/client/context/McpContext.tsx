import { MCPServerRemovedEvent, Telemetry } from "@/client/telemetry";
import { useMcp } from "mcp-use/react";
import type { ReactNode } from "react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface MCPNotification {
  id: string;
  method: string;
  params?: Record<string, any>;
  timestamp: number;
  read: boolean;
}

export interface MCPConnection {
  id: string;
  url: string;
  name: string;
  state: string;
  tools: any[];
  resources: any[];
  prompts: any[];
  error: string | null;
  authUrl: string | null;
  customHeaders?: Record<string, string>;
  transportType?: "http" | "sse";
  proxyConfig?: {
    proxyAddress?: string;
    customHeaders?: Record<string, string>;
  };
  serverInfo?: {
    name: string;
    version?: string;
    icons?: Array<{
      src: string;
      mimeType?: string;
      sizes?: string;
    }>;
    websiteUrl?: string;
  };
  capabilities?: {
    tools?: {
      listChanged?: boolean;
    };
    resources?: {
      subscribe?: boolean;
      listChanged?: boolean;
    };
    prompts?: {
      listChanged?: boolean;
    };
    logging?: Record<string, any>;
    completions?: Record<string, any>;
    [key: string]: any;
  };
  notifications: MCPNotification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  callTool: (
    toolName: string,
    args: any,
    options?: {
      timeout?: number;
      maxTotalTimeout?: number;
      resetTimeoutOnProgress?: boolean;
      signal?: AbortSignal;
    }
  ) => Promise<any>;
  readResource: (uri: string) => Promise<any>;
  listPrompts: (serverName?: string) => Promise<void>;
  getPrompt: (name: string, args: any) => Promise<any>;
  authenticate: () => void;
  retry: () => void;
  clearStorage: () => void;
  disconnect: () => void;
  client: any;
}

interface McpContextType {
  connections: MCPConnection[];
  addConnection: (
    url: string,
    name?: string,
    proxyConfig?: {
      proxyAddress?: string;
      customHeaders?: Record<string, string>;
    },
    transportType?: "http" | "sse"
  ) => void;
  removeConnection: (id: string) => void;
  updateConnectionConfig: (
    id: string,
    config: {
      name?: string;
      proxyConfig?: {
        proxyAddress?: string;
        customHeaders?: Record<string, string>;
      };
      transportType?: "http" | "sse";
    }
  ) => void;
  autoConnect: boolean;
  setAutoConnect: (enabled: boolean) => void;
  connectServer: (id: string) => void;
  disconnectServer: (id: string) => void;
  configLoaded: boolean;
}

const McpContext = createContext<McpContextType | null>(null);

export function useMcpContext() {
  const context = use(McpContext);
  if (!context) {
    throw new Error("useMcpContext must be used within a McpProvider");
  }
  return context;
}

function McpConnectionWrapper({
  url,
  name,
  proxyConfig,
  transportType,
  connectionId,
  onUpdate,
  onRemove: _onRemove,
}: {
  url: string;
  name: string;
  proxyConfig?: {
    proxyAddress?: string;
    customHeaders?: Record<string, string>;
  };
  transportType?: "http" | "sse";
  connectionId: string;
  onUpdate: (connection: MCPConnection) => void;
  onRemove: () => void;
}) {
  // Configure OAuth callback URL
  // Use /inspector/oauth/callback for proper routing in the inspector
  const callbackUrl =
    typeof window !== "undefined"
      ? new URL("/inspector/oauth/callback", window.location.origin).toString()
      : "/inspector/oauth/callback";

  // Apply proxy configuration if provided
  let finalUrl = url;
  let customHeaders: Record<string, string> = {};

  if (proxyConfig?.proxyAddress) {
    // If proxy is configured, use the proxy address as the URL
    // For MCP connections, we need to append the SSE endpoint to the proxy URL
    const proxyUrl = new URL(proxyConfig.proxyAddress);
    const originalUrl = new URL(url);

    // Construct the final proxy URL by combining proxy base with original path
    finalUrl = `${proxyUrl.origin}${proxyUrl.pathname}${originalUrl.pathname}${originalUrl.search}`;

    // Add original URL as a header so the proxy knows where to forward the request
    customHeaders["X-Target-URL"] = url;
  }

  // Merge any additional custom headers
  if (proxyConfig?.customHeaders) {
    customHeaders = { ...customHeaders, ...proxyConfig.customHeaders };
  }

  // Import transport wrapper for RPC logging - load it immediately
  // We need to load this BEFORE useMcp is called, so we use a ref to track readiness
  const wrapTransportRef = useRef<
    ((transport: any, serverId: string) => any) | null
  >(null);
  const [wrapTransportReady, setWrapTransportReady] = useState(false);
  const wrapperLoadAttemptedRef = useRef(false);

  // Load the transport wrapper immediately on mount - BEFORE useMcp connects
  useEffect(() => {
    if (typeof window !== "undefined" && !wrapperLoadAttemptedRef.current) {
      wrapperLoadAttemptedRef.current = true;
      import("../transport-wrapper-browser.js")
        .then((module) => {
          wrapTransportRef.current = module.wrapTransportForLogging;
          setWrapTransportReady(true);
          console.log("[McpContext] Transport wrapper loaded");
        })
        .catch((err) => {
          console.error("[McpContext] Failed to load transport wrapper:", err);
        });
    }
  }, []);

  // Create a stable wrapper function that uses the connectionId as serverId
  const wrapTransportFn = useMemo(() => {
    if (!wrapTransportReady || !wrapTransportRef.current) {
      return undefined;
    }
    return (transport: any, serverIdFromConnector: string) => {
      // Use connectionId as serverId to match connection.id
      const actualServerId = connectionId;
      console.log(
        "[McpContext] Applying transport wrapper, serverId:",
        actualServerId,
        "from connector:",
        serverIdFromConnector
      );
      return wrapTransportRef.current!(transport, actualServerId);
    };
  }, [wrapTransportReady, connectionId]);

  // Notification state management
  const NOTIFICATIONS_STORAGE_KEY = `mcp-inspector-notifications-${connectionId}`;
  const MAX_NOTIFICATIONS = 500;

  const [notifications, setNotifications] = useState<MCPNotification[]>([]);

  // Load notifications from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setNotifications(parsed);
        }
      }
    } catch (e) {
      console.error("Failed to load notifications from localStorage:", e);
    }
  }, [NOTIFICATIONS_STORAGE_KEY]);

  // Save notifications to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem(
        NOTIFICATIONS_STORAGE_KEY,
        JSON.stringify(notifications)
      );
    } catch (e) {
      console.error("Failed to save notifications to localStorage:", e);
    }
  }, [notifications, NOTIFICATIONS_STORAGE_KEY]);

  // Notification handlers
  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const onNotificationReceived = useCallback(
    (notification: MCPNotification) => {
      setNotifications((prev) => {
        // Prune oldest if we exceed max
        const updated = [notification, ...prev];
        if (updated.length > MAX_NOTIFICATIONS) {
          return updated.slice(0, MAX_NOTIFICATIONS);
        }
        return updated;
      });
    },
    []
  );

  // Only enable useMcp connection after transport wrapper is ready
  // This ensures RPC logging is active from the start
  const mcpHook = useMcp({
    url: finalUrl,
    callbackUrl,
    customHeaders:
      Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    transportType: transportType || "http", // Default to 'http' for Streamable HTTP
    preventAutoAuth: true, // Show auth button instead of auto-triggering OAuth
    useRedirectFlow: true, // Use redirect instead of popup for better UX
    enabled: wrapTransportReady, // Only connect when wrapper is ready
    wrapTransport: wrapTransportFn,
    onNotification: (notification) => {
      onNotificationReceived({
        id: globalThis.crypto.randomUUID(),
        method: notification.method,
        params: notification.params,
        timestamp: Date.now(),
        read: false,
      });
    },
  });

  const onUpdateRef = useRef(onUpdate);
  const prevConnectionRef = useRef<MCPConnection | null>(null);

  // Keep ref up to date
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  // Create a stable connection object
  // Only update when data actually changes
  useEffect(() => {
    // Use queueMicrotask to defer state updates and avoid React warnings
    // about updating one component while rendering another
    if (typeof queueMicrotask !== "undefined") {
      queueMicrotask(() => {
        // Debug: Log serverInfo to console
        if (mcpHook.state === "ready" && mcpHook.serverInfo) {
          console.log(
            "[McpContext] Server info available:",
            mcpHook.serverInfo
          );
        }

        const unreadCount = notifications.filter((n) => !n.read).length;

        const connection: MCPConnection = {
          id: connectionId,
          url,
          name: mcpHook.serverInfo?.name || name, // Use server-provided name if available
          state: mcpHook.state,
          tools: mcpHook.tools,
          resources: mcpHook.resources,
          prompts: mcpHook.prompts,
          error: mcpHook.error ?? null,
          authUrl: mcpHook.authUrl ?? null,
          customHeaders,
          transportType,
          proxyConfig,
          serverInfo: mcpHook.serverInfo,
          capabilities: mcpHook.capabilities,
          notifications,
          unreadNotificationCount: unreadCount,
          markNotificationRead,
          markAllNotificationsRead,
          clearNotifications,
          callTool: mcpHook.callTool,
          readResource: mcpHook.readResource,
          listPrompts: mcpHook.listPrompts,
          getPrompt: mcpHook.getPrompt,
          authenticate: mcpHook.authenticate,
          retry: mcpHook.retry,
          clearStorage: mcpHook.clearStorage,
          disconnect: mcpHook.disconnect,
          client: mcpHook.client,
        };

        // Only update if something actually changed
        const prev = prevConnectionRef.current;
        if (
          !prev ||
          prev.state !== connection.state ||
          prev.error !== connection.error ||
          prev.authUrl !== connection.authUrl ||
          prev.name !== connection.name ||
          prev.tools.length !== connection.tools.length ||
          prev.resources.length !== connection.resources.length ||
          prev.prompts.length !== connection.prompts.length ||
          prev.serverInfo !== connection.serverInfo ||
          prev.capabilities !== connection.capabilities ||
          prev.notifications.length !== connection.notifications.length ||
          prev.unreadNotificationCount !== connection.unreadNotificationCount ||
          !prev.client
        ) {
          prevConnectionRef.current = connection;
          onUpdateRef.current(connection);
        }
      });
    } else {
      // Fallback for environments without queueMicrotask
      const unreadCount = notifications.filter((n) => !n.read).length;

      const connection: MCPConnection = {
        id: connectionId,
        url,
        name: mcpHook.serverInfo?.name || name, // Use server-provided name if available
        state: mcpHook.state,
        tools: mcpHook.tools,
        resources: mcpHook.resources,
        prompts: mcpHook.prompts,
        error: mcpHook.error ?? null,
        authUrl: mcpHook.authUrl ?? null,
        customHeaders,
        transportType,
        proxyConfig,
        serverInfo: mcpHook.serverInfo,
        capabilities: mcpHook.capabilities,
        notifications,
        unreadNotificationCount: unreadCount,
        markNotificationRead,
        markAllNotificationsRead,
        clearNotifications,
        callTool: mcpHook.callTool,
        readResource: mcpHook.readResource,
        listPrompts: mcpHook.listPrompts,
        getPrompt: mcpHook.getPrompt,
        authenticate: mcpHook.authenticate,
        retry: mcpHook.retry,
        clearStorage: mcpHook.clearStorage,
        disconnect: mcpHook.disconnect,
        client: mcpHook.client,
      };

      // Only update if something actually changed
      const prev = prevConnectionRef.current;
      if (
        !prev ||
        prev.state !== connection.state ||
        prev.error !== connection.error ||
        prev.authUrl !== connection.authUrl ||
        prev.name !== connection.name ||
        prev.tools.length !== connection.tools.length ||
        prev.resources.length !== connection.resources.length ||
        prev.prompts.length !== connection.prompts.length ||
        prev.serverInfo !== connection.serverInfo ||
        prev.capabilities !== connection.capabilities ||
        prev.notifications.length !== connection.notifications.length ||
        prev.unreadNotificationCount !== connection.unreadNotificationCount ||
        !prev.client
      ) {
        prevConnectionRef.current = connection;
        onUpdateRef.current(connection);
      }
    }
  }, [
    url,
    name,
    transportType,
    proxyConfig,
    customHeaders, // Added to dependency array
    connectionId,
    mcpHook.state,
    mcpHook.tools,
    mcpHook.resources,
    mcpHook.prompts,
    mcpHook.error,
    mcpHook.authUrl,
    mcpHook.serverInfo,
    mcpHook.capabilities,
    mcpHook.client,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
    // Stable functions don't strictly need to be here but good practice
    mcpHook.callTool,
    mcpHook.readResource,
    mcpHook.listPrompts,
    mcpHook.getPrompt,
    mcpHook.authenticate,
    mcpHook.retry,
    mcpHook.clearStorage,
  ]);

  return null;
}

export function McpProvider({ children }: { children: ReactNode }) {
  // Load initial connections from localStorage
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [autoConnect, setAutoConnect] = useState(true);

  // Store configs separately to persist across reloads
  // This mirrors the connections state but contains only config data
  const [connectionConfigs, setConnectionConfigs] = useState<
    Array<{
      id: string;
      url: string;
      name: string;
      proxyConfig?: {
        proxyAddress?: string;
        customHeaders?: Record<string, string>;
      };
      transportType?: "http" | "sse";
    }>
  >([]);

  // Initialize from localStorage
  useEffect(() => {
    try {
      const savedConfigs = localStorage.getItem("mcp-inspector-connections");
      if (savedConfigs) {
        const parsed = JSON.parse(savedConfigs);
        if (Array.isArray(parsed)) {
          setConnectionConfigs(parsed);
          // Initialize connections with loading state
          setConnections(
            parsed.map((config) => ({
              id: config.id || config.url,
              url: config.url,
              name: config.name || "MCP Server",
              state: "discovering",
              tools: [],
              resources: [],
              prompts: [],
              error: null,
              authUrl: null,
              customHeaders: config.proxyConfig?.customHeaders,
              transportType: config.transportType,
              proxyConfig: config.proxyConfig,
              notifications: [],
              unreadNotificationCount: 0,
              markNotificationRead: () => {},
              markAllNotificationsRead: () => {},
              clearNotifications: () => {},
              callTool: async () => {},
              readResource: async () => {},
              listPrompts: async () => {},
              getPrompt: async () => {},
              authenticate: () => {},
              retry: () => {},
              clearStorage: () => {},
              disconnect: () => {},
              client: null,
            }))
          );
        }
      }

      const savedAutoConnect = localStorage.getItem(
        "mcp-inspector-auto-connect"
      );
      if (savedAutoConnect !== null) {
        setAutoConnect(savedAutoConnect === "true");
      }
    } catch (e) {
      console.error("Failed to load connections from localStorage:", e);
    } finally {
      setConfigLoaded(true);
    }
  }, []);

  // Save to localStorage whenever configs change
  useEffect(() => {
    if (!configLoaded) return;
    localStorage.setItem(
      "mcp-inspector-connections",
      JSON.stringify(connectionConfigs)
    );
  }, [connectionConfigs, configLoaded]);

  useEffect(() => {
    if (!configLoaded) return;
    localStorage.setItem("mcp-inspector-auto-connect", String(autoConnect));
  }, [autoConnect, configLoaded]);

  const addConnection = useCallback(
    (
      url: string,
      name?: string,
      proxyConfig?: {
        proxyAddress?: string;
        customHeaders?: Record<string, string>;
      },
      transportType?: "http" | "sse"
    ) => {
      // Check if connection already exists in configs
      const existingConfig = connectionConfigs.find((c) => c.url === url);
      const existingConnection = connections.find((c) => c.url === url);

      // If connection exists in both configs and connections
      if (existingConfig && existingConnection) {
        // Check if we're trying to update the proxy config (for autoConnect retry scenarios)
        const proxyConfigChanged =
          JSON.stringify(existingConfig.proxyConfig) !==
          JSON.stringify(proxyConfig);

        if (proxyConfigChanged && proxyConfig) {
          // Remove the old connection completely
          setConnectionConfigs((prev) => prev.filter((c) => c.url !== url));
          setConnections((prev) => prev.filter((c) => c.url !== url));

          // Use setTimeout to ensure state updates complete before re-adding
          setTimeout(() => {
            const newConfig = {
              id: url,
              url,
              name: name || existingConfig.name || "MCP Server",
              proxyConfig,
              transportType: transportType || existingConfig.transportType,
            };

            setConnectionConfigs((prev) => [...prev, newConfig]);

            setConnections((prev) => [
              ...prev,
              {
                id: url,
                url,
                name: name || existingConfig.name || "MCP Server",
                state: "connecting",
                tools: [],
                resources: [],
                prompts: [],
                error: null,
                authUrl: null,
                customHeaders: proxyConfig?.customHeaders,
                transportType: transportType || existingConfig.transportType,
                proxyConfig,
                notifications: [],
                unreadNotificationCount: 0,
                markNotificationRead: () => {},
                markAllNotificationsRead: () => {},
                clearNotifications: () => {},
                callTool: async () => {},
                readResource: async () => {},
                listPrompts: async () => {},
                getPrompt: async () => {},
                authenticate: () => {},
                retry: () => {},
                clearStorage: () => {},
                disconnect: () => {},
                client: null,
              },
            ]);
          }, 10);
          return;
        }

        return;
      }

      // If connection exists in configs but not in connections, add it to connections
      // Also update the config if new parameters are provided (for autoConnect retry scenarios)
      if (existingConfig && !existingConnection) {
        // Update config if new proxy or transport settings are provided
        if (proxyConfig || transportType) {
          setConnectionConfigs((prev) =>
            prev.map((c) =>
              c.url === url
                ? {
                    ...c,
                    proxyConfig: proxyConfig || c.proxyConfig,
                    transportType: transportType || c.transportType,
                    name: name || c.name,
                  }
                : c
            )
          );
        }

        setConnections((prev) => [
          ...prev,
          {
            id: existingConfig.id || url,
            url,
            name: name || existingConfig.name || "MCP Server",
            state: "connecting",
            tools: [],
            resources: [],
            prompts: [],
            error: null,
            authUrl: null,
            customHeaders:
              proxyConfig?.customHeaders ||
              existingConfig.proxyConfig?.customHeaders,
            transportType: transportType || existingConfig.transportType,
            proxyConfig: proxyConfig || existingConfig.proxyConfig,
            notifications: [],
            unreadNotificationCount: 0,
            markNotificationRead: () => {},
            markAllNotificationsRead: () => {},
            clearNotifications: () => {},
            callTool: async () => {},
            readResource: async () => {},
            listPrompts: async () => {},
            getPrompt: async () => {},
            authenticate: () => {},
            retry: () => {},
            clearStorage: () => {},
            disconnect: () => {},
            client: null,
          },
        ]);
        return;
      }

      // New connection - add to both configs and connections
      const newConfig = {
        id: url,
        url,
        name: name || "MCP Server",
        proxyConfig,
        transportType,
      };

      setConnectionConfigs((prev) => [...prev, newConfig]);

      // Optimistically add connection
      setConnections((prev) => [
        ...prev,
        {
          id: url,
          url,
          name: name || "MCP Server",
          state: "connecting",
          tools: [],
          resources: [],
          prompts: [],
          error: null,
          authUrl: null,
          customHeaders: proxyConfig?.customHeaders,
          transportType,
          proxyConfig,
          notifications: [],
          unreadNotificationCount: 0,
          markNotificationRead: () => {},
          markAllNotificationsRead: () => {},
          clearNotifications: () => {},
          callTool: async () => {},
          readResource: async () => {},
          listPrompts: async () => {},
          getPrompt: async () => {},
          authenticate: () => {},
          retry: () => {},
          clearStorage: () => {},
          disconnect: () => {},
          client: null,
        },
      ]);
    },
    [connectionConfigs, connections]
  );

  const removeConnection = useCallback(
    (id: string) => {
      // Find the connection and properly clean it up
      const connection = connections.find((c) => c.id === id);
      if (connection) {
        console.log(`[McpContext] Cleaning up connection: ${id}`);

        // First disconnect from the server (closes MCP session)
        if (connection.disconnect) {
          console.log(`[McpContext] Disconnecting from server: ${id}`);
          connection.disconnect();
        }

        // Then clear OAuth storage (tokens, client info, etc.)
        if (connection.clearStorage) {
          console.log(
            `[McpContext] Clearing OAuth storage for connection: ${id}`
          );
          connection.clearStorage();
        }
      }

      setConnectionConfigs((prev) => prev.filter((c) => c.id !== id));
      setConnections((prev) => prev.filter((c) => c.id !== id));

      // Also remove from localStorage immediately
      const currentConfigs = localStorage.getItem("mcp-inspector-connections");
      if (currentConfigs) {
        try {
          const parsed = JSON.parse(currentConfigs);
          const filtered = parsed.filter((c: any) => (c.id || c.url) !== id);
          localStorage.setItem(
            "mcp-inspector-connections",
            JSON.stringify(filtered)
          );
        } catch (e) {
          console.error("Failed to update localStorage on remove:", e);
        }
      }

      // Track removal
      Telemetry.getInstance().capture(
        new MCPServerRemovedEvent({ serverId: id })
      );
    },
    [connections]
  );

  const updateConnectionConfig = useCallback(
    (
      id: string,
      config: {
        name?: string;
        proxyConfig?: {
          proxyAddress?: string;
          customHeaders?: Record<string, string>;
        };
        transportType?: "http" | "sse";
      }
    ) => {
      setConnectionConfigs((prev) =>
        prev.map((c) => {
          if (c.id === id || c.url === id) {
            return { ...c, ...config };
          }
          return c;
        })
      );

      // Also update active connection state to trigger reconnection with new settings
      setConnections((prev) =>
        prev.map((c) => {
          if (c.id === id) {
            return {
              ...c,
              ...config,
              // Reset state to trigger reconnection in the wrapper
              // state: "connecting",
            };
          }
          return c;
        })
      );
    },
    []
  );

  const handleConnectionUpdate = useCallback(
    (updatedConnection: MCPConnection) => {
      setConnections((prev) => {
        const index = prev.findIndex((c) => c.id === updatedConnection.id);
        if (index === -1) return prev;

        // Check if actually changed to avoid loops
        const current = prev[index];
        if (
          current.state === updatedConnection.state &&
          current.tools === updatedConnection.tools &&
          current.resources === updatedConnection.resources &&
          current.prompts === updatedConnection.prompts &&
          current.error === updatedConnection.error &&
          current.serverInfo === updatedConnection.serverInfo &&
          current.client === updatedConnection.client &&
          current.notifications === updatedConnection.notifications &&
          current.unreadNotificationCount ===
            updatedConnection.unreadNotificationCount
        ) {
          return prev;
        }

        const newConnections = [...prev];
        newConnections[index] = updatedConnection;
        return newConnections;
      });
    },
    []
  );

  const connectServer = useCallback((id: string) => {
    // This is a no-op now as connections are auto-managed by the wrapper
    // But we could implement manual retry here if needed
    console.log("Connect requested for:", id);
  }, []);

  const disconnectServer = useCallback((id: string) => {
    // For now, removing the connection is the best way to disconnect
    // Logic could be added to pause the connection instead
    console.log("Disconnect requested for:", id);
  }, []);

  const contextValue = useMemo(
    () => ({
      connections,
      addConnection,
      removeConnection,
      updateConnectionConfig,
      autoConnect,
      setAutoConnect,
      connectServer,
      disconnectServer,
      configLoaded,
    }),
    [
      connections,
      addConnection,
      removeConnection,
      updateConnectionConfig,
      autoConnect,
      connectServer,
      disconnectServer,
      configLoaded,
    ]
  );

  return (
    <McpContext.Provider value={contextValue}>
      {children}
      {/* Render a wrapper for each configured connection */}
      {configLoaded &&
        autoConnect &&
        connectionConfigs.map((config) => {
          const wrapperKey = `${config.id || config.url}-${config.proxyConfig?.proxyAddress ? "proxy" : "direct"}`;
          console.warn(
            "[McpContext] Rendering McpConnectionWrapper with key:",
            wrapperKey,
            "proxyConfig:",
            config.proxyConfig
          );
          return (
            <McpConnectionWrapper
              key={wrapperKey}
              url={config.url}
              name={config.name}
              proxyConfig={config.proxyConfig}
              transportType={config.transportType}
              connectionId={config.id || config.url}
              onUpdate={handleConnectionUpdate}
              onRemove={() => removeConnection(config.id || config.url)}
            />
          );
        })}
    </McpContext.Provider>
  );
}
