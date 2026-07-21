// useMcp.ts
import { auth } from "@modelcontextprotocol/client";
import type {
  OAuthClientProvider,
  Prompt,
  ProtocolEra,
  Resource,
  ResourceTemplateType as ResourceTemplate,
  Tool,
  Transport,
} from "@modelcontextprotocol/client";
import {
  runAuthPopup,
  MCP_AUTH_BROADCAST_CHANNEL,
  MCP_AUTH_CALLBACK_MESSAGE_TYPE,
  type McpAuthCallbackMessage,
} from "../auth/popup.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMCPClient } from "../core/browser.js";
import { resolveClientOptions } from "../core/config.js";
import { Logger, type LogLevel } from "../utils/logging.js";
import type { MCPConnection } from "../core/session.js";
import { Tel } from "../telemetry/telemetry-browser.js";
import { isUnauthorized } from "../auth/flow.js";
import { assert } from "./useMcp-helpers.js";
import type { ProxyConfig } from "./types.js";
import { sanitizeUrl } from "../auth/url.js";
import { getPackageVersion } from "../utils/version.js";
import {
  createBrowserOAuthProvider,
  deriveOAuthClientConfigFromClientInfo,
  isOAuthDiscoveryFailure,
  startConnectionHealthMonitoring,
  USE_MCP_SERVER_NAME,
} from "./useMcp-helpers.js";
import type { UseMcpOptions, UseMcpResult } from "./types.js";
import { loadServerIcon } from "./useMcp-helpers.js";
import { useMcpOperations } from "./useMcp-operations.js";

const DEFAULT_RECONNECT_DELAY = 3000;
const DEFAULT_RETRY_DELAY = 5000;

// Streamable HTTP is the only supported remote transport.
type TransportType = "http";

type UseMcpAuthProvider = OAuthClientProvider & {
  tokens?: () => Promise<
    { access_token?: string; [key: string]: unknown } | undefined
  >;
  clearStorage?: () => number;
  getLastAttemptedAuthUrl?: () => string | null | undefined;
  getTokenEndpoint?: () => Promise<string | null>;
  getResource?: () => Promise<string | null>;
  getClientCredentials?: () => Promise<{
    client_id: string;
    client_secret?: string;
  } | null>;
  /**
   * Returns a `fetch` scoped to this provider that routes OAuth requests
   * through the configured OAuth proxy (bypassing CORS) while leaving the
   * global `fetch` untouched. Passed to the SDK transport / `auth()` so proxy
   * behavior is confined to this server's connection.
   */
  getProxyFetch?: (baseFetch?: typeof fetch) => typeof fetch | undefined;
  serverUrl?: string;
  /** localStorage key for a given suffix (e.g. "tokens"). */
  getKey?: (keySuffix: string) => string;
  /** Stable hash of the server URL, used to scope OAuth result messages. */
  serverUrlHash?: string;
};

type UseMcpInternalOptions = UseMcpOptions & {
  _initialServerInfo?: {
    name?: string;
    version?: string;
    title?: string;
    websiteUrl?: string;
    icons?: Array<{ src: string; mimeType?: string }>;
    icon?: string;
  };
};

/**
 * React hook for connecting to and interacting with MCP servers
 *
 * Provides a complete interface for MCP server connections including:
 * - Automatic connection management with reconnection
 * - OAuth authentication with automatic token refresh
 * - Tool, resource, and prompt access
 * - AI chat functionality with conversation memory
 * - Streamable HTTP transport
 *
 * @param options - Configuration options for the MCP connection
 * @returns MCP connection state and methods
 *
 * @example
 * ```typescript
 * const mcp = useMcp({
 *   url: 'http://localhost:3000/mcp',
 *   headers: { Authorization: 'Bearer YOUR_API_KEY' }
 * })
 *
 * // Wait for connection
 * useEffect(() => {
 *   if (mcp.state === 'ready') {
 *     console.log('Connected!', mcp.tools)
 *   }
 * }, [mcp.state])
 *
 * // Call a tool
 * const result = await mcp.callTool('send-email', { to: 'user@example.com' })
 * ```
 */
