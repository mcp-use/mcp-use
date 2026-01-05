import type { McpServer } from "mcp-use/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

// Type alias for backward compatibility
type MCPConnection = McpServer;

interface UseAutoConnectOptions {
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
  configLoaded: boolean;
  embedded?: boolean;
}

interface AutoConnectState {
  isAutoConnecting: boolean;
  autoConnectUrl: string | null;
}

interface ConnectionConfig {
  url: string;
  name: string;
  transportType: "http" | "sse";
  connectionType: "Direct" | "Via Proxy";
  customHeaders?: Record<string, string>;
  requestTimeout?: number;
  resetTimeoutOnProgress?: boolean;
  maxTotalTimeout?: number;
  auth?: {
    access_token: string;
    token_type?: string;
    expires_at?: number;
    refresh_token?: string;
    scope?: string;
  };
}

/**
 * Parse an "autoConnect" parameter that may be a plain URL or a JSON-encoded connection configuration.
 *
 * @param param - The autoConnect value to parse; either a URL string or a JSON string representing a ConnectionConfig.
 * @returns A ConnectionConfig derived from `param` when valid, or `null` if `param` cannot be interpreted as a valid configuration.
 */
function parseAutoConnectParam(param: string): ConnectionConfig | null {
  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(param);

    // Validate it has required fields
    if (parsed.url && typeof parsed.url === "string") {
      return {
        url: parsed.url,
        name: parsed.name || "Auto-connected Server",
        transportType: parsed.transportType === "sse" ? "sse" : "http",
        connectionType:
          parsed.connectionType === "Via Proxy" ? "Via Proxy" : "Direct",
        customHeaders: parsed.customHeaders || {},
        requestTimeout: parsed.requestTimeout,
        resetTimeoutOnProgress: parsed.resetTimeoutOnProgress,
        maxTotalTimeout: parsed.maxTotalTimeout,
        auth: parsed.auth,
      };
    }
  } catch {
    // Not JSON, treat as URL string
    return {
      url: param,
      name: "Auto-connected Server",
      transportType: "http",
      connectionType: "Direct",
    };
  }

  return null;
}

/**
 * Manage automatic connection attempts to a server URL, including initiating connections,
 * preserving auth headers, storing OAuth tokens (when appropriate), and retrying with a
 * proxy fallback if a direct connection fails.
 *
 * @param options - Configuration for auto-connect behavior. Includes the current `connections`
 *   list, `addConnection`/`removeConnection` callbacks, `configLoaded` from context, and
 *   `embedded` (when `true`, limits persistence of stored OAuth tokens / uses session-like storage).
 * @returns An object with the auto-connect state:
 *   - `isAutoConnecting`: `true` when an automatic connection attempt is active, `false` otherwise.
 *   - `autoConnectUrl`: the URL currently targeted for auto-connection, or `null` if none.
 */
