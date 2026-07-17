import type { ElicitResult, Transport } from "@modelcontextprotocol/client";
import type { SamplingCreateMessageResult } from "../core/config.js";
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
import { Logger } from "../utils/logging.js";
import type { StorageProvider } from "./storage.js";
import type {
  McpServer,
  McpServerConfig,
  PendingElicitationRequest,
  PendingSamplingRequest,
} from "./types.js";
import { pickPersistedServerConfig, toPersistedServerConfig } from "./types.js";
import { useMcp } from "./useMcp.js";
import { useMcpServerQueues } from "./useMcpServerQueues.js";

// Module-level logger for McpClientProvider & friends
const providerLogger = Logger.get("McpClientProvider");

// ===== Types =====

/**
 * Context value for multi-server management
 */
export interface McpClientContextType {
  servers: McpServer[];
  /** Idempotent — safe to call multiple times with the same id; duplicates are silently ignored. */
  addServer: (id: string, config: McpServerConfig) => void;
  /**
   * Remove a server from the provider.
   *
   * By default this only tears down the live connection and leaves persisted
   * OAuth credentials (tokens / client_info / PKCE verifier) intact, so routine
   * remove+add churn (config refetches, deployment-status flips, env-scoped
   * wrappers sharing a URL hash) does not silently log the user out.
   *
   * Pass `{ clearCredentials: true }` for an explicit logout / "forget this
   * server" action to also wipe the persisted OAuth storage.
   */
  removeServer: (
    id: string,
    opts?: { clearCredentials?: boolean }
  ) => Promise<void>;
  updateServerMetadata: (
    id: string,
    metadata: { name: string }
  ) => Promise<void>;
  updateServer: (
    id: string,
    options: Partial<McpServerConfig>
  ) => Promise<void>;
  getServer: (id: string) => McpServer | undefined;
  /** Whether storage has finished loading (true if no storage provider) */
  storageLoaded: boolean;
}

// ===== Context =====

const McpClientContext = createContext<McpClientContextType | null>(null);

// ===== Constants =====

function sameSerializedValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Compares the serializable provider-facing state for one MCP connection.
 *
 * The wrapper and provider both use this comparison so metadata-only updates
 * (including negotiated v1/v2 details) cannot be dropped at either boundary.
 */
function isSameMcpServer(left: McpServer, right: McpServer): boolean {
  return (
    left.id === right.id &&
    sameSerializedValue(
      pickPersistedServerConfig(left),
      pickPersistedServerConfig(right)
    ) &&
    left.name === right.name &&
    left.state === right.state &&
    left.error === right.error &&
    left.authUrl === right.authUrl &&
    sameSerializedValue(left.authTokens, right.authTokens) &&
    left.protocolEra === right.protocolEra &&
    left.protocolVersion === right.protocolVersion &&
    sameSerializedValue(left.serverInfo, right.serverInfo) &&
    sameSerializedValue(left.capabilities, right.capabilities) &&
    left.instructions === right.instructions &&
    sameSerializedValue(left.extensions, right.extensions) &&
    sameSerializedValue(left.tools, right.tools) &&
    sameSerializedValue(left.resources, right.resources) &&
    sameSerializedValue(left.resourceTemplates, right.resourceTemplates) &&
    sameSerializedValue(left.prompts, right.prompts) &&
    sameSerializedValue(left.notifications, right.notifications) &&
    left.unreadNotificationCount === right.unreadNotificationCount &&
    sameSerializedValue(
      left.pendingSamplingRequests,
      right.pendingSamplingRequests
    ) &&
    sameSerializedValue(
      left.pendingElicitationRequests,
      right.pendingElicitationRequests
    ) &&
    left.client === right.client
  );
}

interface ServerConfig {
  id: string;
  options: McpServerConfig;
}