export function useMcp(options: UseMcpInternalOptions): UseMcpResult {
  const {
    url,
    enabled = true,
    callbackUrl = typeof window !== "undefined"
      ? sanitizeUrl(
          new URL("/oauth/callback", window.location.origin).toString()
        )
      : "/oauth/callback",
    storageKeyPrefix = "mcp:auth",
    authProvider: providedAuthProvider,
    headers: headersOption,
    proxyConfig,
    oauthProxyUrl: oauthProxyUrlOption,
    connectionMode,
    autoProxyFallback = false,
    logLevel: logLevelOption = "silent",
    autoRetry = false,
    autoReconnect = true,
    reconnectionOptions,
    preventAutoAuth = true, // Default to true - require explicit user action for OAuth
    useRedirectFlow = false, // Default to false for backward compatibility (use popup)
    onPopupWindow,
    timeout = 30000, // 30 seconds default for connection timeout
    wrapTransport,
    serverId,
    fetch: customFetch,
    clientOptions,
    protocolNegotiation,
    onNotification,
    onSampling: onSamplingOption,
    onElicitation: onElicitationOption,
    oauth: oauthOptions,
  } = options;
  const transportType: TransportType = "http";
  const requestedProxyAddress = proxyConfig?.proxyAddress;

  const oauthClientId = oauthOptions?.clientId?.trim() || undefined;
  const oauthClientMetadataUrl =
    oauthOptions?.clientMetadataUrl?.trim() || undefined;
  const oauthScope = oauthOptions?.scope?.trim() || undefined;
  const staticClientInfo = useMemo(
    () => (oauthClientId ? { client_id: oauthClientId } : undefined),
    [oauthClientId]
  );

  // Create a per-instance logger so multiple useMcp instances don't clobber each other's log level.
  // Each instance gets its own named logger keyed by URL (or a fallback).
  const instanceLogger = useMemo(() => {
    const name = `useMcp:${url || "no-url"}`;
    const inst = Logger.get(name);
    // Configure the per-instance level when requested.
    if (logLevelOption) {
      inst.level = logLevelOption as LogLevel;
    }
    return inst;
  }, [url, logLevelOption]);

  const headers = headersOption ?? {};
  const effectiveClientOptions = useMemo(
    () => resolveClientOptions(clientOptions),
    [clientOptions]
  );

  const onSampling = onSamplingOption;
  const onElicitation = onElicitationOption;
  // Build clientInfo with defaults, merging with provided clientInfo
  const defaultClientInfo = useMemo(
    () => ({
      name: "mcp-use",
      title: "mcp-use",
      version: getPackageVersion(),
      description:
        "mcp-use is a complete TypeScript framework for building and using MCP",
      icons: [
        {
          src: "https://mcp-use.com/logo.png",
        },
      ],
      websiteUrl: "https://mcp-use.com",
    }),
    []
  );

  const mergedClientInfo = useMemo(
    () =>
      options.clientInfo
        ? { ...defaultClientInfo, ...options.clientInfo }
        : defaultClientInfo,
    [options.clientInfo, defaultClientInfo]
  );

  // Derive OAuth client registration config from clientInfo.
  const derivedOAuthClientConfig = useMemo(
    () => deriveOAuthClientConfigFromClientInfo(mergedClientInfo),
    [mergedClientInfo]
  );

  const oauthClientConfig = derivedOAuthClientConfig;

  // Parse autoProxyFallback configuration
  const autoProxyFallbackConfig = useMemo(() => {
    // Explicit Direct and Proxy modes never fall back. Direct must stay direct,
    // while Proxy already starts on the configured gateway.
    if (connectionMode === "direct" || connectionMode === "proxy") {
      return { enabled: false, proxyAddress: undefined };
    }
    if (!autoProxyFallback) {
      return { enabled: false, proxyAddress: undefined };
    }
    if (typeof autoProxyFallback === "boolean") {
      const proxyAddress = proxyConfig?.proxyAddress;
      return {
        enabled: autoProxyFallback && Boolean(proxyAddress),
        proxyAddress,
      };
    }
    const proxyAddress =
      autoProxyFallback.proxyAddress ?? proxyConfig?.proxyAddress;
    return {
      enabled: autoProxyFallback.enabled !== false && Boolean(proxyAddress),
      proxyAddress,
    };
  }, [autoProxyFallback, connectionMode, proxyConfig]);

  // Normalize autoReconnect into a consistent config object
  const autoReconnectConfig = useMemo(() => {
    if (autoReconnect === false) {
      return {
        enabled: false,
        initialDelay: 0,
        healthCheckInterval: false as const,
        healthCheckTimeout: 30000,
      };
    }
    if (autoReconnect === true) {
      return {
        enabled: true,
        initialDelay: DEFAULT_RECONNECT_DELAY,
        healthCheckInterval: 10000,
        healthCheckTimeout: 30000,
      };
    }
    if (typeof autoReconnect === "number") {
      return {
        enabled: true,
        initialDelay: autoReconnect,
        healthCheckInterval: 10000,
        healthCheckTimeout: 30000,
      };
    }
    return {
      enabled: autoReconnect.enabled !== false,
      initialDelay: autoReconnect.initialDelay ?? DEFAULT_RECONNECT_DELAY,
      healthCheckInterval: autoReconnect.healthCheckInterval ?? 10000,
      healthCheckTimeout: autoReconnect.healthCheckTimeout ?? 30000,
    };
  }, [autoReconnect]);

  // Runtime proxy config is set only after automatic direct -> proxy fallback.
  const [effectiveProxyConfig, setEffectiveProxyConfig] = useState<
    ProxyConfig | undefined
  >(undefined);

  // Reset runtime fallback when the requested connection changes.
  useEffect(() => {
    setEffectiveProxyConfig(undefined);
  }, [url, requestedProxyAddress, connectionMode]);

  const activeProxyConfig = useMemo(() => {
    if (effectiveProxyConfig?.proxyAddress) {
      const latestHeaders = proxyConfig?.headers ?? {};
      return {
        ...effectiveProxyConfig,
        headers: {
          ...latestHeaders,
          ...(effectiveProxyConfig.headers ?? {}),
        },
      };
    }

    // Auto always starts direct, even when proxyConfig supplies the fallback
    // address. Direct also ignores stale proxyConfig left by older persisted
    // Inspector configurations. Without an explicit mode, preserve the
    // low-level API's immediate-proxy behavior unless fallback was requested.
    const startsDirect =
      connectionMode === "auto" ||
      connectionMode === "direct" ||
      (connectionMode === undefined && autoProxyFallbackConfig.enabled);
    return startsDirect ? undefined : proxyConfig;
  }, [
    effectiveProxyConfig,
    proxyConfig,
    connectionMode,
    autoProxyFallbackConfig.enabled,
  ]);

  const gatewayUrl = activeProxyConfig?.proxyAddress;
  const proxyHeaders = activeProxyConfig?.headers ?? {};

  // OAuth provider should ALWAYS use the original target URL for OAuth discovery,
  // not the proxy URL. The proxy is only used for making the actual HTTP requests.
  const effectiveOAuthUrl = useMemo(() => {
    return url || "";
  }, [url]);

  // Merge proxy headers with custom headers (custom headers take precedence)
  const allHeaders = useMemo(
    () => ({ ...proxyHeaders, ...headers }),
    [proxyHeaders, headers]
  );

  const [state, setState] = useState<UseMcpResult["state"]>("discovering");
  const [tools, setTools] = useState<Tool[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceTemplates, setResourceTemplates] = useState<
    ResourceTemplate[]
  >([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [serverInfo, setServerInfo] = useState<UseMcpResult["serverInfo"]>(
    // Only use cached metadata if it has at least a name
    options._initialServerInfo?.name
      ? (options._initialServerInfo as UseMcpResult["serverInfo"])
      : undefined
  );
  const [capabilities, setCapabilities] = useState<Record<string, any>>();
  const [protocolEra, setProtocolEra] = useState<ProtocolEra | undefined>(
    undefined
  );
  const [protocolVersion, setProtocolVersion] = useState<string | undefined>(
    undefined
  );
  const [instructions, setInstructions] = useState<string | undefined>();
  const [extensions, setExtensions] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<UseMcpResult["log"]>([]);
  const [authUrl, setAuthUrl] = useState<string | undefined>(undefined);
  const [authTokens, setAuthTokens] =
    useState<UseMcpResult["authTokens"]>(undefined);

  const clientRef = useRef<BrowserMCPClient | null>(null);
  const connectionRef = useRef<MCPConnection | null>(null);
  const authProviderRef = useRef<UseMcpAuthProvider | null>(
    (providedAuthProvider as UseMcpAuthProvider | undefined) ?? null
  );
  const iconLoadingPromiseRef = useRef<Promise<string | null> | null>(null);
  const connectingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const connectAttemptRef = useRef<number>(0);
  /** Bumped at the start of each connect(); disconnect only clears clientRef if epoch unchanged. */
  const connectEpochRef = useRef(0);
  const authTimeoutRef = useRef<number | null>(null);
  const retryScheduledRef = useRef<boolean>(false);
  /**
   * True while a manual `authenticate()` popup flow owns the OAuth result.
   * The always-on `mcp_auth_callback` listener defers to the popup runner
   * during this window so a single completion doesn't trigger two reconnects.
   */
  const popupFlowActiveRef = useRef<boolean>(false);

  // --- Refs for values used in callbacks ---
  const stateRef = useRef(state);
  const autoReconnectRef = useRef(autoReconnect);
  const successfulTransportRef = useRef<TransportType | null>(null);
  // Forward refs for functions (declared later) to avoid circular dependencies
  const connectRef = useRef<(() => Promise<void>) | null>(null);
  const failConnectionRef = useRef<
    ((message: string, error?: Error) => void) | null
  >(null);

  // Reverse-request / notification callbacks must stay fresh without putting
  // their React identities into connect()'s dependency list (which would
  // reconnect whenever a parent re-creates inline handlers).
  //
  // Presence and implementation are tracked separately for reverse requests:
  // the current presence refs determine capabilities on the next normal
  // connect, while implementation refs retain the last defined handler so an
  // already-advertised live connection does not start failing merely because its
  // callback prop was removed before that reconnect.
  const onSamplingRef = useRef(onSampling);
  const onElicitationRef = useRef(onElicitation);
  const hasSamplingCallbackRef = useRef(onSampling !== undefined);
  const hasElicitationCallbackRef = useRef(onElicitation !== undefined);
  const onNotificationRef = useRef(onNotification);
  if (onSampling !== undefined) {
    onSamplingRef.current = onSampling;
  }
  if (onElicitation !== undefined) {
    onElicitationRef.current = onElicitation;
  }
  hasSamplingCallbackRef.current = onSampling !== undefined;
  hasElicitationCallbackRef.current = onElicitation !== undefined;
  onNotificationRef.current = onNotification;

  // Stable proxies passed to addServer notification wiring. Capability
  // advertisement uses current presence at connect time; once wired, reverse
  // requests dispatch to the latest defined implementation retained above.
  const stableOnSampling = useCallback<
    NonNullable<UseMcpOptions["onSampling"]>
  >(async (params) => {
    // This proxy is only wired when a callback exists, and the implementation
    // ref is intentionally never cleared during that live connection.
    return onSamplingRef.current!(params);
  }, []);
  const stableOnElicitation = useCallback<
    NonNullable<UseMcpOptions["onElicitation"]>
  >(async (params) => {
    return onElicitationRef.current!(params);
  }, []);
  const stableOnNotification = useCallback(
    (notification: Parameters<NonNullable<typeof onNotification>>[0]) => {
      onNotificationRef.current?.(notification);
    },
    []
  );

  /**
   * Effect: Keep refs in sync with state values
   * Allows callbacks to access latest state without re-creating them
   */
  useEffect(() => {
    stateRef.current = state;
    autoReconnectRef.current = autoReconnect;
  }, [state, autoReconnect]);

  useEffect(() => {
    authProviderRef.current =
      (providedAuthProvider as UseMcpAuthProvider | undefined) ?? null;
  }, [providedAuthProvider]);

  // --- Stable Callbacks ---
  /**
   * Add a log entry to the connection log.
   * Console output is routed through the per-instance logger so that
   * the configured logLevel / silent mode is respected.
   * The log state array is always populated for programmatic access.
   * @internal
   */
  const addLog = useCallback(
    (
      level: UseMcpResult["log"][0]["level"],
      message: string,
      ...args: unknown[]
    ) => {
      const fullMessage =
        args.length > 0
          ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
          : message;
      // Route through per-instance logger so logLevel/silent is respected
      const logMsg = `[useMcp] ${fullMessage}`;
      switch (level) {
        case "error":
          instanceLogger.error(logMsg);
          break;
        case "warn":
          instanceLogger.warn(logMsg);
          break;
        case "info":
          instanceLogger.info(logMsg);
          break;
        case "debug":
          instanceLogger.debug(logMsg);
          break;
        default:
          instanceLogger.info(logMsg);
      }
      if (isMountedRef.current) {
        setLog((prevLog: UseMcpResult["log"]) => [
          ...prevLog.slice(-100),
          { level, message: fullMessage, timestamp: Date.now() },
        ]);
      }
    },
    [instanceLogger]
  );

  const connectionOperations = useMcpOperations({
    stateRef,
    connectionRef,
    hasClient: () => clientRef.current !== null,
    isMounted: () => isMountedRef.current,
    setTools,
    setResources,
    setResourceTemplates,
    setPrompts,
    addLog,
  });

  /**
   * Disconnect from the MCP server and clean up resources
   * @param quiet - If true, suppresses log messages
   */
  const disconnect = useCallback(
    async (quiet = false) => {
      if (!quiet) addLog("info", "Disconnecting...");
      connectingRef.current = false;
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;

      const epochAtStart = connectEpochRef.current;
      const clientToClose = clientRef.current;
      if (clientToClose) {
        try {
          const serverName = USE_MCP_SERVER_NAME;
          const connection =
            clientToClose === clientRef.current ? connectionRef.current : null;

          // Clean up health check monitoring if it exists
          if (connection && (connection as any)._healthCheckCleanup) {
            (connection as any)._healthCheckCleanup();
            (connection as any)._healthCheckCleanup = null;
          }

          // Only try to close if a connection exists (avoids noisy warning logs)
          if (connection) {
            await clientToClose.closeSession(serverName);
          }
        } catch (err) {
          if (!quiet) addLog("warn", "Error closing connection:", err);
        }
      }
      // A newer connect() (e.g. dashboard environment / URL change) may have
      // bumped the epoch — possibly reusing the same client instance — while
      // closeSession was in flight. If so, this disconnect is stale: it must
      // neither null the (now newer) clientRef nor reset the live state.
      const supersededByNewerConnect = connectEpochRef.current !== epochAtStart;

      if (clientRef.current === clientToClose && !supersededByNewerConnect) {
        clientRef.current = null;
        connectionRef.current = null;
      }

      if (isMountedRef.current && !quiet && !supersededByNewerConnect) {
        setState("discovering");
        setTools([]);
        setResources([]);
        setResourceTemplates([]);
        setPrompts([]);
        setError(undefined);
        setAuthUrl(undefined);
        setAuthTokens(undefined);
        setServerInfo(undefined);
        setCapabilities(undefined);
        setProtocolEra(undefined);
        setProtocolVersion(undefined);
        setInstructions(undefined);
        setExtensions({});
      }
    },
    [addLog]
  );

  /**
   * Mark connection as failed with an error message
   * @internal
   * @returns true if automatic fallback was triggered (caller should not set failed state)
   */
  const failConnection = useCallback(
    (errorMessage: string, connectionError?: Error): boolean => {
      addLog("error", errorMessage, connectionError ?? "");

      // Extract HTTP status code from error if available
      const errorCode =
        connectionError && "code" in connectionError
          ? (connectionError as any).code
          : undefined;

      // Check if we should try automatic proxy fallback
      // Don't use a ref to track this - it causes issues with React strict mode
      // where multiple instances share the same ref but have different state
      const shouldTryProxyFallback =
        autoProxyFallbackConfig.enabled && !activeProxyConfig?.proxyAddress; // Only fallback if not already using proxy

      // Detect CORS errors (these can't have status codes, so check message)
      const isCorsError =
        errorMessage.includes("CORS") ||
        errorMessage.includes("blocked by CORS policy") ||
        errorMessage.includes("Failed to fetch");

      // HTTP 400 errors typically indicate session/protocol incompatibility that a proxy can resolve
      // (e.g., FastMCP missing session ID, streamable HTTP issues)
      const is400Error = errorCode === 400;

      // Other 4xx errors that might benefit from proxy fallback (except auth errors)
      const hasOther4xxError =
        typeof errorCode === "number" && errorCode >= 404 && errorCode < 500;

      // Don't fallback on auth errors (proxy won't help with authentication)
      const isAuthError = errorCode === 401 || errorCode === 403;

      const shouldFallback =
        shouldTryProxyFallback &&
        (isCorsError || is400Error || hasOther4xxError) &&
        !isAuthError;

      if (shouldFallback) {
        const errorType = isCorsError
          ? "CORS error"
          : is400Error
            ? "HTTP 400 (Bad Request)"
            : "HTTP 4xx error";
        addLog(
          "info",
          `Direct connection failed with ${errorType}. Trying with proxy...`
        );

        // Clear client/auth refs to force fresh initialization with proxy.
        // Keep externally provided auth providers intact. Synchronous clear;
        // reconnect is deferred via setTimeout below, so no disconnect race.
        clientRef.current = null;
        if (!providedAuthProvider) {
          authProviderRef.current = null;
        }
        addLog("debug", "Cleared client and auth provider for proxy fallback");

        // Set proxy configuration and trigger reconnect
        setEffectiveProxyConfig({
          proxyAddress: autoProxyFallbackConfig.proxyAddress!,
        });

        // Explicitly set state back to "discovering" to prevent showing failed state
        // This ensures smooth UX during automatic retry
        if (isMountedRef.current) {
          setState("discovering");
        }

        // Trigger reconnection after a brief delay
        setTimeout(() => {
          if (isMountedRef.current) {
            connectRef.current?.();
          }
        }, 1000);

        return true; // Signal that we're retrying - caller should not set failed state
      }

      // Normal failure handling
      if (isMountedRef.current) {
        addLog("info", "Setting state to FAILED:", errorMessage);
        setState("failed");
        setError(errorMessage);
        const manualUrl = authProviderRef.current?.getLastAttemptedAuthUrl?.();
        if (manualUrl) {
          setAuthUrl(manualUrl);
          addLog(
            "info",
            "Manual authentication URL may be available.",
            manualUrl
          );
        }
      }
      connectingRef.current = false;

      // Track failed connection
      if (url) {
        Tel.getInstance()
          .trackUseMcpConnection({
            url,
            transportType: transportType,
            success: false,
            errorType: connectionError?.name || "UnknownError",
            hasOAuth: !!authProviderRef.current,
            hasSampling: hasSamplingCallbackRef.current,
            hasElicitation: hasElicitationCallbackRef.current,
          })
          .catch(() => {});
      }

      return false; // Not retrying, connection actually failed
    },
    [
      addLog,
      url,
      transportType,
      autoProxyFallbackConfig,
      activeProxyConfig,
      providedAuthProvider,
    ]
  );

  /**
   * Connect to the MCP server over streamable HTTP.
   * @internal
   */
  const connect = useCallback(async () => {
    // Don't connect if not enabled or no URL provided
    if (!enabled || !url) {
      addLog(
        "debug",
        enabled
          ? "No server URL provided, skipping connection."
          : "Connection disabled via enabled flag."
      );
      return;
    }

    if (connectingRef.current) {
      addLog("debug", "Connection attempt already in progress.");
      return;
    }
    if (!isMountedRef.current) {
      addLog("debug", "Connect called after unmount, aborting.");
      return;
    }

    connectingRef.current = true;
    connectEpochRef.current += 1;
    connectAttemptRef.current += 1;
    setError(undefined);
    setAuthUrl(undefined);
    successfulTransportRef.current = null;
    setState("discovering");
    setTools([]);
    setResources([]);
    setResourceTemplates([]);
    setPrompts([]);
    setServerInfo(undefined);
    setCapabilities(undefined);
    setProtocolEra(undefined);
    setProtocolVersion(undefined);
    setInstructions(undefined);
    setExtensions({});
    addLog(
      "info",
      `Connecting attempt #${connectAttemptRef.current} to ${url}...`
    );

    // NOTE: We intentionally do NOT clear OAuth storage before connecting.
    // The clearStorage() function clears tokens and client_info which should
    // persist across connections. Clearing them would force re-authentication
    // even when valid tokens exist from a previous OAuth flow.
    //
    // Stale state/verifier items are cleaned up:
    // - By the callback handler after successful token exchange
    // - By the unmount cleanup when OAuth flow is interrupted
    // - By the state expiry check in the callback handler

    if (!authProviderRef.current) {
      const { provider, oauthProxyUrl } = createBrowserOAuthProvider({
        effectiveOAuthUrl,
        storageKeyPrefix,
        oauthClientConfig,
        callbackUrl,
        preventAutoAuth,
        useRedirectFlow,
        gatewayUrl,
        oauthProxyUrl: oauthProxyUrlOption,
        onPopupWindow,
        proxyOAuthRequests: true,
        staticClientInfo,
        clientMetadataUrl: oauthClientMetadataUrl,
        scope: oauthScope,
      });
      authProviderRef.current = provider;
      if (oauthProxyUrl) {
        addLog("debug", `OAuth BFF enabled: ${oauthProxyUrl}`);
      }
      addLog(
        "debug",
        `BrowserOAuthClientProvider initialized with URL: ${effectiveOAuthUrl}, proxy: ${oauthProxyUrl ? "enabled" : "disabled"}, gateway: ${gatewayUrl ? "enabled" : "disabled"}`
      );
    }
    if (!clientRef.current) {
      clientRef.current = new BrowserMCPClient();
      addLog("debug", "BrowserMCPClient initialized in connect.");
    } else {
      addLog("debug", "BrowserMCPClient already exists, reusing.");
    }

    const tryConnectWithTransport = async (
      transportTypeParam: TransportType
    ): Promise<"success" | "fallback" | "auth_redirect" | "failed"> => {
      // Check if component unmounted
      if (!isMountedRef.current) {
        addLog("debug", "Connection attempt aborted - component unmounted");
        return "failed";
      }

      addLog(
        "info",
        `Attempting connection with transport: ${transportTypeParam}`
      );
      addLog(
        "debug",
        `Client ref status at start of tryConnectWithTransport: ${clientRef.current ? "initialized" : "NULL"}`
      );

      try {
        const serverName = USE_MCP_SERVER_NAME;

        // Build server config
        const serverConfig: any = {
          url: url, // Use original URL, not transformed proxy URL
          timeout,
          clientInfo: mergedClientInfo,
          // Pass a fetch that scopes OAuth-proxy routing to this server's
          // transport/auth calls. getProxyFetch wraps `customFetch` (e.g. the
          // OAuth retry fetch for scope step-up), bypasses the browser cache
          // for OAuth metadata, and optionally routes OAuth through the BFF.
          // It never mutates the global fetch.
          ...(() => {
            const scopedFetch =
              authProviderRef.current?.getProxyFetch?.(customFetch) ??
              customFetch;
            return scopedFetch ? { fetch: scopedFetch } : {};
          })(),
          // Pass clientOptions for custom capabilities (e.g., MCP Apps extension)
          ...(effectiveClientOptions && {
            clientOptions: effectiveClientOptions,
          }),
          // Protocol era negotiation mode ("legacy" | "auto" | { pin }); the
          // connector defaults to automatic v1/v2 negotiation.
          ...(protocolNegotiation !== undefined && { protocolNegotiation }),
          // Pass user-configurable reconnection options, or when autoReconnect
          // is disabled, disable SDK transport reconnection to prevent
          // unwanted GET polling requests
          ...(reconnectionOptions
            ? { reconnectionOptions }
            : autoReconnect === false
              ? { reconnectionOptions: { maxRetries: 0 } }
              : {}),
        };

        // Add gateway URL if using proxy
        if (gatewayUrl) {
          serverConfig.gatewayUrl = gatewayUrl;
          addLog(
            "debug",
            `Using proxy gateway: ${gatewayUrl} for target: ${url}`
          );
        }

        // Add custom headers if provided (includes proxy headers)
        if (allHeaders && Object.keys(allHeaders).length > 0) {
          serverConfig.headers = allHeaders;
        }

        // Client should be initialized by the parent connect() function
        // If it's not AND component is still mounted, this is a programming error
        if (!clientRef.current) {
          if (!isMountedRef.current) {
            addLog(
              "debug",
              "Connection aborted - component unmounted, client cleaned up"
            );
            return "failed";
          }
          const initError = new Error(
            "Client not initialized - this is a bug in the connection flow"
          );
          addLog(
            "error",
            "Client ref is null in tryConnectWithTransport but component is still mounted"
          );
          throw initError;
        }

        // Add server to client with OAuth provider.
        // Pass stable proxies (when a callback is present) so capability
        // advertisement happens on initial connect, while dispatch always
        // reaches the latest React handler via refs — even after reconnects
        // that reuse a connect() closure created with a different identity.
        clientRef.current.addServer(serverName, {
          ...serverConfig,
          authProvider: authProviderRef.current,
          onSampling: hasSamplingCallbackRef.current
            ? stableOnSampling
            : undefined,
          onElicitation: hasElicitationCallbackRef.current
            ? stableOnElicitation
            : undefined,
          onNotification: (
            notification: Parameters<typeof stableOnNotification>[0]
          ) => {
            addLog(
              "debug",
              "Notification received:",
              notification.method,
              notification
            );
            stableOnNotification(notification);

            if (notification.method === "notifications/tools/list_changed") {
              addLog("info", "Tools list changed, auto-refreshing...");
              connectionOperations
                .refreshTools()
                .catch((err) =>
                  addLog("warn", "Auto-refresh tools failed:", err)
                );
            } else if (
              notification.method === "notifications/resources/list_changed"
            ) {
              addLog("info", "Resources list changed, auto-refreshing...");
              connectionOperations
                .refreshResources()
                .catch((err) =>
                  addLog("warn", "Auto-refresh resources failed:", err)
                );
            } else if (
              notification.method === "notifications/prompts/list_changed"
            ) {
              addLog("info", "Prompts list changed, auto-refreshing...");
              connectionOperations
                .refreshPrompts()
                .catch((err) =>
                  addLog("warn", "Auto-refresh prompts failed:", err)
                );
            }
          },
          wrapTransport: wrapTransport
            ? (transport: Transport) => {
                addLog(
                  "debug",
                  "Applying transport wrapper for server:",
                  serverName,
                  "url:",
                  url
                );
                return wrapTransport(transport, serverId ?? url);
              }
            : undefined,
        });

        // MCPClient owns protocol negotiation and any legacy initialization.
        // Modern connections remain stateless and are not initialized twice.
        const connection = await clientRef.current.connect(serverName);
        connectionRef.current = connection;

        if (!isMountedRef.current) {
          addLog(
            "debug",
            "Connection aborted after connection creation - component unmounted"
          );
          return "failed";
        }

        addLog("info", "✅ Successfully connected to MCP server");
        addLog("info", "Server info:", connection.info.server);
        addLog("info", "Server capabilities:", connection.info.capabilities);

        // Only set up monitoring if autoReconnect is enabled and health checks are not disabled
        if (
          autoReconnectConfig.enabled &&
          autoReconnectConfig.healthCheckInterval !== false
        ) {
          const cleanup = startConnectionHealthMonitoring({
            gatewayUrl,
            url,
            allHeaders,
            getAuthHeaders: async (): Promise<Record<string, string>> => {
              try {
                const tokens = await authProviderRef.current?.tokens?.();
                if (tokens?.access_token) {
                  const tokenType = tokens.token_type || "bearer";
                  return {
                    Authorization: `${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} ${tokens.access_token}`,
                  };
                }
              } catch {
                // Intentionally empty - fall through to return {}
              }
              return {};
            },
            isMountedRef,
            stateRef,
            autoReconnectRef,
            setState,
            addLog,
            connect,
            defaultReconnectDelay: autoReconnectConfig.initialDelay,
            healthCheckIntervalMs: autoReconnectConfig.healthCheckInterval,
            healthCheckTimeoutMs: autoReconnectConfig.healthCheckTimeout,
          });

          // Store cleanup function for later
          (connection as any)._healthCheckCleanup = cleanup;
        }

        // Track successful connection
        Tel.getInstance()
          .trackUseMcpConnection({
            url,
            transportType: transportTypeParam,
            success: true,
            hasOAuth: !!authProviderRef.current,
            hasSampling: hasSamplingCallbackRef.current,
            hasElicitation: hasElicitationCallbackRef.current,
          })
          .catch(() => {});

        // Get tools, resources, and prompts through the protocol-neutral connection.
        setTools(connection.tools || []);
        const [resourcesResult, promptsResult, templatesResult] =
          await Promise.all([
            connection.listAllResources(),
            connection.listPrompts(),
            connection.supports("resources")
              ? connection.listResourceTemplates()
              : Promise.resolve({ resourceTemplates: [] }),
          ]);
        if (!isMountedRef.current) {
          addLog(
            "debug",
            "Connection aborted after discovery - component unmounted"
          );
          return "failed";
        }
        setResources(resourcesResult.resources || []);
        setPrompts(promptsResult.prompts || []);
        setResourceTemplates(templatesResult.resourceTemplates || []);

        const {
          server: serverInfo,
          capabilities,
          protocolEra,
          protocolVersion,
          instructions,
          extensions,
        } = connection.info;

        // Surface normalized metadata identically for v1 and v2 servers.
        if (isMountedRef.current) {
          setProtocolEra(protocolEra);
          setProtocolVersion(protocolVersion);
          setInstructions(instructions);
          setExtensions(extensions);
        }

        if (serverInfo) {
          addLog("debug", "Server info:", serverInfo);
          if (!isMountedRef.current) {
            addLog("debug", "Skipping state update - component unmounted");
            return "failed";
          }
          setServerInfo(serverInfo);

          iconLoadingPromiseRef.current = loadServerIcon({
            serverInfo,
            url,
            isMounted: () => isMountedRef.current,
            setServerInfo,
            addLog,
          });
        }

        if (capabilities) {
          addLog("debug", "Server capabilities:", capabilities);
          if (!isMountedRef.current) {
            addLog("debug", "Skipping state update - component unmounted");
            return "failed";
          }
          setCapabilities(capabilities);
        }

        // Get OAuth tokens if authentication was used
        if (authProviderRef.current) {
          const tokens = await authProviderRef.current.tokens?.();
          if (!isMountedRef.current) {
            addLog(
              "debug",
              "Connection aborted after token fetch for auth tokens - component unmounted"
            );
            return "failed";
          }
          if (tokens?.access_token) {
            // Calculate expires_at from expires_in if available
            const expiresAt = tokens.expires_in
              ? Date.now() + tokens.expires_in * 1000
              : undefined;

            // Best-effort: resolve the OAuth token endpoint + client credentials
            // so consumers can persist them for server-side proactive refresh.
            // Never blocks auth.
            let tokenEndpoint: string | null = null;
            let resource: string | null = null;
            let clientCreds: {
              client_id: string;
              client_secret?: string;
            } | null = null;
            try {
              tokenEndpoint =
                (await authProviderRef.current.getTokenEndpoint?.()) ?? null;
            } catch {
              tokenEndpoint = null;
            }
            try {
              resource =
                (await authProviderRef.current.getResource?.()) ?? null;
            } catch {
              resource = null;
            }
            try {
              clientCreds =
                (await authProviderRef.current.getClientCredentials?.()) ??
                null;
            } catch {
              clientCreds = null;
            }

            if (!isMountedRef.current) {
              addLog("debug", "Skipping state update - component unmounted");
              return "failed";
            }
            setAuthTokens({
              access_token: tokens.access_token,
              token_type: tokens.token_type || "Bearer",
              expires_at: expiresAt,
              refresh_token: tokens.refresh_token,
              scope: tokens.scope,
              ...(tokenEndpoint ? { token_endpoint: tokenEndpoint } : {}),
              ...(resource ? { resource } : {}),
              ...(clientCreds?.client_id
                ? { client_id: clientCreds.client_id }
                : {}),
              ...(clientCreds?.client_secret
                ? { client_secret: clientCreds.client_secret }
                : {}),
            });
          }
        }

        successfulTransportRef.current = transportTypeParam;
        setState("ready");
        return "success";
      } catch (err: unknown) {
        const error = err as Error & { code?: number; message?: string };
        const errorMessage = error?.message || String(err);

        // A prepared authorization URL means OAuth discovery already succeeded on
        // an earlier pass. A later failure (token refresh, SSE fallback, or a
        // metadata probe that fell back to the transport origin) must NOT be
        // misclassified as "server does not support OAuth" — that drops us to
        // `failed` and hides the Authenticate button. When we already have a
        // stored auth URL and an OAuth provider, surface `pending_auth` instead.
        const preparedAuthUrl =
          authProviderRef.current?.getLastAttemptedAuthUrl?.();
        if (preparedAuthUrl && authProviderRef.current && preventAutoAuth) {
          addLog(
            "info",
            "OAuth already discovered (stored auth URL present); awaiting manual authentication."
          );
          if (isMountedRef.current) {
            setState("pending_auth");
            setAuthUrl(preparedAuthUrl);
          }
          connectingRef.current = false;
          return "auth_redirect";
        }

        // Check if OAuth discovery failed (indicates server doesn't support OAuth)
        // This happens when a 401 triggers OAuth discovery but the server has no OAuth endpoints
        const oauthDiscoveryFailed = isOAuthDiscoveryFailure(err);

        // Check if this is a 401 error
        const is401Error = isUnauthorized(err);

        // If OAuth discovery failed with custom headers provided, this was likely a 401 with wrong credentials
        // The error message might say "404" (from OAuth endpoint attempts) but the root cause was 401
        if (
          oauthDiscoveryFailed &&
          headers &&
          Object.keys(headers).length > 0
        ) {
          failConnection(
            "Authentication failed (HTTP 401). Server does not support OAuth. " +
              "Check your Authorization header value is correct."
          );
          return "failed";
        }

        // If OAuth discovery failed without custom headers, the server likely requires
        // authentication but doesn't support OAuth discovery
        // This handles cases where the server returns 401 but the error message shows "404"
        // from the OAuth endpoint attempts
        if (
          oauthDiscoveryFailed &&
          (!headers || Object.keys(headers).length === 0)
        ) {
          failConnection(
            "Authentication required (HTTP 401). Server does not support OAuth. " +
              "Add an Authorization header in the Custom Headers section " +
              "(e.g., Authorization: Bearer YOUR_API_KEY)."
          );
          return "failed";
        }

        // Handle 401 errors
        if (is401Error) {
          // If OAuth discovery failed, the server doesn't support OAuth
          // Show a clear message about this
          if (oauthDiscoveryFailed) {
            // No OAuth support and no custom headers - suggest adding API key
            failConnection(
              "Authentication required (HTTP 401). Server does not support OAuth. " +
                "Add an Authorization header in the Custom Headers section " +
                "(e.g., Authorization: Bearer YOUR_API_KEY)."
            );
            return "failed";
          }

          // OAuth discovery didn't fail, so OAuth might be available
          // Check if OAuth provider is configured
          if (authProviderRef.current) {
            // OAuth is configured
            addLog(
              "info",
              "Authentication required. OAuth provider available."
            );

            // Check if we should trigger auth automatically or wait for user
            if (preventAutoAuth) {
              // Don't trigger auth flow automatically - let the user click "Authenticate"
              // This prevents unnecessary metadata discovery requests that may fail with CORS/404
              addLog(
                "info",
                "Waiting for user to initiate authentication flow..."
              );

              if (isMountedRef.current) {
                setState("pending_auth");
                // Retrieve the stored auth URL if it was prepared during OAuth discovery
                const storedAuthUrl =
                  authProviderRef.current?.getLastAttemptedAuthUrl?.();
                if (storedAuthUrl) {
                  setAuthUrl(storedAuthUrl);
                  addLog(
                    "info",
                    "Retrieved stored auth URL for manual authentication"
                  );
                }
              }
              connectingRef.current = false;
              return "auth_redirect";
            } else {
              // preventAutoAuth is false - trigger auth flow automatically
              addLog(
                "info",
                "Triggering automatic OAuth authentication flow..."
              );

              try {
                // The SDK owns protected-resource discovery and parses the
                // original transport 401. Do not issue a duplicate probe.
                const authResult = await auth(authProviderRef.current, {
                  serverUrl: url,
                  fetchFn: authProviderRef.current.getProxyFetch?.(),
                });

                if (authResult === "REDIRECT") {
                  // Step 2: Get the authorization code that was captured during redirectToAuthorization
                  const authCode = await (
                    authProviderRef.current as any
                  ).getAuthorizationCode?.();
                  if (!authCode) {
                    throw new Error(
                      "Authorization code not captured by headless provider"
                    );
                  }

                  // Step 3: Complete the OAuth flow by exchanging code for tokens
                  await auth(authProviderRef.current, {
                    serverUrl: url,
                    authorizationCode: authCode,
                    fetchFn: authProviderRef.current.getProxyFetch?.(),
                  });
                }

                addLog("info", "OAuth flow completed, reconnecting...");
                // Reconnect after successful auth
                return await tryConnectWithTransport(transportTypeParam);
              } catch (authError) {
                const authErrorMessage =
                  authError instanceof Error
                    ? authError.message
                    : String(authError);
                failConnection(
                  `Automatic OAuth authentication failed: ${authErrorMessage}`,
                  authError instanceof Error
                    ? authError
                    : new Error(String(authError))
                );
                return "failed";
              }
            }
          }

          // Check if custom headers were provided (invalid credentials)
          if (headers && Object.keys(headers).length > 0) {
            failConnection(
              "Authentication failed: Server returned 401 Unauthorized. " +
                "Check your Authorization header value is correct."
            );
            return "failed";
          }

          // No OAuth and no custom headers - suggest adding them
          failConnection(
            "Authentication required: Server returned 401 Unauthorized. " +
              "Add an Authorization header in the Custom Headers section " +
              "(e.g., Authorization: Bearer YOUR_API_KEY)."
          );
          return "failed";
        }

        // Handle other errors
        const isRetryingWithProxy = failConnection(
          errorMessage,
          error instanceof Error ? error : new Error(String(error))
        );
        // If failConnection triggered automatic proxy fallback, return a special
        // status so the caller does not treat this as a hard connection failure
        return isRetryingWithProxy ? "auth_redirect" : "failed";
      }
    };

    let finalStatus: "success" | "auth_redirect" | "failed" | "fallback" =
      "failed";

    addLog("debug", "Connecting via streamable HTTP");
    finalStatus = await tryConnectWithTransport("http");

    // Reset connecting flag for all terminal states and auth_redirect
    // auth_redirect needs to reset the flag so the auth callback can reconnect
    if (
      finalStatus === "success" ||
      finalStatus === "failed" ||
      finalStatus === "auth_redirect"
    ) {
      connectingRef.current = false;
    }

    addLog("debug", `Connection sequence finished with status: ${finalStatus}`);
  }, [
    addLog,
    failConnection,
    disconnect,
    url,
    storageKeyPrefix,
    callbackUrl,
    oauthClientConfig.name,
    oauthClientConfig.version,
    oauthClientConfig.uri,
    oauthClientConfig.logo_uri,
    staticClientInfo,
    oauthClientMetadataUrl,
    oauthScope,
    headers,
    transportType,
    preventAutoAuth,
    useRedirectFlow,
    onPopupWindow,
    enabled,
    timeout,
    mergedClientInfo,
    effectiveClientOptions,
    protocolNegotiation,
    // IMPORTANT: Include proxy-related dependencies so connect() uses updated values after fallback
    gatewayUrl,
    oauthProxyUrlOption,
    allHeaders,
    effectiveOAuthUrl,
    // Stable reverse-request proxies (empty-deps useCallbacks). Listed for
    // correctness; their identities never change, so they do not reconnect.
    stableOnSampling,
    stableOnElicitation,
    stableOnNotification,
  ]);

  /**
   * Effect: Update function refs to prevent stale closures
   * Used by retry and OAuth callback handlers
   */
  useEffect(() => {
    connectRef.current = connect;
    failConnectionRef.current = failConnection;
  }, [connect, failConnection]);

  /**
   * Retry connection after failure
   * Only works if current state is 'failed'
   * Note: Uses connectRef to avoid circular dependency with connect
   */
  const retry = useCallback(() => {
    if (stateRef.current === "failed") {
      addLog("info", "Retry requested...");
      // Use connectRef to avoid circular dependency
      // connectRef is kept updated via useEffect
      connectRef.current?.();
    } else {
      addLog(
        "warn",
        `Retry called but state is not 'failed' (state: ${stateRef.current}). Ignoring.`
      );
    }
  }, [addLog]);

  /**
   * Trigger manual OAuth authentication flow
   *
   * Opens OAuth popup for user authorization. Use when state is 'pending_auth'
   * or to manually retry authentication.
   *
   * @example
   * ```typescript
   * if (mcp.state === 'pending_auth') {
   *   mcp.authenticate()  // Opens OAuth popup
   * }
   * ```
   */
  const authenticate = useCallback(async () => {
    addLog("info", "Manual authentication requested...");
    const currentState = stateRef.current;

    if (currentState === "failed") {
      addLog("info", "Attempting to reconnect and authenticate via retry...");
      retry();
    } else if (currentState === "pending_auth") {
      addLog("info", "Proceeding with authentication from pending state...");

      try {
        assert(
          authProviderRef.current,
          "Auth Provider not available for manual auth"
        );
        assert(url, "Server URL is required for authentication");

        if (providedAuthProvider) {
          addLog(
            "info",
            "Using provided authProvider for manual authentication"
          );
          const parsedUrl = new URL(url);
          const baseUrl =
            parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, "");
          await auth(authProviderRef.current, {
            serverUrl: baseUrl,
            fetchFn: authProviderRef.current.getProxyFetch?.(),
          });
          connectRef.current?.();
          return;
        }

        // Clear OAuth storage to ensure fresh authentication flow.
        // This is an explicit, user-initiated "authenticate" action (not a
        // lifecycle event), so wiping stale tokens/verifier here is correct.
        const clearedCount = authProviderRef.current.clearStorage?.() ?? 0;
        addLog(
          "info",
          `Cleared ${clearedCount} OAuth storage item(s) for fresh authentication`
        );

        // Update state to authenticating before redirect
        setState("authenticating");

        // Capture the popup handle and OAuth `state` as the provider opens the
        // popup, so the opener (this window) can own the flow's lifecycle via
        // runAuthPopup() instead of waiting indefinitely for a push message.
        let capturedPopup: globalThis.Window | null = null;
        let capturedState: string | null = null;
        const captureOnPopupWindow = (
          popupUrl: string,
          features: string,
          popupWin: globalThis.Window | null
        ) => {
          capturedPopup = popupWin;
          try {
            capturedState = new URL(popupUrl).searchParams.get("state");
          } catch {
            /* non-fatal: fall back to provider's last auth URL below */
          }
          onPopupWindow?.(popupUrl, features, popupWin);
        };

        // Recreate the auth provider WITHOUT preventAutoAuth.
        // proxyOAuthRequests is always true: the scoped OAuth proxy fetch is
        // the sole browser-CORS mechanism (the gateway no longer fronts OAuth
        // metadata — it broke RFC 8414 §3.3 issuer validation for strict
        // clients). It is a no-op when no OAuth proxy URL is configured.
        const { provider: freshAuthProvider, oauthProxyUrl } =
          createBrowserOAuthProvider({
            effectiveOAuthUrl,
            storageKeyPrefix,
            oauthClientConfig,
            callbackUrl,
            preventAutoAuth: false,
            useRedirectFlow,
            gatewayUrl,
            oauthProxyUrl: oauthProxyUrlOption,
            onPopupWindow: captureOnPopupWindow,
            proxyOAuthRequests: true,
            staticClientInfo,
            clientMetadataUrl: oauthClientMetadataUrl,
            scope: oauthScope,
          });

        if (oauthProxyUrl) {
          addLog("info", "Scoped OAuth proxy fetch enabled for manual auth");
        }

        // Replace the auth provider
        authProviderRef.current = freshAuthProvider;

        addLog("info", "Triggering fresh OAuth authorization...");

        // Generate a fresh authorization URL and open the popup/redirect.
        // The provider redirects/popups automatically (preventAutoAuth: false).
        const parsedUrl = new URL(url);
        const baseUrl =
          parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, "");
        const authResult = await auth(freshAuthProvider, {
          serverUrl: baseUrl,
          fetchFn: freshAuthProvider.getProxyFetch?.(),
        });

        if (authResult === "AUTHORIZED") {
          addLog("info", "OAuth flow completed (tokens obtained)");
          connectingRef.current = false;
          connectRef.current?.();
          return;
        }

        if (authResult !== "REDIRECT") {
          throw new Error(`Unexpected OAuth auth() result: ${authResult}`);
        }

        addLog("info", "OAuth authorization redirect initiated");

        // Update authUrl with the new URL from the fresh provider
        // This is critical for the fallback link when popup is blocked
        const newAuthUrl = freshAuthProvider.getLastAttemptedAuthUrl?.();
        if (newAuthUrl) {
          setAuthUrl(newAuthUrl);
          addLog("info", "Updated auth URL for fallback:", newAuthUrl);
          if (!capturedState) {
            try {
              capturedState = new URL(newAuthUrl).searchParams.get("state");
            } catch {
              /* leave null; runAuthPopup accepts state-less results */
            }
          }
        }

        // Redirect flow navigates the whole page away — nothing to await here.
        if (useRedirectFlow) {
          return;
        }

        // Opener-owned popup flow: own the lifecycle so we can never get stuck
        // in "authenticating". Settles on result message / popup close / token
        // storage write / timeout (see runAuthPopup).
        const tokensKey = freshAuthProvider.getKey?.("tokens");
        if (!tokensKey) {
          // Without a tokens key we can't run the supervised flow; fall back to
          // the always-on listener and leave state as authenticating.
          addLog(
            "warn",
            "Could not derive tokens storage key; relying on callback listener."
          );
          return;
        }

        popupFlowActiveRef.current = true;
        let result;
        try {
          result = await runAuthPopup({
            popup: capturedPopup,
            state: capturedState,
            tokensKey,
          });
        } finally {
          popupFlowActiveRef.current = false;
        }

        if (!isMountedRef.current) return;

        switch (result.kind) {
          case "success":
            addLog(
              "info",
              "Authentication succeeded; reconnecting to MCP server..."
            );
            connectingRef.current = false;
            connectRef.current?.();
            break;
          case "cancelled":
            addLog(
              "warn",
              "Authentication popup was closed before completing. Returning to pending_auth."
            );
            setState("pending_auth");
            break;
          case "timeout":
            addLog(
              "warn",
              "Authentication timed out waiting for the popup. Returning to pending_auth."
            );
            setState("pending_auth");
            break;
          case "error":
            failConnection(`Authentication failed: ${result.error}`);
            break;
          default:
            // Exhaustive over AuthPopupResult["kind"]; nothing to do.
            break;
        }
      } catch (authError) {
        if (!isMountedRef.current) return;
        const error =
          authError instanceof Error ? authError : new Error(String(authError));
        failConnection(`Manual authentication failed: ${error.message}`, error);
      }
    } else if (currentState === "authenticating") {
      addLog(
        "warn",
        "Already attempting authentication. Check for blocked popups or wait for timeout."
      );
      const manualUrl = authProviderRef.current?.getLastAttemptedAuthUrl?.();
      if (manualUrl && !authUrl) {
        setAuthUrl(manualUrl);
        addLog("info", "Manual authentication URL retrieved:", manualUrl);
      }
    } else {
      addLog(
        "info",
        `Client not in a state requiring manual authentication trigger (state: ${currentState}). If needed, try disconnecting and reconnecting.`
      );
    }
  }, [
    addLog,
    retry,
    failConnection,
    authUrl,
    url,
    useRedirectFlow,
    onPopupWindow,
    storageKeyPrefix,
    oauthClientConfig.name,
    oauthClientConfig.uri,
    oauthClientConfig.logo_uri,
    staticClientInfo,
    oauthClientMetadataUrl,
    oauthScope,
    callbackUrl,
    mergedClientInfo,
    providedAuthProvider,
  ]);

  /**
   * Clear OAuth tokens from localStorage and disconnect
   *
   * Useful for logging out or resetting authentication state.
   *
   * @example
   * ```typescript
   * mcp.clearStorage()  // Removes tokens and disconnects
   * ```
   */
  const clearStorage = useCallback(() => {
    if (authProviderRef.current?.clearStorage) {
      const count = authProviderRef.current.clearStorage();
      addLog("info", `Cleared ${count} item(s) from localStorage for ${url}.`);
      setAuthUrl(undefined);
      disconnect();
    } else {
      addLog("warn", "Auth provider not initialized, cannot clear storage.");
    }
  }, [url, addLog, disconnect]);

  // ===== Effects =====

  /**
   * Effect: Listen for OAuth callback messages from popup window
   *
   * Subscribes to two transports for the same `mcp_auth_callback` payload:
   * - `window.message` (postMessage from `window.opener`): the happy path
   *   when the popup retained its opener reference.
   * - `BroadcastChannel("mcp_auth_callback")`: same-origin fallback used by
   *   the popup callback when `window.opener` has been severed by COOP,
   *   cross-origin intermediate redirects, or browser tab grouping.
   *   Without this, a popup that completes auth but lost its opener leaves
   *   the parent stuck in `authenticating` forever.
   *
   * The popup only emits over one transport per callback, so the two
   * listeners don't double-fire on a single auth completion.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleCallbackPayload = (
      payload: McpAuthCallbackMessage | undefined,
      source: "postMessage" | "BroadcastChannel"
    ) => {
      // Defer to runAuthPopup while a manual authenticate() flow owns the
      // result, so a single completion doesn't trigger two reconnects.
      if (popupFlowActiveRef.current) {
        addLog(
          "debug",
          `Ignoring auth callback via ${source}; manual popup flow owns this result.`
        );
        return;
      }

      // Scope the result to this server. The callback page stamps the payload
      // with the originating server's URL hash; ignore results for other
      // servers so unrelated useMcp instances don't all reconnect at once.
      // Payloads without a hash (older callback pages) are accepted.
      const ourHash = authProviderRef.current?.serverUrlHash;
      if (
        payload?.serverUrlHash &&
        ourHash &&
        payload.serverUrlHash !== ourHash
      ) {
        addLog(
          "debug",
          `Ignoring auth callback via ${source} for a different server.`
        );
        return;
      }

      addLog("info", `Received auth callback via ${source}.`, payload);
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;

      if (payload?.success) {
        addLog(
          "info",
          "Authentication successful via popup. Reconnecting client..."
        );

        // Check if already connecting
        if (connectingRef.current) {
          addLog(
            "debug",
            "Connection attempt already in progress, resetting flag to allow reconnection."
          );
        }

        // Reset the connecting flag and reconnect since auth just succeeded
        connectingRef.current = false;

        // Small delay to ensure state is clean before reconnecting
        setTimeout(() => {
          if (isMountedRef.current) {
            addLog(
              "debug",
              "Initiating reconnection after successful auth callback."
            );
            connectRef.current?.();
          }
        }, 100);
      } else {
        // Don't clobber a connection that already became ready (or moved on):
        // a late/duplicate failure message must not knock a healthy client
        // back to "failed".
        if (
          stateRef.current !== "authenticating" &&
          stateRef.current !== "pending_auth"
        ) {
          addLog(
            "debug",
            `Ignoring stale auth failure callback (state=${stateRef.current}).`
          );
          return;
        }
        failConnectionRef.current?.(
          `Authentication failed in callback: ${payload?.error || "Unknown reason."}`
        );
      }
    };

    const messageHandler = (event: globalThis.MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== MCP_AUTH_CALLBACK_MESSAGE_TYPE) return;
      handleCallbackPayload(event.data, "postMessage");
    };
    window.addEventListener("message", messageHandler);
    addLog("debug", "Auth callback message listener added.");

    let broadcastChannel: BroadcastChannel | null = null;
    const broadcastHandler = (event: MessageEvent) => {
      if (event.data?.type !== MCP_AUTH_CALLBACK_MESSAGE_TYPE) return;
      handleCallbackPayload(event.data, "BroadcastChannel");
    };
    if (typeof BroadcastChannel !== "undefined") {
      try {
        broadcastChannel = new BroadcastChannel(MCP_AUTH_BROADCAST_CHANNEL);
        broadcastChannel.addEventListener("message", broadcastHandler);
        addLog("debug", "Auth callback BroadcastChannel listener added.");
      } catch (e) {
        addLog(
          "warn",
          "Failed to open auth callback BroadcastChannel; lost-opener popups will not reach this client.",
          e as Error
        );
        broadcastChannel = null;
      }
    }

    return () => {
      window.removeEventListener("message", messageHandler);
      addLog("debug", "Auth callback message listener removed.");
      if (broadcastChannel) {
        try {
          broadcastChannel.removeEventListener("message", broadcastHandler);
          broadcastChannel.close();
        } catch {
          /* ignore */
        }
        addLog("debug", "Auth callback BroadcastChannel listener removed.");
      }
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
    };
  }, [addLog]);

  /**
   * Effect: Main connection lifecycle
   *
   * Runs on mount and when key connection parameters change.
   * - Initializes OAuth provider
   * - Initiates connection
   * - Cleans up on unmount or when URL changes
   */
  useEffect(() => {
    isMountedRef.current = true;

    // Skip connection if disabled or no URL provided
    if (!enabled || !url) {
      addLog(
        "debug",
        enabled
          ? "No server URL provided, skipping connection."
          : "Connection disabled via enabled flag."
      );
      setState("discovering");
      return () => {
        isMountedRef.current = false;
      };
    }

    addLog("debug", "useMcp mounted, initiating connection.");
    connectAttemptRef.current = 0;
    if (providedAuthProvider) {
      authProviderRef.current = providedAuthProvider as UseMcpAuthProvider;
      addLog("debug", "Using externally provided authProvider");
    } else if (
      !authProviderRef.current ||
      authProviderRef.current.serverUrl !== effectiveOAuthUrl
    ) {
      const { provider, oauthProxyUrl } = createBrowserOAuthProvider({
        effectiveOAuthUrl,
        storageKeyPrefix,
        oauthClientConfig,
        callbackUrl,
        preventAutoAuth,
        useRedirectFlow,
        gatewayUrl,
        oauthProxyUrl: oauthProxyUrlOption,
        onPopupWindow,
        proxyOAuthRequests: true,
        staticClientInfo,
        clientMetadataUrl: oauthClientMetadataUrl,
        scope: oauthScope,
      });
      authProviderRef.current = provider;
      if (oauthProxyUrl) {
        addLog("debug", `OAuth proxy URL in effect: ${oauthProxyUrl}`);
      }
      addLog(
        "debug",
        `BrowserOAuthClientProvider initialized/updated with URL: ${effectiveOAuthUrl}, proxy: ${oauthProxyUrl ? "enabled" : "disabled"}, gateway: ${gatewayUrl ? "enabled" : "disabled"}`
      );
    }
    connect();
    return () => {
      isMountedRef.current = false;
      addLog("debug", "useMcp unmounting, disconnecting.");

      // NOTE: We intentionally do NOT clear OAuth storage on unmount, even
      // mid-flow. Wrapper remounts (provider revision changes, route
      // churn, StrictMode double-mounting) would otherwise destroy the
      // in-flight authorization state record + PKCE verifier and strand a
      // popup that completes after the remount. Stale state records carry a
      // 10-minute TTL (enforced in callback.ts) and the PKCE verifier is
      // overwritten by `saveCodeVerifier()` on the next auth start, so leaving
      // them in place is safe. Tokens that land after a remount are picked up
      // by the state-keyed callback listener / storage event and the wrapper
      // reconnects cleanly. Explicit logout still clears storage via
      // `clearStorage()` / `removeServer(id, { clearCredentials: true })`.

      disconnect(true);
    };
  }, [
    url,
    enabled,
    storageKeyPrefix,
    callbackUrl,
    oauthClientConfig.name,
    oauthClientConfig.version,
    oauthClientConfig.uri,
    oauthClientConfig.logo_uri,
    staticClientInfo,
    oauthClientMetadataUrl,
    oauthScope,
    useRedirectFlow,
    mergedClientInfo,
    effectiveOAuthUrl, // Triggers reconnection when proxy fallback changes OAuth URL
    proxyConfig, // Triggers reconnection when proxy config (including headers) changes
    providedAuthProvider,
  ]);

  /**
   * Effect: Auto-retry on failure
   *
   * If autoRetry is enabled and connection fails, automatically retries
   * after the specified delay.
   * Uses a ref to prevent duplicate scheduling which can cause render loops.
   */
  const retryRef = useRef(retry);
  const addLogRef = useRef(addLog);

  useEffect(() => {
    retryRef.current = retry;
    addLogRef.current = addLog;
  }, [retry, addLog]);

  useEffect(() => {
    let retryTimeoutId: number | null = null;

    if (state === "failed" && autoRetry && connectAttemptRef.current > 0) {
      // Prevent duplicate scheduling - only schedule if not already scheduled
      if (!retryScheduledRef.current) {
        retryScheduledRef.current = true;
        const delay =
          typeof autoRetry === "number" ? autoRetry : DEFAULT_RETRY_DELAY;
        addLogRef.current(
          "info",
          `Connection failed, auto-retrying in ${delay}ms...`
        );
        retryTimeoutId = setTimeout(() => {
          retryScheduledRef.current = false;
          if (isMountedRef.current && stateRef.current === "failed") {
            retryRef.current();
          }
        }, delay) as any;
      }
    } else if (state !== "failed") {
      // Reset the ref when not in failed state
      retryScheduledRef.current = false;
    }

    return () => {
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
        retryScheduledRef.current = false;
      }
    };
  }, [state, autoRetry]);

  /**
   * Ensure the server icon is loaded and available
   * Waits for the background icon loading to complete
   *
   * @returns Promise that resolves with the base64 icon or null
   */
  const ensureIconLoaded = useCallback(async (): Promise<string | null> => {
    if (stateRef.current !== "ready") {
      addLog("warn", "Cannot ensure icon loaded - not connected");
      return null;
    }

    // If icon is already available, return it immediately
    if (serverInfo?.icon) {
      return serverInfo.icon;
    }

    // If icon loading is in progress, wait for it
    if (iconLoadingPromiseRef.current) {
      addLog("debug", "Waiting for icon to finish loading...");
      const icon = await iconLoadingPromiseRef.current;
      return icon;
    }

    // No icon loading in progress and no icon available
    addLog("debug", "No icon available and no loading in progress");
    return null;
  }, [serverInfo, addLog]);

  return {
    state,
    name: serverInfo?.name || url || "",
    tools,
    resources,
    resourceTemplates,
    prompts,
    serverInfo,
    capabilities,
    protocolEra,
    protocolVersion,
    instructions,
    extensions,
    error,
    log,
    authUrl,
    authTokens,
    client: clientRef.current,
    ...connectionOperations,
    retry,
    disconnect,
    authenticate,
    clearStorage,
    ensureIconLoaded,
  };
}