export function useAutoConnect({
  connections,
  addConnection,
  removeConnection,
  configLoaded: contextConfigLoaded,
  embedded = false,
}: UseAutoConnectOptions): AutoConnectState {
  const navigate = useNavigate();
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [autoConnectConfig, setAutoConnectConfig] =
    useState<ConnectionConfig | null>(null);
  const [hasTriedBothModes, setHasTriedBothModes] = useState(false);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);
  const retryScheduledRef = useRef(false);

  // Load auto-switch setting from localStorage, but override to true if autoConnect is active
  useEffect(() => {
    if (autoConnectConfig) {
      // When using autoConnect, always enable auto-switch (proxy fallback)
      setAutoSwitch(true);
    } else {
      const autoSwitchSetting = localStorage.getItem(
        "mcp-inspector-auto-switch"
      );
      if (autoSwitchSetting !== null) {
        setAutoSwitch(autoSwitchSetting === "true");
      }
    }
  }, [autoConnectConfig]);

  // Unified connection attempt function
  const attemptConnection = useCallback(
    (config: ConnectionConfig) => {
      const { url, name, transportType, connectionType, customHeaders, auth } =
        config;

      console.log("[useAutoConnect] Config received:", config);
      console.log(
        "[useAutoConnect] Custom headers before auth:",
        customHeaders
      );
      console.log("[useAutoConnect] Auth config:", auth);

      // Merge custom headers with auth if provided
      const finalCustomHeaders = { ...customHeaders };

      // If auth tokens are provided, add as Authorization header AND store in localStorage (embedded mode uses session storage)
      if (auth?.access_token) {
        const tokenType = auth.token_type || "bearer";
        // Capitalize first letter of token type (Bearer, not bearer)
        const formattedTokenType =
          tokenType.charAt(0).toUpperCase() + tokenType.slice(1);
        finalCustomHeaders.Authorization = `${formattedTokenType} ${auth.access_token}`;

        console.log(
          "[useAutoConnect] Added Authorization header:",
          finalCustomHeaders.Authorization
        );

        // Store tokens for auth refresh (use sessionStorage in embedded mode to avoid persistence)
        if (typeof window !== "undefined" && !embedded) {
          const storageKey = `mcp:auth:${url}`;
          const oauthData = {
            access_token: auth.access_token,
            token_type: auth.token_type || "bearer",
            expires_at: auth.expires_at,
            refresh_token: auth.refresh_token,
            scope: auth.scope || "",
          };
          try {
            localStorage.setItem(storageKey, JSON.stringify(oauthData));
            console.log(`[useAutoConnect] Pre-stored OAuth tokens for ${url}`);
          } catch (error) {
            console.error(
              "[useAutoConnect] Failed to store OAuth tokens:",
              error
            );
          }
        }
      }

      console.log("[useAutoConnect] Final custom headers:", finalCustomHeaders);

      // Prepare proxy configuration if using proxy
      const proxyConfig =
        connectionType === "Via Proxy"
          ? {
              proxyAddress: `${window.location.origin}/inspector/api/proxy/mcp`,
              customHeaders: finalCustomHeaders,
            }
          : Object.keys(finalCustomHeaders).length > 0
            ? { proxyAddress: undefined, customHeaders: finalCustomHeaders }
            : undefined;

      console.warn(
        `[useAutoConnect] Attempting connection (${connectionType}):`,
        { url, transportType, proxyConfig }
      );

      addConnection(url, name, proxyConfig, transportType);
    },
    [addConnection]
  );

  // Helper to handle auto-connect for a config
  const handleAutoConnectConfig = useCallback(
    (config: ConnectionConfig) => {
      const existing = connections.find((c) => c.url === config.url);

      if (existing) {
        // Connection already exists
        if (existing.state === "ready") {
          // Already connected - navigate immediately
          console.warn(
            "[useAutoConnect] Connection already ready, navigating to server"
          );
          const urlParams = new URLSearchParams(window.location.search);
          const tunnelUrl = urlParams.get("tunnelUrl");
          const tab = urlParams.get("tab");
          const params = new URLSearchParams();
          params.set("server", existing.id);
          if (tunnelUrl) params.set("tunnelUrl", tunnelUrl);
          if (tab) params.set("tab", tab);
          navigate(`/?${params.toString()}`);
        } else {
          // Connection exists but not ready - track it for navigation when ready
          console.warn(
            "[useAutoConnect] Connection exists, waiting for ready state"
          );
          setAutoConnectConfig(config);
          setIsAutoConnecting(true);
        }
      } else {
        // No existing connection - create new one
        setAutoConnectConfig(config);
        setHasTriedBothModes(false);
        setIsAutoConnecting(true);
        attemptConnection(config);
      }
    },
    [connections, navigate, attemptConnection]
  );

  // Load config and initiate auto-connect
  // Wait for context's configLoaded to ensure localStorage is loaded before attempting connections
  useEffect(() => {
    // Early return if already processed
    if (configLoaded) {
      return;
    }

    // Wait for storage to load (contextConfigLoaded must be explicitly true)
    if (contextConfigLoaded !== true) {
      return;
    }

    // Check for autoConnect query parameter first
    const urlParams = new URLSearchParams(window.location.search);
    const queryAutoConnectParam = urlParams.get("autoConnect");

    if (queryAutoConnectParam) {
      const config = parseAutoConnectParam(queryAutoConnectParam);

      if (config) {
        handleAutoConnectConfig(config);
      }

      setConfigLoaded(true);
      return;
    }

    // Fallback to config.json
    fetch("/inspector/config.json")
      .then((res) => res.json())
      .then((configData: { autoConnectUrl: string | null }) => {
        setConfigLoaded(true);
        if (configData.autoConnectUrl) {
          const config = parseAutoConnectParam(configData.autoConnectUrl);

          if (config) {
            handleAutoConnectConfig(config);
          }
        }
      })
      .catch(() => setConfigLoaded(true));
  }, [configLoaded, contextConfigLoaded, handleAutoConnectConfig]);

  // Auto-connect retry logic
  useEffect(() => {
    if (!autoConnectConfig || !autoSwitch || retryScheduledRef.current) {
      return;
    }

    const connection = connections.find((c) => c.url === autoConnectConfig.url);

    // Handle successful connection first (don't block by hasTriedBothModes)
    if (connection?.state === "ready") {
      console.warn(
        "[useAutoConnect] Connection succeeded, navigating to server"
      );

      // Navigate using the connection ID (which is the original URL)
      // Preserve tunnelUrl and tab parameters if present
      const urlParams = new URLSearchParams(window.location.search);
      const tunnelUrl = urlParams.get("tunnelUrl");
      const tab = urlParams.get("tab");
      const params = new URLSearchParams();
      params.set("server", connection.id);
      if (tunnelUrl) params.set("tunnelUrl", tunnelUrl);
      if (tab) params.set("tab", tab);
      navigate(`/?${params.toString()}`);

      setTimeout(() => {
        setAutoConnectConfig(null);
        setHasTriedBothModes(false);
        setIsAutoConnecting(false);
        retryScheduledRef.current = false;
      }, 100);
      return;
    }

    // Handle authentication states - clear loading overlay so user can authenticate
    // But DON'T navigate yet - wait for them to complete auth
    if (
      connection?.state === "pending_auth" ||
      connection?.state === "authenticating"
    ) {
      console.warn(
        "[useAutoConnect] Connection requires authentication, clearing loading overlay"
      );

      // Just clear the loading overlay - user will see auth UI on the dashboard
      // We'll navigate to the server after auth completes and state becomes "ready"
      setTimeout(() => {
        setIsAutoConnecting(false);
      }, 100);
      return;
    }

    // Only check hasTriedBothModes for failure retry logic
    if (hasTriedBothModes) {
      return;
    }

    // Handle failed connection - retry with alternate mode
    if (connection?.state === "failed" && connection.error) {
      console.warn(
        "[useAutoConnect] Connection failed, trying alternate mode..."
      );

      // Determine alternate connection type
      const alternateConnectionType =
        autoConnectConfig.connectionType === "Direct" ? "Via Proxy" : "Direct";

      // Only retry if we haven't tried both modes yet
      if (autoConnectConfig.connectionType === "Direct") {
        // Failed with direct, try proxy
        toast.error("Direct connection failed, trying with proxy...");
        retryScheduledRef.current = true;

        // Defer state updates to avoid updating during render
        queueMicrotask(() => {
          removeConnection(connection.id);

          setTimeout(() => {
            console.warn("[useAutoConnect] Retrying with proxy");

            // Create new config with proxy
            const retryConfig: ConnectionConfig = {
              ...autoConnectConfig,
              connectionType: alternateConnectionType,
            };

            // Update the config to track the retry attempt
            setAutoConnectConfig(retryConfig);
            setIsAutoConnecting(true);
            retryScheduledRef.current = false;

            attemptConnection(retryConfig);
          }, 1000);
        });
      } else {
        // Both modes failed - clear loading, reset state, and navigate home
        toast.error(
          "Cannot connect to server. Please check the URL and try again."
        );

        // Defer state updates to avoid updating during render
        queueMicrotask(() => {
          removeConnection(connection.id);
          setIsAutoConnecting(false);
          setAutoConnectConfig(null);
          setHasTriedBothModes(true);
          retryScheduledRef.current = false;

          // Navigate to home page after connection failure
          navigate("/");
        });
      }
    }
  }, [
    connections,
    autoConnectConfig,
    hasTriedBothModes,
    autoSwitch,
    attemptConnection,
    removeConnection,
    navigate,
  ]);

  // Clear loading state for connections that complete without retry
  useEffect(() => {
    if (isAutoConnecting && connections.length > 0 && !autoConnectConfig) {
      const hasEstablishedConnection = connections.some(
        (conn) =>
          conn.state === "ready" ||
          conn.state === "failed" ||
          conn.state === "pending_auth"
      );
      if (hasEstablishedConnection) {
        const timeoutId = setTimeout(() => setIsAutoConnecting(false), 500);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [isAutoConnecting, connections, autoConnectConfig]);

  // Safety timeout: clear isAutoConnecting if it's been true for too long without progress
  useEffect(() => {
    if (!isAutoConnecting) return;

    const timeoutId = setTimeout(() => {
      // If we've been auto-connecting for 30 seconds and still no connection,
      // something is wrong - clear the loading state
      if (isAutoConnecting) {
        console.warn(
          "[useAutoConnect] Auto-connect timeout - clearing loading state"
        );
        setIsAutoConnecting(false);
        setAutoConnectConfig(null);
      }
    }, 30000); // 30 second timeout

    return () => clearTimeout(timeoutId);
  }, [isAutoConnecting]);

  return { isAutoConnecting, autoConnectUrl: autoConnectConfig?.url || null };
}