interface McpServerWrapperProps {
  id: string;
  options: McpServerConfig;
  defaultCallbackUrl?: string;
  defaultOAuthProxyUrl?: string;
  defaultProxyConfig?: {
    proxyAddress?: string;
    headers?: Record<string, string>;
  };
  defaultAutoProxyFallback?:
    | boolean
    | {
        enabled?: boolean;
        proxyAddress?: string;
      };
  /** Default connection config merged under each server (per-server wins). */
  defaultServerConfig?: Partial<McpServerConfig>;
  clientInfo?: {
    name: string;
    title?: string;
    version: string;
    description?: string;
    icons?: Array<{
      src: string;
      mimeType?: string;
      sizes?: string[];
    }>;
    websiteUrl?: string;
    /**
     * Default capabilities advertised to all servers managed by this provider.
     * Per-server `clientOptions.capabilities` are merged on top, with per-server
     * values taking precedence. Stripped from the MCP `clientInfo` wire field.
     */
    capabilities?: Record<string, unknown>;
  };
  cachedMetadata?: import("./storage.js").CachedServerMetadata;
  onUpdate: (server: McpServer) => void;
  onUpdateConfig: (
    id: string,
    config: Partial<McpServerConfig>
  ) => Promise<void>;
  onUpdateDisplayName: (id: string, displayName: string) => Promise<void>;
  onReconnect: (id: string) => Promise<void>;
  rpcWrapTransport?: (transport: Transport, serverId: string) => Transport;
  onGlobalSamplingRequest?: (
    request: PendingSamplingRequest,
    serverId: string,
    serverName: string,
    approve: (requestId: string, result: SamplingCreateMessageResult) => void,
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
  defaultCallbackUrl,
  defaultOAuthProxyUrl,
  defaultProxyConfig,
  defaultAutoProxyFallback,
  clientInfo: providerClientInfo,
  cachedMetadata,
  onUpdate,
  onUpdateConfig,
  onUpdateDisplayName,
  onReconnect,
  rpcWrapTransport,
  onGlobalSamplingRequest,
  onGlobalElicitationRequest,
}: McpServerWrapperProps) {
  // Extract callback options (these don't need to be passed to useMcp)
  const {
    displayName,
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
      displayName: _displayName,
      onSamplingRequest: _onSamplingRequest,
      onElicitationRequest: _onElicitationRequest,
      onNotificationReceived: _onNotificationReceived,
      wrapTransport: _wrapTransport,
      ...rest
    } = options;

    // Merge defaults from provider with server-specific options
    // Server-specific options take precedence over defaults
    return {
      ...rest,
      // Use server-specific callbackUrl if provided, otherwise use provider default
      callbackUrl: rest.callbackUrl || defaultCallbackUrl,
      oauthProxyUrl: rest.oauthProxyUrl || defaultOAuthProxyUrl,
      // Use server-specific proxyConfig if provided, otherwise use default
      proxyConfig: rest.proxyConfig || defaultProxyConfig,
      // Use server-specific autoProxyFallback if provided, otherwise use default
      autoProxyFallback:
        rest.autoProxyFallback !== undefined
          ? rest.autoProxyFallback
          : defaultAutoProxyFallback,
      // Merge provider clientInfo with server-specific clientInfo
      // Server-specific takes precedence
      clientInfo: rest.clientInfo
        ? providerClientInfo
          ? { ...providerClientInfo, ...rest.clientInfo }
          : rest.clientInfo
        : providerClientInfo,
      // Pass cached metadata as initial server info if available
      _initialServerInfo: cachedMetadata,
      serverId: id,
    };
  }, [
    options,
    defaultCallbackUrl,
    defaultOAuthProxyUrl,
    defaultProxyConfig,
    defaultAutoProxyFallback,
    providerClientInfo,
    cachedMetadata,
  ]);

  // Merge user's wrapTransport with RPC logging wrapper
  const combinedWrapTransport = useMemo(() => {
    if (!rpcWrapTransport && !optionsWrapTransport) return undefined;

    return (transport: Transport) => {
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

  const queues = useMcpServerQueues({
    serverId: id,
    serverName: displayName || id,
    onNotificationReceived,
    onSamplingRequest,
    onElicitationRequest,
    onGlobalSamplingRequest,
    onGlobalElicitationRequest,
  });

  // Use the core useMcp hook with our callbacks
  const mcp = useMcp({
    ...mcpOptions,
    onNotification: queues.onNotification,
    onSampling: queues.onSampling,
    onElicitation: queues.onElicitation,
    wrapTransport: combinedWrapTransport,
  });

  useEffect(() => {
    if (mcp.state !== "ready") {
      queues.rejectAll("MCP server connection is no longer active");
    }
  }, [mcp.state, queues.rejectAll]);

  const updateConfig = useCallback(
    (config: Partial<McpServerConfig>) => onUpdateConfig(id, config),
    [id, onUpdateConfig]
  );

  const setHeaders = useCallback(
    (headers: Record<string, string> | undefined) => {
      const proxyAddress = options.proxyConfig?.proxyAddress?.trim();
      if (options.connectionMode === "proxy" && proxyAddress) {
        return onUpdateConfig(id, {
          proxyConfig: {
            ...options.proxyConfig,
            proxyAddress,
            ...(headers ? { headers } : {}),
          },
          headers: undefined,
        });
      }
      return onUpdateConfig(id, { headers });
    },
    [id, options.connectionMode, options.proxyConfig, onUpdateConfig]
  );

  const setDisplayName = useCallback(
    (displayName: string) => onUpdateDisplayName(id, displayName),
    [id, onUpdateDisplayName]
  );

  const reconnect = useCallback(() => onReconnect(id), [id, onReconnect]);

  // Update parent when state changes
  const onUpdateRef = useRef(onUpdate);
  const prevServerRef = useRef<McpServer | null>(null);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    const server: McpServer = {
      ...toPersistedServerConfig(options),
      ...mcp,
      id,
      displayName: displayName || options.displayName || id,
      notifications: queues.notifications,
      unreadNotificationCount: queues.unreadNotificationCount,
      markNotificationRead: queues.markNotificationRead,
      markAllNotificationsRead: queues.markAllNotificationsRead,
      clearNotifications: queues.clearNotifications,
      pendingSamplingRequests: queues.pendingSamplingRequests,
      approveSampling: queues.approveSampling,
      rejectSampling: queues.rejectSampling,
      pendingElicitationRequests: queues.pendingElicitationRequests,
      approveElicitation: queues.approveElicitation,
      rejectElicitation: queues.rejectElicitation,
      updateConfig,
      setHeaders,
      setDisplayName,
      reconnect,
    };

    // Only update if something actually changed
    const prevServer = prevServerRef.current;
    if (!prevServer || !isSameMcpServer(prevServer, server)) {
      prevServerRef.current = server;
      onUpdateRef.current(server);
    } else {
      providerLogger.debug(
        `[McpServerWrapper ${id}] No meaningful changes detected, skipping onUpdate`
      );
    }
  }, [
    id,
    displayName,
    options,
    options.url,
    // Primitive values that indicate meaningful state changes
    mcp.state,
    mcp.error,
    mcp.authUrl,
    mcp.tools,
    mcp.resources,
    mcp.resourceTemplates,
    mcp.prompts,
    mcp.serverInfo,
    mcp.capabilities,
    mcp.protocolEra,
    mcp.protocolVersion,
    mcp.instructions,
    mcp.extensions,
    mcp.authTokens,
    // Functions excluded - they're stable via useCallback in useMcp
    // mcp.log excluded - log changes shouldn't trigger provider updates
    // mcp.client excluded - client reference stability handled by manual check
    queues,
    updateConfig,
    setHeaders,
    setDisplayName,
    reconnect,
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
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Default OAuth callback URL for all servers.
   * Can be overridden per-server via the callbackUrl option in addServer().
   * Useful when the app is mounted at a sub-path (e.g. /inspector) so the
   * OAuth redirect lands on the correct route without requiring a server-side
   * redirect shim.
   */
  defaultCallbackUrl?: string;

  /** Default same-origin OAuth BFF URL for browser OAuth requests. */
  defaultOAuthProxyUrl?: string;

  /**
   * Default proxy configuration for all servers
   * Can be overridden per-server in addServer() options
   */
  defaultProxyConfig?: {
    proxyAddress?: string;
    headers?: Record<string, string>;
  };

  /**
   * Enable automatic proxy fallback for all servers by default
   * When enabled, if a direct connection fails with FastMCP or CORS errors,
   * automatically retries using proxy configuration
   * @defaultValue false
   */
  defaultAutoProxyFallback?:
    | boolean
    | {
        enabled?: boolean;
        proxyAddress?: string;
      };

  /**
   * Default connection options merged under each server's options (per-server wins).
   * Useful for app-wide auth UX such as `preventAutoAuth` or `useRedirectFlow`.
   */
  defaultServerConfig?: Partial<McpServerConfig>;

  /**
   * Client info for all servers (used for OAuth registration and server capabilities).
   * Can be overridden per-server in addServer() options.
   *
   * The optional `capabilities` field sets default MCP capabilities advertised to
   * every server managed by this provider (e.g. MCP Apps / SEP-1865 extensions).
   * It is merged with per-server `clientOptions.capabilities` (per-server takes
   * precedence) and is stripped from the actual MCP `clientInfo` wire field.
   */
  clientInfo?: {
    /** Client name displayed on OAuth consent pages (required) */
    name: string;
    /** Client title/display name */
    title?: string;
    /** Client version (required) */
    version: string;
    /** Client description */
    description?: string;
    /** Client icons (first icon used as logo_uri for OAuth) */
    icons?: Array<{
      src: string;
      mimeType?: string;
      sizes?: string[];
    }>;
    /** Client website URL (used as client_uri for OAuth) */
    websiteUrl?: string;
    /**
     * Default capabilities advertised to all servers managed by this provider.
     * Per-server `clientOptions.capabilities` are merged on top, with per-server
     * values taking precedence. Stripped from the MCP `clientInfo` wire field.
     *
     * @example
     * ```tsx
     * capabilities: {
     *   views: true,
     *   // or explicitly:
     *   extensions: {
     *     "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
     *   },
     * }
     * ```
     */
    capabilities?: Record<string, unknown>;
  };

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
    approve: (requestId: string, result: SamplingCreateMessageResult) => void,
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
  defaultCallbackUrl,
  defaultOAuthProxyUrl,
  defaultProxyConfig,
  defaultAutoProxyFallback = false,
  defaultServerConfig,
  clientInfo,
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
  const [serverRevisions, setServerRevisions] = useState<
    Record<string, number>
  >({});
  const [storageLoaded, setStorageLoaded] = useState(false);
  const didLoadInitialServers = useRef(false);

  // Mirror of `servers` for synchronous access from event handlers
  // (specifically `removeServer` / `updateServer`). Reading the latest
  // servers from a ref lets us run the wrapper teardown side effects
  // (`disconnect()` / `clearStorage()`) OUTSIDE the `setServers` updater
  // function. Those wrapper callbacks fire synchronous setStates on the
  // wrapper itself (`setLog` via `addLog`, `setAuthUrl`); when invoked
  // inside an updater they land during the provider's render phase, which
  // React reports as
  //   "Cannot update a component (`McpServerWrapper`) while rendering a
  //    different component (`McpClientProvider`)".
  // Reading from the ref keeps the callback identities stable too — we
  // don't have to add `servers` to their dependency arrays, which would
  // re-create the callbacks on every connection-state tick and trigger
  // downstream effects in consumers.
  const serversRef = useRef<McpServer[]>([]);
  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  // Store cached server metadata
  const cachedMetadataRef = useRef<
    Record<string, import("./storage.js").CachedServerMetadata>
  >({});

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
        providerLogger.debug("[McpClientProvider] RPC logger loaded");
        setRpcWrapTransport(() => module.wrapTransportForLogging);
        setRpcLoggingReady(true); // RPC logging loaded, mark as ready
      })
      .catch((err) => {
        providerLogger.error(
          "[McpClientProvider] Failed to load RPC logger:",
          err
        );
        setRpcWrapTransport(undefined);
        setRpcLoggingReady(true); // Failed to load, but still mark as ready to unblock
      });
  }, [enableRpcLogging]);

  // Load servers from storage on mount
  // Wait for RPC logging to be ready before loading servers
  useEffect(() => {
    if (!rpcLoggingReady) {
      providerLogger.debug(
        "[McpClientProvider] Waiting for RPC logging to be ready before loading servers"
      );
      return;
    }
    if (didLoadInitialServers.current) return;
    didLoadInitialServers.current = true;

    const loadServers = async () => {
      providerLogger.debug(
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
          providerLogger.debug(
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

        providerLogger.debug(
          "[McpClientProvider] Loaded from storage:",
          Object.keys(storedServers).length
        );

        // Load cached metadata if supported by storage provider
        if (storageProvider.getServerMetadata) {
          try {
            const serverIds = Object.keys(storedServers);
            const metadataPromises = serverIds.map(async (id) => {
              const metadata = await Promise.resolve(
                storageProvider.getServerMetadata!(id)
              );
              return [id, metadata] as const;
            });
            const metadataEntries = await Promise.all(metadataPromises);
            cachedMetadataRef.current = Object.fromEntries(
              metadataEntries.filter(
                (
                  entry
                ): entry is [
                  string,
                  import("./storage.js").CachedServerMetadata,
                ] => entry[1] !== undefined
              )
            );
            providerLogger.debug(
              "[McpClientProvider] Loaded cached metadata for",
              Object.keys(cachedMetadataRef.current).length,
              "servers"
            );
          } catch (metadataError) {
            providerLogger.warn(
              "[McpClientProvider] Failed to load cached metadata:",
              metadataError
            );
          }
        }

        // Merge with initial mcpServers (mcpServers takes precedence)
        const mergedServers = { ...storedServers, ...mcpServers };

        // Convert to ServerConfig array
        const configs = Object.entries(mergedServers).map(([id, options]) => ({
          id,
          options,
        }));

        providerLogger.debug(
          "[McpClientProvider] Total servers after merge:",
          configs.length
        );
        setServerConfigs(configs);
        setStorageLoaded(true);
      } catch (error) {
        providerLogger.error(
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
  }, [storageProvider, mcpServers, rpcLoggingReady]);

  // Save servers to storage when they change
  useEffect(() => {
    if (!storageProvider || !storageLoaded) return;

    const saveServers = async () => {
      try {
        const serversToSave = serverConfigs.reduce(
          (acc, config) => {
            acc[config.id] = toPersistedServerConfig(config.options);
            return acc;
          },
          {} as Record<string, McpServerConfig>
        );

        await Promise.resolve(storageProvider.setServers(serversToSave));
      } catch (error) {
        providerLogger.error(
          "[McpClientProvider] Failed to save to storage:",
          error
        );
      }
    };

    saveServers();
  }, [serverConfigs, storageProvider, storageLoaded]);

  const handleServerUpdate = useCallback(
    (updatedServer: McpServer) => {
      providerLogger.debug(
        `[McpClientProvider] handleServerUpdate called for server ${updatedServer.id}`,
        {
          toolCount: updatedServer.tools.length,
          state: updatedServer.state,
        }
      );

      const callbacksToRun: Array<() => void> = [];

      setServers((prev) => {
        const index = prev.findIndex((s) => s.id === updatedServer.id);
        const isNewServer = index === -1;

        if (isNewServer) {
          providerLogger.debug(
            `[McpClientProvider] Adding new server ${updatedServer.id} to state`
          );
          // Defer callbacks outside the state updater to avoid triggering
          // render-phase updates in user-provided handlers.
          callbacksToRun.push(() =>
            onServerAdded?.(updatedServer.id, updatedServer)
          );
          return [...prev, updatedServer];
        }

        // Check if actually changed to avoid loops
        const current = prev[index];
        const stateChanged = current.state !== updatedServer.state;
        const serverInfoChanged =
          current.serverInfo !== updatedServer.serverInfo;

        providerLogger.debug(
          `[McpClientProvider] Comparing server ${updatedServer.id}:`,
          {
            toolsChanged: current.tools !== updatedServer.tools,
            currentToolCount: current.tools.length,
            updatedToolCount: updatedServer.tools.length,
            stateChanged,
          }
        );

        if (isSameMcpServer(current, updatedServer)) {
          providerLogger.debug(
            `[McpClientProvider] No changes detected for server ${updatedServer.id}, skipping update`
          );
          return prev;
        }

        providerLogger.debug(
          `[McpClientProvider] Updating server ${updatedServer.id} in state`
        );

        // State changed - call callback
        if (stateChanged) {
          callbacksToRun.push(() =>
            onServerStateChange?.(updatedServer.id, updatedServer.state)
          );
        }

        // Server info changed - update cached metadata
        if (
          serverInfoChanged &&
          updatedServer.serverInfo &&
          storageProvider?.setServerMetadata
        ) {
          const metadata: import("./storage.js").CachedServerMetadata = {
            name: updatedServer.serverInfo.name,
            version: updatedServer.serverInfo.version,
            title: updatedServer.serverInfo.title,
            websiteUrl: updatedServer.serverInfo.websiteUrl,
            icons: updatedServer.serverInfo.icons,
            icon: updatedServer.serverInfo.icon,
          };

          // Update cached metadata ref
          cachedMetadataRef.current[updatedServer.id] = metadata;

          // Save to storage asynchronously
          Promise.resolve(
            storageProvider.setServerMetadata(updatedServer.id, metadata)
          ).catch((err) => {
            providerLogger.error(
              "[McpClientProvider] Failed to save server metadata:",
              err
            );
          });
        }

        const newServers = [...prev];
        newServers[index] = updatedServer;
        return newServers;
      });

      if (callbacksToRun.length > 0) {
        queueMicrotask(() => {
          callbacksToRun.forEach((callback) => callback());
        });
      }
    },
    [onServerAdded, onServerStateChange, storageProvider]
  );

  const addServer = useCallback((id: string, options: McpServerConfig) => {
    setServerConfigs((prev) => {
      if (prev.find((s) => s.id === id)) return prev;
      providerLogger.debug(
        "[McpClientProvider] Adding new server to configs:",
        id
      );
      return [...prev, { id, options }];
    });
  }, []);

  const removeServer = useCallback(
    async (id: string, opts?: { clearCredentials?: boolean }) => {
      // Capture the wrapper from the latest state BEFORE scheduling state
      // updates. The wrapper teardown (`disconnect()` / `clearStorage()`)
      // synchronously fires setState on the wrapper itself; running it here
      // — in the event-handler context — keeps those updates out of the
      // `setServers` updater, which would otherwise execute during the
      // provider's render phase and trigger
      //   "Cannot update a component (`McpServerWrapper`) while rendering
      //    a different component (`McpClientProvider`)".
      const captured = serversRef.current.find((s) => s.id === id);

      setServers((prev) => prev.filter((s) => s.id !== id));
      setServerConfigs((prev) => prev.filter((s) => s.id !== id));
      setServerRevisions((prev) => {
        const { [id]: _removed, ...remaining } = prev;
        return remaining;
      });

      if (captured?.disconnect) await captured.disconnect();
      // Only wipe persisted OAuth credentials on an explicit logout/forget.
      // Routine removal (and the remove+add churn callers use) must preserve
      // tokens — wrappers sharing a URL hash would otherwise destroy each
      // other's freshly minted credentials.
      if (opts?.clearCredentials && captured?.clearStorage) {
        await captured.clearStorage();
      }

      if (enableRpcLogging) {
        const { clearRpcLogs } = await import("./rpc-logger.js");
        clearRpcLogs(id);
      }
      onServerRemoved?.(id);
    },
    [enableRpcLogging, onServerRemoved]
  );

  const updateServer = useCallback(
    async (id: string, options: Partial<McpServerConfig>) => {
      const currentConfig = serverConfigs.find((s) => s.id === id);
      if (!currentConfig) {
        providerLogger.warn(
          `[McpClientProvider] Cannot update server "${id}" - not found`
        );
        return;
      }

      const updatedOptions: McpServerConfig = {
        ...currentConfig.options,
        ...options,
      };

      if (
        sameSerializedValue(
          pickPersistedServerConfig(currentConfig.options),
          pickPersistedServerConfig(updatedOptions)
        )
      ) {
        return;
      }

      const captured = serversRef.current.find((s) => s.id === id);

      // Complete teardown before remounting so an old transport cannot race
      // the replacement connection.
      await captured?.disconnect();

      setServers((prev) => prev.filter((s) => s.id !== id));
      setServerConfigs((prev) =>
        prev.map((server) =>
          server.id === id ? { id, options: updatedOptions } : server
        )
      );
      setServerRevisions((prev) => ({
        ...prev,
        [id]: (prev[id] ?? 0) + 1,
      }));
    },
    [serverConfigs]
  );

  const reconnectServer = useCallback(
    async (id: string) => {
      const currentConfig = serverConfigs.find((s) => s.id === id);
      if (!currentConfig) {
        providerLogger.warn(
          `[McpClientProvider] Cannot reconnect server "${id}" - not found`
        );
        return;
      }

      const captured = serversRef.current.find((s) => s.id === id);
      await captured?.disconnect();

      setServers((prev) => prev.filter((s) => s.id !== id));
      setServerRevisions((prev) => ({
        ...prev,
        [id]: (prev[id] ?? 0) + 1,
      }));
    },
    [serverConfigs]
  );

  const updateServerMetadata = useCallback(
    async (id: string, metadata: { name: string }) => {
      return new Promise<void>((resolve) => {
        const currentConfig = serverConfigs.find((s) => s.id === id);
        if (!currentConfig) {
          providerLogger.warn(
            `[McpClientProvider] Cannot update server metadata for "${id}" - not found`
          );
          resolve();
          return;
        }

        const updatedOptions: McpServerConfig = {
          ...currentConfig.options,
          displayName: metadata.name,
        };

        setServers((prev) =>
          prev.map((server) =>
            server.id === id
              ? { ...server, displayName: metadata.name }
              : server
          )
        );

        setServerConfigs((prev) => {
          const updated = prev.map((s) =>
            s.id === id ? { id, options: updatedOptions } : s
          );
          setTimeout(() => resolve(), 0);
          return updated;
        });
      });
    },
    [serverConfigs]
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
      updateServerMetadata,
      updateServer,
      getServer,
      storageLoaded,
    }),
    [
      servers,
      addServer,
      removeServer,
      updateServerMetadata,
      updateServer,
      getServer,
      storageLoaded,
    ]
  );

  // Strip `capabilities` from clientInfo — it is a provider-level default for
  // MCP capabilities, not a standard MCP clientInfo wire field.
  const { capabilities: defaultCapabilities, ...clientInfoWithoutCaps } =
    clientInfo || {};
  const clientInfoForWrapper = useMemo(
    () =>
      Object.keys(clientInfoWithoutCaps).length
        ? (clientInfoWithoutCaps as typeof clientInfo)
        : undefined,
    [clientInfo]
  );

  // Merge defaultCapabilities into each server's clientOptions.capabilities.
  // Memoized so the merged options objects are stable references across renders —
  // a new object on every render would cause McpServerWrapper to reconnect.
  const mergedServerConfigs = useMemo(
    () =>
      serverConfigs.map((config) => {
        let options: McpServerConfig = defaultServerConfig
          ? { ...defaultServerConfig, ...config.options }
          : config.options;

        if (defaultCapabilities) {
          options = {
            ...options,
            clientOptions: {
              ...options.clientOptions,
              capabilities: {
                ...defaultCapabilities,
                ...options.clientOptions?.capabilities,
              },
            },
          };
        }

        return { id: config.id, options };
      }),
    [serverConfigs, defaultCapabilities, defaultServerConfig]
  );

  // ponytail: OAuth callback must not auto-connect saved servers — a 401 on that
  // page runs SDK auth() and overwrites the in-flight PKCE verifier before finishAuth.
  const skipServerConnections =
    typeof window !== "undefined" &&
    /\/oauth\/callback\/?$/.test(window.location.pathname);

  return (
    <McpClientContext.Provider value={contextValue}>
      {children}
      {!skipServerConnections &&
        mergedServerConfigs.map((config) => (
          <McpServerWrapper
            key={`${config.id}-v${serverRevisions[config.id] ?? 0}`}
            id={config.id}
            options={config.options}
            defaultCallbackUrl={defaultCallbackUrl}
            defaultOAuthProxyUrl={defaultOAuthProxyUrl}
            defaultProxyConfig={defaultProxyConfig}
            defaultAutoProxyFallback={defaultAutoProxyFallback}
            clientInfo={clientInfoForWrapper}
            cachedMetadata={cachedMetadataRef.current[config.id]}
            onUpdate={handleServerUpdate}
            onUpdateConfig={updateServer}
            onUpdateDisplayName={(id, displayName) =>
              updateServerMetadata(id, { name: displayName })
            }
            onReconnect={reconnectServer}
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
 * const {
 *   servers,
 *   addServer,
 *   removeServer,
 *   updateServer,
 *   updateServerMetadata,
 * } = useMcpClient();
 *
 * // Add a server
 * addServer("linear", { url: "https://mcp.linear.app/sse" });
 *
 * // Update a server's configured display name without reconnecting
 * await updateServerMetadata("linear", { name: "Linear Production" });
 *
 * // Update connection-affecting configuration and reconnect
 * await updateServer("linear", { headers: { Authorization: "Bearer ..." } });
 * // Or from a connected server handle:
 * await servers[0].setHeaders({ Authorization: "Bearer ..." });
 *
 * // Rename without reconnecting
 * await servers[0].setDisplayName("Linear Production");
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
  const { servers } = useMcpClient();
  return useMemo(
    () => servers.find((server) => server.id === id),
    [id, servers]
  );
}
