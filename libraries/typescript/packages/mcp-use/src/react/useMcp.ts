// useMcp.ts
import type {
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserOAuthClientProvider } from "../auth/browser-provider.js";
import { BrowserMCPClient } from "../client/browser.js";
import { Tel } from "../telemetry/telemetry-browser.js";
import { assert } from "../utils/assert.js";
import { detectFavicon } from "../utils/favicon-detector.js";
import { applyProxyConfig } from "../utils/proxy-config.js";
import { sanitizeUrl } from "../utils/url-sanitize.js";
import type { UseMcpOptions, UseMcpResult } from "./types.js";

const DEFAULT_RECONNECT_DELAY = 3000;
const DEFAULT_RETRY_DELAY = 5000;

// Define Transport types literal for clarity
type TransportType = "http" | "sse";

/**
 * React hook for connecting to and interacting with MCP servers
 *
 * Provides a complete interface for MCP server connections including:
 * - Automatic connection management with reconnection
 * - OAuth authentication with automatic token refresh
 * - Tool, resource, and prompt access
 * - AI chat functionality with conversation memory
 * - Multi-transport support (HTTP, SSE) with automatic fallback
 *
 * @param options - Configuration options for the MCP connection
 * @returns MCP connection state and methods
 *
 * @example
 * ```typescript
 * const mcp = useMcp({
 *   url: 'http://localhost:3000/mcp',
 *   customHeaders: { Authorization: 'Bearer YOUR_API_KEY' }
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
export function useMcp(options: UseMcpOptions): UseMcpResult {
  const {
    url,
    enabled = true,
    callbackUrl = typeof window !== "undefined"
      ? sanitizeUrl(
          new URL("/oauth/callback", window.location.origin).toString()
        )
      : "/oauth/callback",
    storageKeyPrefix = "mcp:auth",
    clientConfig = {},
    customHeaders = {},
    proxyConfig,
    debug: _debug = false,
    autoRetry = false,
    autoReconnect = DEFAULT_RECONNECT_DELAY,
    transportType = "auto",
    preventAutoAuth = false, // Default to false for backward compatibility (auto-trigger OAuth)
    useRedirectFlow = false, // Default to false for backward compatibility (use popup)
    onPopupWindow,
    timeout = 30000, // 30 seconds default for connection timeout
    sseReadTimeout = 300000, // 5 minutes default for SSE read timeout
    wrapTransport,
    onNotification,
    samplingCallback,
    onElicitation,
  } = options;

  // Apply proxy configuration if provided
  const { url: finalUrl, headers: proxyHeaders } = useMemo(
    () => applyProxyConfig(url || "", proxyConfig),
    [url, proxyConfig]
  );

  // Merge proxy headers with custom headers (custom headers take precedence)
  const allHeaders = useMemo(
    () => ({ ...proxyHeaders, ...customHeaders }),
    [proxyHeaders, customHeaders]
  );

  const [state, setState] = useState<UseMcpResult["state"]>("discovering");
  const [tools, setTools] = useState<Tool[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceTemplates, setResourceTemplates] = useState<
    ResourceTemplate[]
  >([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [serverInfo, setServerInfo] = useState<UseMcpResult["serverInfo"]>();
  const [capabilities, setCapabilities] = useState<Record<string, any>>();
  const [error, setError] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<UseMcpResult["log"]>([]);
  const [authUrl, setAuthUrl] = useState<string | undefined>(undefined);
  const [authTokens, setAuthTokens] =
    useState<UseMcpResult["authTokens"]>(undefined);

  const clientRef = useRef<BrowserMCPClient | null>(null);
  const authProviderRef = useRef<BrowserOAuthClientProvider | null>(null);
  const iconLoadingPromiseRef = useRef<Promise<string | null> | null>(null);
  const connectingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const connectAttemptRef = useRef<number>(0);
  const authTimeoutRef = useRef<number | null>(null);
  const retryScheduledRef = useRef<boolean>(false);

  // --- Refs for values used in callbacks ---
  const stateRef = useRef(state);
  const autoReconnectRef = useRef(autoReconnect);
  const successfulTransportRef = useRef<TransportType | null>(null);
  // Forward refs for functions (declared later) to avoid circular dependencies
  const connectRef = useRef<(() => Promise<void>) | null>(null);
  const failConnectionRef = useRef<
    ((message: string, error?: Error) => void) | null
  >(null);

  /**
   * Effect: Keep refs in sync with state values
   * Allows callbacks to access latest state without re-creating them
   */
  useEffect(() => {
    stateRef.current = state;
    autoReconnectRef.current = autoReconnect;
  }, [state, autoReconnect]);

  // --- Stable Callbacks ---
  /**
   * Add a log entry to the connection log
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
      console[level](`[useMcp] ${fullMessage}`);
      if (isMountedRef.current) {
        setLog((prevLog) => [
          ...prevLog.slice(-100),
          { level, message: fullMessage, timestamp: Date.now() },
        ]);
      }
    },
    []
  );

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

      if (clientRef.current) {
        try {
          const serverName = "inspector-server";
          const session = clientRef.current.getSession(serverName);

          // Clean up health check monitoring if it exists
          if (session && (session as any)._healthCheckCleanup) {
            (session as any)._healthCheckCleanup();
            (session as any)._healthCheckCleanup = null;
          }

          await clientRef.current.closeSession(serverName);
        } catch (err) {
          if (!quiet) addLog("warn", "Error closing session:", err);
        }
      }
      clientRef.current = null;

      if (isMountedRef.current && !quiet) {
        setState("discovering");
        setTools([]);
        setResources([]);
        setResourceTemplates([]);
        setPrompts([]);
        setError(undefined);
        setAuthUrl(undefined);
      }
    },
    [addLog]
  );

  /**
   * Mark connection as failed with an error message
   * @internal
   */
  const failConnection = useCallback(
    (errorMessage: string, connectionError?: Error) => {
      addLog("error", errorMessage, connectionError ?? "");
      if (isMountedRef.current) {
        setState("failed");
        setError(errorMessage);
        const manualUrl = authProviderRef.current?.getLastAttemptedAuthUrl();
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
            hasSampling: !!samplingCallback,
            hasElicitation: !!onElicitation,
          })
          .catch(() => {});
      }
    },
    [addLog, url, transportType, samplingCallback, onElicitation]
  );

  /**
   * Connect to the MCP server
   * Automatically retries with transport fallback (HTTP → SSE)
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
    connectAttemptRef.current += 1;
    setError(undefined);
    setAuthUrl(undefined);
    successfulTransportRef.current = null;
    setState("discovering");
    addLog(
      "info",
      `Connecting attempt #${connectAttemptRef.current} to ${url}...`
    );

    if (!authProviderRef.current) {
      authProviderRef.current = new BrowserOAuthClientProvider(url, {
        storageKeyPrefix,
        clientName: clientConfig.name,
        clientUri: clientConfig.uri,
        logoUri: clientConfig.logo_uri || "https://mcp-use.com/logo.png",
        callbackUrl,
        preventAutoAuth,
        useRedirectFlow,
        onPopupWindow,
      });
      addLog("debug", "BrowserOAuthClientProvider initialized in connect.");
    }
    if (!clientRef.current) {
      clientRef.current = new BrowserMCPClient();
      addLog("debug", "BrowserMCPClient initialized in connect.");
    }

    const tryConnectWithTransport = async (
      transportTypeParam: TransportType,
      isAuthRetry = false
    ): Promise<"success" | "fallback" | "auth_redirect" | "failed"> => {
      addLog(
        "info",
        `Attempting connection with transport: ${transportTypeParam}`
      );

      try {
        const serverName = "inspector-server";

        // Build server config
        const serverConfig: any = {
          url: finalUrl,
          transport: transportTypeParam === "sse" ? "http" : transportTypeParam,
          // Disable SSE fallback when using explicit HTTP transport (not SSE)
          // This prevents automatic HTTP → SSE fallback at the connector level
          disableSseFallback: transportTypeParam === "http",
          // Use SSE transport when explicitly requested
          preferSse: transportTypeParam === "sse",
        };

        // Add custom headers if provided (includes proxy headers)
        if (allHeaders && Object.keys(allHeaders).length > 0) {
          serverConfig.headers = allHeaders;
        }

        // Add OAuth token if available
        if (authProviderRef.current) {
          const tokens = await authProviderRef.current.tokens();
          if (tokens?.access_token) {
            serverConfig.headers = {
              ...serverConfig.headers,
              Authorization: `Bearer ${tokens.access_token}`,
            };
          }
        }

        // Add server to client with OAuth provider
        // Include wrapTransport if provided
        // Pass clientConfig as clientOptions so connector can set up capabilities
        clientRef.current!.addServer(serverName, {
          ...serverConfig,
          authProvider: authProviderRef.current, // ← SDK handles OAuth automatically!
          clientOptions: clientConfig, // ← Pass client config to connector
          samplingCallback: samplingCallback, // ← Pass sampling callback to connector
          elicitationCallback: onElicitation, // ← Pass elicitation callback to connector
          wrapTransport: wrapTransport
            ? (transport: any) => {
                console.log(
                  "[useMcp] Applying transport wrapper for server:",
                  serverName,
                  "url:",
                  url
                );
                return wrapTransport(transport, url);
              }
            : undefined,
        });

        // Create session WITHOUT auto-initialization
        // This allows us to register the notification handler BEFORE connecting
        const session = await clientRef.current!.createSession(
          serverName,
          false
        );

        // Wire up notification handler BEFORE initializing
        // This ensures the handler is registered before setupNotificationHandler() is called during connect()
        session.on("notification", (notification) => {
          // Call user's callback first
          onNotification?.(notification);

          // Auto-refresh lists on list_changed notifications
          if (notification.method === "notifications/tools/list_changed") {
            addLog("info", "Tools list changed, auto-refreshing...");
            refreshTools().catch((err) =>
              addLog("warn", "Auto-refresh tools failed:", err)
            );
          } else if (
            notification.method === "notifications/resources/list_changed"
          ) {
            addLog("info", "Resources list changed, auto-refreshing...");
            refreshResources().catch((err) =>
              addLog("warn", "Auto-refresh resources failed:", err)
            );
          } else if (
            notification.method === "notifications/prompts/list_changed"
          ) {
            addLog("info", "Prompts list changed, auto-refreshing...");
            refreshPrompts().catch((err) =>
              addLog("warn", "Auto-refresh prompts failed:", err)
            );
          }
        });

        // Now initialize the session (this connects to server and caches tools, resources, prompts)
        await session.initialize();

        addLog("info", "✅ Successfully connected to MCP server");
        addLog("info", "Server info:", session.connector.serverInfo);
        addLog(
          "info",
          "Server capabilities:",
          session.connector.serverCapabilities
        );
        console.log("[useMcp] Server info:", session.connector.serverInfo);
        console.log(
          "[useMcp] Server capabilities:",
          session.connector.serverCapabilities
        );
        setState("ready");
        successfulTransportRef.current = transportTypeParam;

        // Set up connection health monitoring
        // This detects when the SSE stream is broken (e.g., server restart) and triggers reconnection
        const setupConnectionMonitoring = () => {
          let healthCheckInterval: NodeJS.Timeout | null = null;
          let lastSuccessfulCheck = Date.now();
          const HEALTH_CHECK_INTERVAL = 10000; // Check every 10 seconds
          const HEALTH_CHECK_TIMEOUT = 30000; // Consider dead after 30 seconds of no response

          const checkConnectionHealth = async () => {
            if (!isMountedRef.current || stateRef.current !== "ready") {
              if (healthCheckInterval) {
                clearInterval(healthCheckInterval);
                healthCheckInterval = null;
              }
              return;
            }

            try {
              // Try a simple operation to verify the connection is alive
              // We use listTools as a lightweight health check
              await session.connector.listTools();
              lastSuccessfulCheck = Date.now();
            } catch (err) {
              const timeSinceLastSuccess = Date.now() - lastSuccessfulCheck;

              // If we haven't had a successful check in a while, consider connection dead
              if (timeSinceLastSuccess > HEALTH_CHECK_TIMEOUT) {
                addLog(
                  "warn",
                  `Connection appears to be broken (no response for ${Math.round(timeSinceLastSuccess / 1000)}s), attempting to reconnect...`
                );

                if (healthCheckInterval) {
                  clearInterval(healthCheckInterval);
                  healthCheckInterval = null;
                }

                // Trigger reconnection if autoReconnect is enabled
                if (autoReconnectRef.current && isMountedRef.current) {
                  setState("discovering");
                  addLog("info", "Auto-reconnecting to MCP server...");

                  // Small delay before reconnecting
                  setTimeout(
                    () => {
                      if (
                        isMountedRef.current &&
                        stateRef.current === "discovering"
                      ) {
                        connect();
                      }
                    },
                    typeof autoReconnectRef.current === "number"
                      ? autoReconnectRef.current
                      : DEFAULT_RECONNECT_DELAY
                  );
                }
              }
            }
          };

          // Start health check interval
          healthCheckInterval = setInterval(
            checkConnectionHealth,
            HEALTH_CHECK_INTERVAL
          );

          // Return cleanup function
          return () => {
            if (healthCheckInterval) {
              clearInterval(healthCheckInterval);
              healthCheckInterval = null;
            }
          };
        };

        // Only set up monitoring if autoReconnect is enabled
        if (autoReconnect) {
          const cleanup = setupConnectionMonitoring();

          // Store cleanup function for later
          (session as any)._healthCheckCleanup = cleanup;
        }

        // Track successful connection
        Tel.getInstance()
          .trackUseMcpConnection({
            url,
            transportType: transportTypeParam,
            success: true,
            hasOAuth: !!authProviderRef.current,
            hasSampling: !!samplingCallback,
            hasElicitation: !!onElicitation,
          })
          .catch(() => {});

        // Get tools, resources, prompts from session connector
        setTools(session.connector.tools || []);
        const resourcesResult = await session.connector.listAllResources();
        setResources(resourcesResult.resources || []);
        const promptsResult = await session.connector.listPrompts();
        setPrompts(promptsResult.prompts || []);

        // Get serverInfo and capabilities from the connector (populated during initialize)
        const serverInfo = session.connector.serverInfo;
        const capabilities = session.connector.serverCapabilities;

        if (serverInfo) {
          console.log("[useMcp] Server info:", serverInfo);
          setServerInfo(serverInfo);

          // Start icon loading in background and store the promise
          const loadIconPromise = (async () => {
            try {
              // Check if server provided icons in the serverInfo
              const serverIcons = (serverInfo as any).icons;
              if (
                serverIcons &&
                Array.isArray(serverIcons) &&
                serverIcons.length > 0
              ) {
                // Server provided icons - use the first one
                const iconUrl = serverIcons[0].src || serverIcons[0].url;
                if (iconUrl) {
                  addLog("info", "Server provided icon:", iconUrl);
                  // Fetch and convert to base64 for storage
                  const res = await fetch(iconUrl);
                  const blob = await res.blob();
                  const base64 = await new Promise<string>(
                    (resolve, reject) => {
                      const reader = new FileReader();
                      reader.onloadend = () => resolve(reader.result as string);
                      reader.onerror = reject;
                      reader.readAsDataURL(blob);
                    }
                  );

                  if (isMountedRef.current) {
                    setServerInfo((prev) =>
                      prev ? { ...prev, icon: base64 } : undefined
                    );
                    addLog("debug", "Server icon converted to base64");
                  }
                  return base64;
                }
              }

              // No server-provided icons - try auto-detection
              if (url) {
                const faviconBase64 = await detectFavicon(url);
                if (faviconBase64 && isMountedRef.current) {
                  setServerInfo((prev) =>
                    prev ? { ...prev, icon: faviconBase64 } : undefined
                  );
                  addLog("debug", "Favicon detected and added to serverInfo");
                  return faviconBase64;
                }
              }

              return null;
            } catch (err) {
              addLog("debug", "Icon loading failed (non-critical):", err);
              return null;
            }
          })();

          // Store the promise so ensureIconLoaded() can await it
          iconLoadingPromiseRef.current = loadIconPromise;
        }

        if (capabilities) {
          console.log("[useMcp] Server capabilities:", capabilities);
          setCapabilities(capabilities);
        }

        // Get OAuth tokens if authentication was used
        if (authProviderRef.current) {
          const tokens = await authProviderRef.current.tokens();
          if (tokens?.access_token) {
            // Calculate expires_at from expires_in if available
            const expiresAt = tokens.expires_in
              ? Date.now() + tokens.expires_in * 1000
              : undefined;

            setAuthTokens({
              access_token: tokens.access_token,
              token_type: tokens.token_type || "Bearer",
              expires_at: expiresAt,
              refresh_token: tokens.refresh_token,
              scope: tokens.scope,
            });
          }
        }

        return "success";
      } catch (err: unknown) {
        const error = err as Error & { code?: number; message?: string };
        const errorMessage = error?.message || String(err);

        // Handle 401 errors
        if (
          error.code === 401 ||
          errorMessage.includes("401") ||
          errorMessage.includes("Unauthorized")
        ) {
          // Check if OAuth provider is configured
          if (authProviderRef.current) {
            // OAuth is configured - enter pending_auth state
            addLog(
              "info",
              "Authentication required. OAuth provider available."
            );

            // Generate auth URL manually since SDK didn't trigger it
            // This happens because 401 occurs before OAuth flow starts
            try {
              const { auth } =
                await import("@mcp-use/modelcontextprotocol-sdk/client/auth.js");
              const baseUrl = new URL(url).origin;

              // Trigger auth to generate the URL, but it will be blocked by preventAutoAuth
              // This ensures the URL gets prepared and stored
              auth(authProviderRef.current, { serverUrl: baseUrl }).catch(
                () => {
                  // Expected to fail/stop - we just want the URL prepared
                }
              );

              // Give it a moment to prepare the URL
              setTimeout(() => {
                if (isMountedRef.current) {
                  const manualUrl =
                    authProviderRef.current?.getLastAttemptedAuthUrl();
                  if (manualUrl) {
                    setAuthUrl(manualUrl);
                    addLog(
                      "info",
                      "Manual authentication URL available:",
                      manualUrl
                    );
                  } else {
                    addLog("warn", "Could not generate authentication URL");
                  }
                }
              }, 100);
            } catch (authGenError) {
              addLog("warn", "Error generating auth URL:", authGenError);
            }

            if (isMountedRef.current) {
              setState("pending_auth");
            }
            connectingRef.current = false;
            return "auth_redirect";
          }

          // Check if custom headers were provided (invalid credentials)
          if (customHeaders && Object.keys(customHeaders).length > 0) {
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
        failConnection(
          errorMessage,
          error instanceof Error ? error : new Error(String(error))
        );
        return "failed";
      }
    };

    let finalStatus: "success" | "auth_redirect" | "failed" | "fallback" =
      "failed";

    if (transportType === "sse") {
      addLog("debug", "Using SSE-only transport mode");
      finalStatus = await tryConnectWithTransport("sse");
    } else if (transportType === "http") {
      addLog("debug", "Using HTTP-only transport mode");
      finalStatus = await tryConnectWithTransport("http");
    } else {
      addLog("debug", "Using auto transport mode (HTTP with SSE fallback)");
      const httpResult = await tryConnectWithTransport("http");

      if (
        httpResult === "fallback" &&
        isMountedRef.current &&
        stateRef.current !== "authenticating"
      ) {
        addLog("info", "HTTP failed, attempting SSE fallback...");
        const sseResult = await tryConnectWithTransport("sse");
        finalStatus = sseResult;
      } else {
        finalStatus = httpResult;
      }
    }

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
    clientConfig.name,
    clientConfig.version,
    clientConfig.uri,
    clientConfig.logo_uri,
    customHeaders,
    transportType,
    preventAutoAuth,
    useRedirectFlow,
    onPopupWindow,
    enabled,
    timeout,
    sseReadTimeout,
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
   * Call a tool on the connected MCP server
   *
   * @param name - Name of the tool to call
   * @param args - Arguments to pass to the tool
   * @param options - Optional request options for timeout configuration
   * @returns Tool execution result
   * @throws {Error} If client is not ready or tool call fails
   *
   * @example
   * ```typescript
   * // Simple tool call
   * const result = await mcp.callTool('send-email', {
   *   to: 'user@example.com',
   *   subject: 'Hello',
   *   body: 'Test message'
   * })
   *
   * // Tool call with extended timeout (e.g., for tools that trigger sampling)
   * const result = await mcp.callTool('analyze-sentiment', { text: 'Hello' }, {
   *   timeout: 300000, // 5 minutes
   *   resetTimeoutOnProgress: true
   * })
   * ```
   */
  const callTool = useCallback(
    async (
      name: string,
      args?: Record<string, unknown>,
      options?: {
        timeout?: number;
        maxTotalTimeout?: number;
        resetTimeoutOnProgress?: boolean;
        signal?: AbortSignal;
      }
    ) => {
      if (stateRef.current !== "ready" || !clientRef.current) {
        throw new Error(
          `MCP client is not ready (current state: ${state}). Cannot call tool "${name}".`
        );
      }
      addLog("info", `Calling tool: ${name}`, args);
      const startTime = Date.now();
      try {
        const serverName = "inspector-server";
        const session = clientRef.current.getSession(serverName);
        if (!session) {
          throw new Error("No active session found");
        }
        const result = await session.connector.callTool(
          name,
          args || {},
          options
        );
        addLog("info", `Tool "${name}" call successful:`, result);

        // Track successful tool call
        Tel.getInstance()
          .trackUseMcpToolCall({
            toolName: name,
            success: true,
            executionTimeMs: Date.now() - startTime,
          })
          .catch(() => {});

        return result;
      } catch (err) {
        addLog("error", `Tool "${name}" call failed:`, err);

        // Track failed tool call
        Tel.getInstance()
          .trackUseMcpToolCall({
            toolName: name,
            success: false,
            errorType: err instanceof Error ? err.name : "UnknownError",
            executionTimeMs: Date.now() - startTime,
          })
          .catch(() => {});

        throw err;
      }
    },
    [state]
  );

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

        // Clear ALL stale OAuth state from previous attempts
        addLog("info", "Clearing all OAuth state and initiating fresh flow...");

        // Clear all OAuth-related keys for this server
        const hashPrefix = `${storageKeyPrefix}:${authProviderRef.current.serverUrlHash}`;
        Object.keys(localStorage).forEach((key) => {
          // Remove all keys for this server's hash
          if (key.startsWith(hashPrefix)) {
            addLog("debug", `Removing stale OAuth key: ${key}`);
            localStorage.removeItem(key);
          }
          // Also remove any orphaned state parameters
          if (key.startsWith(`${storageKeyPrefix}:state_`)) {
            addLog("debug", `Removing orphaned state: ${key}`);
            localStorage.removeItem(key);
          }
        });

        // Update state to authenticating before redirect
        setState("authenticating");

        // Recreate the auth provider WITHOUT preventAutoAuth
        const freshAuthProvider = new BrowserOAuthClientProvider(url, {
          storageKeyPrefix,
          clientName: clientConfig.name,
          clientUri: clientConfig.uri,
          logoUri: clientConfig.logo_uri || "https://mcp-use.com/logo.png",
          callbackUrl,
          preventAutoAuth: false, // ← Allow OAuth to proceed
          useRedirectFlow,
          onPopupWindow,
        });

        // Replace the auth provider
        authProviderRef.current = freshAuthProvider;

        addLog("info", "Triggering fresh OAuth authorization...");

        // Generate a fresh authorization URL and redirect immediately
        // We need to manually trigger what the SDK would do
        const { auth } =
          await import("@mcp-use/modelcontextprotocol-sdk/client/auth.js");

        // This will trigger the OAuth flow with the new provider
        // The provider will redirect/popup automatically since preventAutoAuth is false
        const baseUrl = new URL(url).origin;
        auth(freshAuthProvider, {
          serverUrl: baseUrl,
        }).catch((err: unknown) => {
          // This is expected to "fail" with redirect - the auth flow continues in the popup/redirect
          addLog(
            "info",
            "OAuth flow initiated:",
            err instanceof Error ? err.message : "Redirecting..."
          );
        });
      } catch (authError) {
        if (!isMountedRef.current) return;
        setState("pending_auth"); // Go back to pending state on error
        addLog(
          "error",
          `Manual authentication failed: ${authError instanceof Error ? authError.message : String(authError)}`
        );
      }
    } else if (currentState === "authenticating") {
      addLog(
        "warn",
        "Already attempting authentication. Check for blocked popups or wait for timeout."
      );
      const manualUrl = authProviderRef.current?.getLastAttemptedAuthUrl();
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
    authUrl,
    url,
    useRedirectFlow,
    onPopupWindow,
    storageKeyPrefix,
    clientConfig.name,
    clientConfig.uri,
    clientConfig.logo_uri,
    callbackUrl,
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
    if (authProviderRef.current) {
      const count = authProviderRef.current.clearStorage();
      addLog("info", `Cleared ${count} item(s) from localStorage for ${url}.`);
      setAuthUrl(undefined);
      disconnect();
    } else {
      addLog("warn", "Auth provider not initialized, cannot clear storage.");
    }
  }, [url, addLog, disconnect]);

  /**
   * Refresh the list of available resources from the server
   *
   * Updates the `resources` state with the latest resource list.
   * Gracefully handles servers that don't support resources.
   *
   * @throws {Error} If client is not ready
   *
   * @example
   * ```typescript
   * await mcp.listResources()
   * console.log(mcp.resources)  // Updated resource list
   * ```
   */
  const listResources = useCallback(async () => {
    if (stateRef.current !== "ready" || !clientRef.current) {
      throw new Error(
        `MCP client is not ready (current state: ${state}). Cannot list resources.`
      );
    }
    addLog("info", "Listing resources");
    try {
      const serverName = "inspector-server";
      const session = clientRef.current.getSession(serverName);
      if (!session) {
        throw new Error("No active session found");
      }
      const resourcesResult = await session.connector.listAllResources();
      setResources(resourcesResult.resources || []);
      addLog("info", "Resources listed successfully");
    } catch (err) {
      addLog("error", "List resources failed:", err);
      throw err;
    }
  }, [state]);

  /**
   * Read a resource from the MCP server by URI
   *
   * @param uri - Resource URI to read
   * @returns Resource contents
   * @throws {Error} If client is not ready or resource read fails
   *
   * @example
   * ```typescript
   * const resource = await mcp.readResource('file:///path/to/file.txt')
   * console.log(resource.contents[0].text)
   * ```
   */
  const readResource = useCallback(
    async (uri: string) => {
      if (stateRef.current !== "ready" || !clientRef.current) {
        throw new Error(
          `MCP client is not ready (current state: ${state}). Cannot read resource.`
        );
      }
      addLog("info", `Reading resource: ${uri}`);
      try {
        const serverName = "inspector-server";
        const session = clientRef.current.getSession(serverName);
        if (!session) {
          throw new Error("No active session found");
        }
        const result = await session.connector.readResource(uri);
        addLog("info", "Resource read successful:", result);

        // Track successful resource read
        Tel.getInstance()
          .trackUseMcpResourceRead({
            resourceUri: uri,
            success: true,
          })
          .catch(() => {});

        return result;
      } catch (err) {
        addLog("error", "Resource read failed:", err);

        // Track failed resource read
        Tel.getInstance()
          .trackUseMcpResourceRead({
            resourceUri: uri,
            success: false,
            errorType: err instanceof Error ? err.name : "UnknownError",
          })
          .catch(() => {});

        throw err;
      }
    },
    [state]
  );

  /**
   * Refresh the list of available prompts from the server
   *
   * Updates the `prompts` state with the latest prompt templates.
   * Gracefully handles servers that don't support prompts.
   *
   * @throws {Error} If client is not ready
   *
   * @example
   * ```typescript
   * await mcp.listPrompts()
   * console.log(mcp.prompts)  // Updated prompt list
   * ```
   */
  const listPrompts = useCallback(async () => {
    if (stateRef.current !== "ready" || !clientRef.current) {
      throw new Error(
        `MCP client is not ready (current state: ${state}). Cannot list prompts.`
      );
    }
    addLog("info", "Listing prompts");
    try {
      const serverName = "inspector-server";
      const session = clientRef.current.getSession(serverName);
      if (!session) {
        throw new Error("No active session found");
      }
      const promptsResult = await session.connector.listPrompts();
      setPrompts(promptsResult.prompts || []);
      addLog("info", "Prompts listed successfully");
    } catch (err) {
      addLog("error", "List prompts failed:", err);
      throw err;
    }
  }, [state]);

  /**
   * Refresh the tools list from the server
   * Called automatically on notifications/tools/list_changed or manually by user
   */
  const refreshTools = useCallback(async () => {
    if (stateRef.current !== "ready" || !clientRef.current) {
      addLog("debug", "Cannot refresh tools - client not ready");
      return;
    }
    addLog("debug", "Refreshing tools list");
    try {
      const serverName = "inspector-server";
      const session = clientRef.current.getSession(serverName);
      if (!session) {
        addLog("warn", "No active session found for tools refresh");
        return;
      }
      // Re-fetch tools from the server
      const toolsResult = await session.connector.listTools();
      setTools(toolsResult || []);
      addLog("info", "Tools list refreshed successfully");
    } catch (err) {
      addLog("warn", "Failed to refresh tools:", err);
    }
  }, [addLog]);

  /**
   * Refresh the resources list from the server
   * Called automatically on notifications/resources/list_changed or manually by user
   */
  const refreshResources = useCallback(async () => {
    if (stateRef.current !== "ready" || !clientRef.current) {
      addLog("debug", "Cannot refresh resources - client not ready");
      return;
    }
    addLog("debug", "Refreshing resources list");
    try {
      const serverName = "inspector-server";
      const session = clientRef.current.getSession(serverName);
      if (!session) {
        addLog("warn", "No active session found for resources refresh");
        return;
      }
      const resourcesResult = await session.connector.listAllResources();
      setResources(resourcesResult.resources || []);
      addLog("info", "Resources list refreshed successfully");
    } catch (err) {
      addLog("warn", "Failed to refresh resources:", err);
    }
  }, [addLog]);

  /**
   * Refresh the prompts list from the server
   * Called automatically on notifications/prompts/list_changed or manually by user
   */
  const refreshPrompts = useCallback(async () => {
    if (stateRef.current !== "ready" || !clientRef.current) {
      addLog("debug", "Cannot refresh prompts - client not ready");
      return;
    }
    addLog("debug", "Refreshing prompts list");
    try {
      const serverName = "inspector-server";
      const session = clientRef.current.getSession(serverName);
      if (!session) {
        addLog("warn", "No active session found for prompts refresh");
        return;
      }
      const promptsResult = await session.connector.listPrompts();
      setPrompts(promptsResult.prompts || []);
      addLog("info", "Prompts list refreshed successfully");
    } catch (err) {
      addLog("warn", "Failed to refresh prompts:", err);
    }
  }, [addLog]);

  /**
   * Refresh all lists (tools, resources, prompts) from the server
   * Useful after reconnection or for manual refresh
   */
  const refreshAll = useCallback(async () => {
    addLog("info", "Refreshing all lists (tools, resources, prompts)");
    await Promise.all([refreshTools(), refreshResources(), refreshPrompts()]);
  }, [refreshTools, refreshResources, refreshPrompts, addLog]);

  /**
   * Get a prompt template with arguments
   *
   * @param name - Name of the prompt template
   * @param args - Arguments to fill in the template
   * @returns Prompt result with messages
   * @throws {Error} If client is not ready or prompt retrieval fails
   *
   * @example
   * ```typescript
   * const prompt = await mcp.getPrompt('code-review', {
   *   language: 'typescript',
   *   focus: 'performance'
   * })
   * console.log(prompt.messages)
   * ```
   */
  const getPrompt = useCallback(
    async (name: string, args?: Record<string, unknown>) => {
      if (stateRef.current !== "ready" || !clientRef.current) {
        throw new Error(
          `MCP client is not ready (current state: ${state}). Cannot get prompt.`
        );
      }
      addLog("info", `Getting prompt: ${name}`, args);
      try {
        const serverName = "inspector-server";
        const session = clientRef.current.getSession(serverName);
        if (!session) {
          throw new Error("No active session found");
        }
        const result = await session.connector.getPrompt(name, args || {});
        addLog("info", `Prompt "${name}" retrieved successfully:`, result);
        return result;
      } catch (err) {
        addLog("error", `Prompt "${name}" retrieval failed:`, err);
        throw err;
      }
    },
    [state]
  );

  // ===== Effects =====

  /**
   * Effect: Listen for OAuth callback messages from popup window
   * Handles successful authentication and reconnection
   */
  useEffect(() => {
    const messageHandler = (event: globalThis.MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "mcp_auth_callback") {
        addLog("info", "Received auth callback message.", event.data);
        if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
        authTimeoutRef.current = null;

        if (event.data.success) {
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
          failConnectionRef.current?.(
            `Authentication failed in callback: ${event.data.error || "Unknown reason."}`
          );
        }
      }
    };
    window.addEventListener("message", messageHandler);
    addLog("debug", "Auth callback message listener added.");
    return () => {
      window.removeEventListener("message", messageHandler);
      addLog("debug", "Auth callback message listener removed.");
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
    if (!authProviderRef.current || authProviderRef.current.serverUrl !== url) {
      authProviderRef.current = new BrowserOAuthClientProvider(url, {
        storageKeyPrefix,
        clientName: clientConfig.name,
        clientUri: clientConfig.uri,
        logoUri: clientConfig.logo_uri || "https://mcp-use.com/logo.png",
        callbackUrl,
        preventAutoAuth,
        useRedirectFlow,
        onPopupWindow,
      });
      addLog(
        "debug",
        "BrowserOAuthClientProvider initialized/updated on mount/option change."
      );
    }
    connect();
    return () => {
      isMountedRef.current = false;
      addLog("debug", "useMcp unmounting, disconnecting.");
      disconnect(true);
    };
  }, [
    url,
    enabled,
    storageKeyPrefix,
    callbackUrl,
    clientConfig.name,
    clientConfig.version,
    clientConfig.uri,
    clientConfig.logo_uri,
    useRedirectFlow,
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
    error,
    log,
    authUrl,
    authTokens,
    client: clientRef.current,
    callTool,
    readResource,
    listResources,
    listPrompts,
    getPrompt,
    refreshTools,
    refreshResources,
    refreshPrompts,
    refreshAll,
    retry,
    disconnect,
    authenticate,
    clearStorage,
    ensureIconLoaded,
  };
}
