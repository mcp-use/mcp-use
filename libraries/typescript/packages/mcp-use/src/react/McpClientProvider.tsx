import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  Notification,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { StorageProvider } from "./storage/StorageProvider.js";
import type { UseMcpOptions, UseMcpResult } from "./types.js";
import { useMcp } from "./useMcp.js";

// ===== Types =====

/**
 * MCP notification received from a server
 */
export interface McpNotification {
  id: string;
  method: string;
  params?: Record<string, unknown>;
  timestamp: number;
  read: boolean;
}

/**
 * Pending sampling request from a server
 */
export interface PendingSamplingRequest {
  id: string;
  request: {
    method: "sampling/createMessage";
    params: CreateMessageRequest["params"];
  };
  timestamp: number;
  serverName: string;
}

/**
 * Pending elicitation request from a server
 */
export interface PendingElicitationRequest {
  id: string;
  request: ElicitRequestFormParams | ElicitRequestURLParams;
  timestamp: number;
  serverName: string;
}

/**
 * Enhanced MCP server connection with notification, sampling, and elicitation management
 */
export interface McpServer extends UseMcpResult {
  id: string;
  url: string;
  name: string; // User-provided name (fallback if serverInfo.name is not available)
  // serverInfo.name comes from UseMcpResult (set by the actual MCP server)
  // Notification management
  notifications: McpNotification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  // Sampling management
  pendingSamplingRequests: PendingSamplingRequest[];
  approveSampling: (requestId: string, result: CreateMessageResult) => void;
  rejectSampling: (requestId: string, error?: string) => void;
  // Elicitation management
  pendingElicitationRequests: PendingElicitationRequest[];
  approveElicitation: (requestId: string, result: ElicitResult) => void;
  rejectElicitation: (requestId: string, error?: string) => void;
}

/**
 * Options for adding a server to the provider
 * Extends UseMcpOptions but handles callbacks internally
 */
export interface McpServerOptions extends Omit<
  UseMcpOptions,
  "samplingCallback" | "onElicitation" | "onNotification"
> {
  name?: string;
  // Optional callbacks for app-specific handling (e.g., toasts)
  onSamplingRequest?: (request: PendingSamplingRequest) => void;
  onElicitationRequest?: (request: PendingElicitationRequest) => void;
  onNotificationReceived?: (notification: McpNotification) => void;
}

/**
 * Context value for multi-server management
 */
export interface McpClientContextType {
  servers: McpServer[];
  addServer: (id: string, options: McpServerOptions) => void;
  removeServer: (id: string) => void;
  getServer: (id: string) => McpServer | undefined;
  /** Whether storage has finished loading (true if no storage provider) */
  storageLoaded: boolean;
}

// ===== Context =====

const McpClientContext = createContext<McpClientContextType | null>(null);

// ===== Constants =====

const MAX_NOTIFICATIONS = 500;

// ===== Internal Components =====

interface ServerConfig {
  id: string;
  options: McpServerOptions;
}

interface McpServerWrapperProps {
  id: string;
  options: McpServerOptions;
  onUpdate: (server: McpServer) => void;
  rpcWrapTransport?: (transport: any, serverId: string) => any;
  onGlobalSamplingRequest?: (
    request: PendingSamplingRequest,
    serverId: string,
    serverName: string,
    approve: (requestId: string, result: CreateMessageResult) => void,
    reject: (requestId: string, error?: string) => void
  ) => void;
  onGlobalElicitationRequest?: (
    request: PendingElicitationRequest,
    serverId: string,
    serverName: string,
    approve: (requestId: string, result: ElicitResult) => void,
    reject: (requestId: string, error?: string) => void
  ) => void;
}

/**
 * Wraps a single MCP connection (useMcp) and manages per-server notifications,
 * pending sampling and elicitation requests, and exposes state updates to a parent.
 *
 * This internal component wires the MCP hook callbacks to local queues/handlers,
 * applies optional transport wrappers (e.g., RPC logging), maintains notification
 * history with unread tracking, and calls `onUpdate` with an enriched `McpServer`
 * view when meaningful server state changes occur.
 *
 * @param id - Unique identifier for the server instance
 * @param options - Configuration passed to the underlying MCP hook; callbacks for sampling, elicitation, and notifications are handled by this wrapper and therefore excluded from the forwarded options
 * @param onUpdate - Callback invoked with the current `McpServer` representation when the server's meaningful state changes
 * @param rpcWrapTransport - Optional transport wrapper (typically for RPC logging) that will be composed with the user's `wrapTransport` if provided
 * @param onGlobalSamplingRequest - Optional global handler invoked whenever a sampling request is enqueued; receives the request, server id/name, and approve/reject handlers
 * @param onGlobalElicitationRequest - Optional global handler invoked whenever an elicitation request is enqueued; receives the request, server id/name, and approve/reject handlers
 */
function McpServerWrapper({
  id,
  options,
  onUpdate,
  rpcWrapTransport,
  onGlobalSamplingRequest,
  onGlobalElicitationRequest,
}: McpServerWrapperProps) {
  // Extract callback options (these don't need to be passed to useMcp)
  const {
    name,
    onSamplingRequest,
    onElicitationRequest,
    onNotificationReceived,
    wrapTransport: optionsWrapTransport,
  } = options;

  // Memoize the options passed to useMcp to prevent render loops
  // The spread operator creates new objects every render, which causes
  // useMcp's callbacks (connect, retry) to be recreated, triggering the
  // autoRetry effect repeatedly
  const mcpOptions = useMemo(() => {
    const {
      name: _name,
      onSamplingRequest: _onSamplingRequest,
      onElicitationRequest: _onElicitationRequest,
      onNotificationReceived: _onNotificationReceived,
      wrapTransport: _wrapTransport,
      ...rest
    } = options;
    return rest;
  }, [options]);

  // Merge user's wrapTransport with RPC logging wrapper
  const combinedWrapTransport = useMemo(() => {
    if (!rpcWrapTransport && !optionsWrapTransport) return undefined;

    return (transport: any) => {
      let wrapped = transport;

      // Apply RPC logging first if enabled
      if (rpcWrapTransport) {
        wrapped = rpcWrapTransport(wrapped, id);
      }

      // Then apply user's wrapper if provided
      if (optionsWrapTransport) {
        wrapped = optionsWrapTransport(wrapped, id);
      }

      return wrapped;
    };
  }, [rpcWrapTransport, optionsWrapTransport, id]);

  // Notification state
  const [notifications, setNotifications] = useState<McpNotification[]>([]);

  // Sampling state
  const [pendingSamplingRequests, setPendingSamplingRequests] = useState<
    Array<
      PendingSamplingRequest & {
        resolve: (result: CreateMessageResult) => void;
        reject: (error: Error) => void;
      }
    >
  >([]);
  const samplingIdCounter = useRef(0);

  // Elicitation state
  const [pendingElicitationRequests, setPendingElicitationRequests] = useState<
    Array<
      PendingElicitationRequest & {
        resolve: (result: ElicitResult) => void;
        reject: (error: Error) => void;
      }
    >
  >([]);
  const elicitationIdCounter = useRef(0);

  // Notification handlers
  const markNotificationRead = useCallback((notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Notification callback for useMcp
  const handleNotification = useCallback(
    (notification: Notification) => {
      const mcpNotification: McpNotification = {
        id:
          globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        method: notification.method,
        params: notification.params as Record<string, unknown> | undefined,
        timestamp: Date.now(),
        read: false,
      };

      setNotifications((prev) => {
        const updated = [mcpNotification, ...prev];
        // Prune oldest if we exceed max
        if (updated.length > MAX_NOTIFICATIONS) {
          return updated.slice(0, MAX_NOTIFICATIONS);
        }
        return updated;
      });

      // Call app-specific handler if provided
      onNotificationReceived?.(mcpNotification);
    },
    [onNotificationReceived]
  );

  // Sampling handlers
  const approveSampling = useCallback(
    (requestId: string, result: CreateMessageResult) => {
      setPendingSamplingRequests((prev) => {
        const request = prev.find((r) => r.id === requestId);
        if (request) {
          request.resolve(result);
          return prev.filter((r) => r.id !== requestId);
        }
        return prev;
      });
    },
    []
  );

  const rejectSampling = useCallback((requestId: string, error?: string) => {
    setPendingSamplingRequests((prev) => {
      const request = prev.find((r) => r.id === requestId);
      if (request) {
        request.reject(new Error(error || "User rejected sampling request"));
        return prev.filter((r) => r.id !== requestId);
      }
      return prev;
    });
  }, []);

  // Sampling callback for useMcp
  const samplingCallback = useCallback(
    async (params: CreateMessageRequest["params"]) => {
      return new Promise<CreateMessageResult>((resolve, reject) => {
        const requestId = `sampling-${samplingIdCounter.current++}`;
        const request: PendingSamplingRequest = {
          id: requestId,
          request: { method: "sampling/createMessage", params },
          timestamp: Date.now(),
          serverName: name || id,
        };

        const newRequest = {
          ...request,
          resolve,
          reject,
        };

        setPendingSamplingRequests((prev) => [...prev, newRequest]);

        // Call app-specific handler if provided
        onSamplingRequest?.(request);

        // Call global handler if provided
        onGlobalSamplingRequest?.(
          request,
          id,
          name || id,
          approveSampling,
          rejectSampling
        );
      });
    },
    [
      id,
      name,
      onSamplingRequest,
      onGlobalSamplingRequest,
      approveSampling,
      rejectSampling,
    ]
  );

  // Elicitation handlers
  const approveElicitation = useCallback(
    (requestId: string, result: ElicitResult) => {
      setPendingElicitationRequests((prev) => {
        const request = prev.find((r) => r.id === requestId);
        if (request) {
          request.resolve(result);
          return prev.filter((r) => r.id !== requestId);
        }
        return prev;
      });
    },
    []
  );

  const rejectElicitation = useCallback((requestId: string, error?: string) => {
    setPendingElicitationRequests((prev) => {
      const request = prev.find((r) => r.id === requestId);
      if (request) {
        request.reject(new Error(error || "User rejected elicitation request"));
        return prev.filter((r) => r.id !== requestId);
      }
      return prev;
    });
  }, []);

  // Elicitation callback for useMcp
  const elicitationCallback = useCallback(
    async (params: ElicitRequestFormParams | ElicitRequestURLParams) => {
      return new Promise<ElicitResult>((resolve, reject) => {
        const requestId = `elicitation-${elicitationIdCounter.current++}`;
        const request: PendingElicitationRequest = {
          id: requestId,
          request: params,
          timestamp: Date.now(),
          serverName: name || id,
        };

        const newRequest = {
          ...request,
          resolve,
          reject,
        };

        setPendingElicitationRequests((prev) => [...prev, newRequest]);

        // Call app-specific handler if provided
        onElicitationRequest?.(request);

        // Call global handler if provided
        onGlobalElicitationRequest?.(
          request,
          id,
          name || id,
          approveElicitation,
          rejectElicitation
        );
      });
    },
    [
      id,
      name,
      onElicitationRequest,
      onGlobalElicitationRequest,
      approveElicitation,
      rejectElicitation,
    ]
  );

  // Use the core useMcp hook with our callbacks
  const mcp = useMcp({
    ...mcpOptions,
    onNotification: handleNotification,
    samplingCallback,
    onElicitation: elicitationCallback,
    wrapTransport: combinedWrapTransport,
  });

  // Memoize public-facing sampling/elicitation requests (without resolve/reject)
  const publicSamplingRequests = useMemo(
    () =>
      pendingSamplingRequests.map((r) => ({
        id: r.id,
        request: r.request,
        timestamp: r.timestamp,
        serverName: r.serverName,
      })),
    [pendingSamplingRequests]
  );

  const publicElicitationRequests = useMemo(
    () =>
      pendingElicitationRequests.map((r) => ({
        id: r.id,
        request: r.request,
        timestamp: r.timestamp,
        serverName: r.serverName,
      })),
    [pendingElicitationRequests]
  );

  // Calculate unread count
  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  // Update parent when state changes
  const onUpdateRef = useRef(onUpdate);
  const prevServerRef = useRef<McpServer | null>(null);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    const server: McpServer = {
      ...mcp,
      id,
      url: options.url || "",
      name: name || id,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotifications,
      pendingSamplingRequests: publicSamplingRequests,
      approveSampling,
      rejectSampling,
      pendingElicitationRequests: publicElicitationRequests,
      approveElicitation,
      rejectElicitation,
    };

    // Only update if something actually changed
    const prevServer = prevServerRef.current;
    if (
      !prevServer ||
      prevServer.state !== server.state ||
      prevServer.error !== server.error ||
      prevServer.authUrl !== server.authUrl ||
      prevServer.tools.length !== server.tools.length ||
      prevServer.resources.length !== server.resources.length ||
      prevServer.prompts.length !== server.prompts.length ||
      prevServer.serverInfo !== server.serverInfo ||
      prevServer.capabilities !== server.capabilities ||
      prevServer.notifications.length !== server.notifications.length ||
      prevServer.unreadNotificationCount !== server.unreadNotificationCount ||
      prevServer.pendingSamplingRequests.length !==
        server.pendingSamplingRequests.length ||
      prevServer.pendingElicitationRequests.length !==
        server.pendingElicitationRequests.length ||
      !prevServer.client
    ) {
      prevServerRef.current = server;
      onUpdateRef.current(server);
    }
  }, [
    id,
    name,
    options.url,
    // Primitive values that indicate meaningful state changes
    mcp.state,
    mcp.error,
    mcp.authUrl,
    // Use array LENGTHS instead of array references to avoid triggering on reference changes
    mcp.tools.length,
    mcp.resources.length,
    mcp.resourceTemplates.length,
    mcp.prompts.length,
    // Objects excluded - manual comparison handles serverInfo/capabilities changes
    // Functions excluded - they're stable via useCallback in useMcp
    // mcp.log excluded - log changes shouldn't trigger provider updates
    // mcp.client excluded - client reference stability handled by manual check
    notifications.length,
    unreadNotificationCount,
    publicSamplingRequests.length,
    publicElicitationRequests.length,
    // Callback functions are stable via useCallback
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
    approveSampling,
    rejectSampling,
    approveElicitation,
    rejectElicitation,
  ]);

  return null;
}

// ===== Provider =====

/**
 * Props for McpClientProvider
 */
export interface McpClientProviderProps {
  children: ReactNode;

  /**
   * Initial servers configuration (like Python MCPClient.from_dict)
   * Servers defined here will be auto-connected on mount
   */
  mcpServers?: Record<string, McpServerOptions>;

  /**
   * Storage provider for persisting server configurations
   * When provided, automatically loads servers on mount and saves on changes
   */
  storageProvider?: StorageProvider;

  /**
   * Enable RPC logging for debugging (browser only)
   * Logs all MCP protocol messages to console
   */
  enableRpcLogging?: boolean;

  /**
   * Callback when a server is added
   */
  onServerAdded?: (id: string, server: McpServer) => void;

  /**
   * Callback when a server is removed
   */
  onServerRemoved?: (id: string) => void;

  /**
   * Callback when a server's state changes
   */
  onServerStateChange?: (id: string, state: McpServer["state"]) => void;

  /**
   * Callback when a sampling request is received from any server
   * @param request The sampling request details
   * @param serverId The ID of the server that sent the request
   * @param serverName The name of the server
   * @param approve Function to approve the request
   * @param reject Function to reject the request
   */
  onSamplingRequest?: (
    request: PendingSamplingRequest,
    serverId: string,
    serverName: string,
    approve: (requestId: string, result: CreateMessageResult) => void,
    reject: (requestId: string, error?: string) => void
  ) => void;

  /**
   * Callback when an elicitation request is received from any server
   * @param request The elicitation request details
   * @param serverId The ID of the server that sent the request
   * @param serverName The name of the server
   * @param approve Function to approve the request
   * @param reject Function to reject the request
   */
  onElicitationRequest?: (
    request: PendingElicitationRequest,
    serverId: string,
    serverName: string,
    approve: (requestId: string, result: ElicitResult) => void,
    reject: (requestId: string, error?: string) => void
  ) => void;
}

/**
 * Provider for managing multiple MCP server connections
 *
 * Provides a context for adding/removing servers and accessing their state.
 * Each server maintains its own connection, notification history, and
 * pending sampling/elicitation requests.
 *
 * Supports:
 * - Initial server configuration via `mcpServers` prop
 * - Persistence via pluggable `storageProvider`
 * - RPC logging for debugging
 * - Lifecycle callbacks for state changes
 *
 * @example
 * ```tsx
 * // With initial servers
 * <McpClientProvider
 *   mcpServers={{
 *     linear: { url: "https://mcp.linear.app/sse" },
 *     github: { url: "https://mcp.github.com/mcp" }
 *   }}
 * >
 *   <MyApp />
 * </McpClientProvider>
 *
 * // With persistence
 * <McpClientProvider
 *   storageProvider={new LocalStorageProvider("my-servers")}
 *   enableRpcLogging={true}
 * >
 *   <MyApp />
 * </McpClientProvider>
 * ```
 */
export function McpClientProvider({
  children,
  mcpServers,
  storageProvider,
  enableRpcLogging = false,
  onServerAdded,
  onServerRemoved,
  onServerStateChange,
  onSamplingRequest,
  onElicitationRequest,
}: McpClientProviderProps) {
  const [serverConfigs, setServerConfigs] = useState<ServerConfig[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);

  // Load RPC transport wrapper if enabled
  const [rpcWrapTransport, setRpcWrapTransport] = useState<
    ((transport: any, serverId: string) => any) | undefined
  >(undefined);
  const [rpcLoggingReady, setRpcLoggingReady] = useState(false);

  useEffect(() => {
    if (!enableRpcLogging || typeof window === "undefined") {
      setRpcWrapTransport(undefined);
      setRpcLoggingReady(true); // RPC logging not needed, mark as ready
      return;
    }

    // Load the RPC logger dynamically
    import("./rpc-logger.js")
      .then((module) => {
        console.log("[McpClientProvider] RPC logger loaded");
        setRpcWrapTransport(() => module.wrapTransportForLogging);
        setRpcLoggingReady(true); // RPC logging loaded, mark as ready
      })
      .catch((err) => {
        console.error("[McpClientProvider] Failed to load RPC logger:", err);
        setRpcWrapTransport(undefined);
        setRpcLoggingReady(true); // Failed to load, but still mark as ready to unblock
      });
  }, [enableRpcLogging]);

  // Load servers from storage on mount
  // Wait for RPC logging to be ready before loading servers
  useEffect(() => {
    if (!rpcLoggingReady) {
      console.log(
        "[McpClientProvider] Waiting for RPC logging to be ready before loading servers"
      );
      return;
    }

    const loadServers = async () => {
      console.log(
        "[McpClientProvider] Loading servers, storageProvider:",
        !!storageProvider,
        "mcpServers:",
        mcpServers
      );

      if (!storageProvider) {
        // No storage provider - just load from mcpServers prop if provided
        if (mcpServers) {
          const configs = Object.entries(mcpServers).map(([id, options]) => ({
            id,
            options,
          }));
          console.log(
            "[McpClientProvider] Loaded from mcpServers prop:",
            configs.length
          );
          setServerConfigs(configs);
        }
        setStorageLoaded(true);
        return;
      }

      // Has storage provider - load from storage and merge with mcpServers
      try {
        const storedServers = await Promise.resolve(
          storageProvider.getServers()
        );

        console.log(
          "[McpClientProvider] Loaded from storage:",
          Object.keys(storedServers).length
        );

        // Merge with initial mcpServers (mcpServers takes precedence)
        const mergedServers = { ...storedServers, ...mcpServers };

        // Convert to ServerConfig array
        const configs = Object.entries(mergedServers).map(([id, options]) => ({
          id,
          options,
        }));

        console.log(
          "[McpClientProvider] Total servers after merge:",
          configs.length
        );
        setServerConfigs(configs);
        setStorageLoaded(true);
      } catch (error) {
        console.error(
          "[McpClientProvider] Failed to load from storage:",
          error
        );
        // Fall back to mcpServers only
        if (mcpServers) {
          const configs = Object.entries(mcpServers).map(([id, options]) => ({
            id,
            options,
          }));
          setServerConfigs(configs);
        }
        setStorageLoaded(true);
      }
    };

    loadServers();
  }, [storageProvider, mcpServers, rpcLoggingReady]); // Run when storage provider, mcpServers, or RPC logging ready changes

  // Save servers to storage when they change
  useEffect(() => {
    if (!storageProvider || !storageLoaded) return;

    const saveServers = async () => {
      try {
        const serversToSave = serverConfigs.reduce(
          (acc, config) => {
            acc[config.id] = config.options;
            return acc;
          },
          {} as Record<string, McpServerOptions>
        );

        await Promise.resolve(storageProvider.setServers(serversToSave));
      } catch (error) {
        console.error("[McpClientProvider] Failed to save to storage:", error);
      }
    };

    saveServers();
  }, [serverConfigs, storageProvider, storageLoaded]);

  const handleServerUpdate = useCallback(
    (updatedServer: McpServer) => {
      setServers((prev) => {
        const index = prev.findIndex((s) => s.id === updatedServer.id);
        const isNewServer = index === -1;

        if (isNewServer) {
          // New server - call onServerAdded callback
          onServerAdded?.(updatedServer.id, updatedServer);
          return [...prev, updatedServer];
        }

        // Check if actually changed to avoid loops
        const current = prev[index];
        const stateChanged = current.state !== updatedServer.state;

        if (
          current.state === updatedServer.state &&
          current.tools === updatedServer.tools &&
          current.resources === updatedServer.resources &&
          current.prompts === updatedServer.prompts &&
          current.error === updatedServer.error &&
          current.serverInfo === updatedServer.serverInfo &&
          current.client === updatedServer.client &&
          current.notifications === updatedServer.notifications &&
          current.unreadNotificationCount ===
            updatedServer.unreadNotificationCount &&
          current.pendingSamplingRequests.length ===
            updatedServer.pendingSamplingRequests.length &&
          current.pendingElicitationRequests.length ===
            updatedServer.pendingElicitationRequests.length
        ) {
          return prev;
        }

        // State changed - call callback
        if (stateChanged) {
          onServerStateChange?.(updatedServer.id, updatedServer.state);
        }

        const newServers = [...prev];
        newServers[index] = updatedServer;
        return newServers;
      });
    },
    [onServerAdded, onServerStateChange]
  );

  const addServer = useCallback((id: string, options: McpServerOptions) => {
    console.log("[McpClientProvider] addServer called:", id, options);
    setServerConfigs((prev) => {
      // Check if already exists
      if (prev.find((s) => s.id === id)) {
        console.warn(
          `[McpClientProvider] Server with id "${id}" already exists`
        );
        return prev;
      }
      console.log("[McpClientProvider] Adding new server to configs:", id);
      return [...prev, { id, options }];
    });
  }, []);

  const removeServer = useCallback(
    (id: string) => {
      // Find and disconnect the server
      setServers((prev) => {
        const server = prev.find((s) => s.id === id);
        if (server?.disconnect) {
          server.disconnect();
        }
        if (server?.clearStorage) {
          server.clearStorage();
        }
        return prev.filter((s) => s.id !== id);
      });

      setServerConfigs((prev) => prev.filter((s) => s.id !== id));

      // Call callback
      onServerRemoved?.(id);
    },
    [onServerRemoved]
  );

  const getServer = useCallback(
    (id: string) => {
      return servers.find((s) => s.id === id);
    },
    [servers]
  );

  const contextValue = useMemo(
    () => ({
      servers,
      addServer,
      removeServer,
      getServer,
      storageLoaded,
    }),
    [servers, addServer, removeServer, getServer, storageLoaded]
  );

  return (
    <McpClientContext.Provider value={contextValue}>
      {children}
      {/* Render a wrapper for each configured server */}
      {serverConfigs.map((config) => (
        <McpServerWrapper
          key={config.id}
          id={config.id}
          options={config.options}
          onUpdate={handleServerUpdate}
          rpcWrapTransport={rpcWrapTransport}
          onGlobalSamplingRequest={onSamplingRequest}
          onGlobalElicitationRequest={onElicitationRequest}
        />
      ))}
    </McpClientContext.Provider>
  );
}

// ===== Hooks =====

/**
 * Hook to access the MCP client context
 *
 * Provides access to all servers and management functions.
 * Must be used within a McpClientProvider.
 *
 * @example
 * ```tsx
 * const { servers, addServer, removeServer } = useMcpClient();
 *
 * // Add a server
 * addServer("linear", { url: "https://mcp.linear.app/sse" });
 *
 * // Access servers
 * servers.forEach(server => {
 *   console.log(server.id, server.state);
 * });
 * ```
 */
export function useMcpClient(): McpClientContextType {
  const context = useContext(McpClientContext);
  if (!context) {
    throw new Error("useMcpClient must be used within a McpClientProvider");
  }
  return context;
}

/**
 * Retrieve the McpServer object for a given server id.
 *
 * @returns The `McpServer` for the provided `id`, or `undefined` if no matching server is registered.
 * @throws If called outside of a `McpClientProvider` (context not available).
 */
export function useMcpServer(id: string): McpServer | undefined {
  const { getServer } = useMcpClient();
  return getServer(id);
}