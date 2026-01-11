import type { McpServer } from "mcp-use/react";
import { useCallback, useEffect, useState } from "react";
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
/**
 * Parse an "autoConnect" parameter that may be a plain URL or a JSON-encoded connection configuration.
 * Supports both formats:
 * - URL string: "https://example.com/mcp"
 * - JSON object: '{"url":"https://example.com/mcp","auth":{...}}'
 *
 * @param param - The autoConnect value to parse; either a URL string or a JSON string representing a ConnectionConfig.
 * @returns A ConnectionConfig derived from `param` when valid, or `null` if `param` cannot be interpreted as a valid configuration.
 */
function parseAutoConnectParam(param: string): ConnectionConfig | null {
  if (!param || typeof param !== "string") {
    console.warn(
      "[useAutoConnect] parseAutoConnectParam: invalid param",
      param
    );
    return null;
  }

  // Trim whitespace
  let trimmed = param.trim();

  // Remove trailing slashes from JSON strings (common issue with URL construction)
  // This handles cases like: {"url":"..."}}/  -> {"url":"..."}}
  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    trimmed.endsWith("/")
  ) {
    trimmed = trimmed.replace(/\/+$/, "");
  }

  // First, check if it's a plain URL string (starts with http:// or https://)
  // This handles the simple case: autoConnect=https://example.com/mcp
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    console.log(
      "[useAutoConnect] parseAutoConnectParam: treating as plain URL:",
      trimmed
    );
    return {
      url: trimmed,
      name: "Auto-connected Server",
      transportType: "http",
      connectionType: "Direct",
    };
  }

  // Otherwise, try to parse as JSON object
  // This handles: autoConnect={"url":"https://example.com/mcp",...}
  try {
    const parsed = JSON.parse(trimmed);
    console.log("[useAutoConnect] parseAutoConnectParam: parsed JSON:", parsed);

    // Validate it's an object with a url field
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Check if url is a string
      if (parsed.url && typeof parsed.url === "string") {
        let url = parsed.url.trim();

        // Handle case where url field might be a JSON string (double-encoded)
        // This can happen if the parameter was encoded multiple times
        if ((url.startsWith("{") || url.startsWith("[")) && url.length > 2) {
          try {
            const urlParsed = JSON.parse(url);
            if (
              urlParsed &&
              typeof urlParsed === "object" &&
              urlParsed.url &&
              typeof urlParsed.url === "string"
            ) {
              url = urlParsed.url.trim();
              console.log(
                "[useAutoConnect] parseAutoConnectParam: extracted URL from nested JSON:",
                url
              );
            } else {
              console.warn(
                "[useAutoConnect] parseAutoConnectParam: url field is JSON but doesn't contain a url:",
                urlParsed
              );
            }
          } catch (e) {
            // If nested JSON parsing fails, use the original url value
            console.warn(
              "[useAutoConnect] parseAutoConnectParam: url field looks like JSON but failed to parse, using as-is:",
              e
            );
          }
        }

        // Validate that the final URL is actually a valid HTTP(S) URL
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          console.error(
            "[useAutoConnect] parseAutoConnectParam: extracted URL is not a valid HTTP(S) URL:",
            url
          );
          return null;
        }

        console.log(
          "[useAutoConnect] parseAutoConnectParam: extracted URL:",
          url
        );
        return {
          url: url,
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
      } else {
        console.warn(
          "[useAutoConnect] parseAutoConnectParam: parsed object missing or invalid url field:",
          parsed
        );
        return null;
      }
    } else {
      // Parsed successfully but not a valid object (could be a string, number, array, etc.)
      // If it's a string that looks like a URL, treat it as such
      if (
        typeof parsed === "string" &&
        (parsed.startsWith("http://") || parsed.startsWith("https://"))
      ) {
        console.log(
          "[useAutoConnect] parseAutoConnectParam: JSON parsed to URL string:",
          parsed
        );
        return {
          url: parsed,
          name: "Auto-connected Server",
          transportType: "http",
          connectionType: "Direct",
        };
      }
      console.warn(
        "[useAutoConnect] parseAutoConnectParam: parsed value is not a valid object:",
        parsed
      );
      return null;
    }
  } catch (error) {
    // JSON parsing failed - the param is neither a valid URL nor valid JSON
    console.error(
      "[useAutoConnect] parseAutoConnectParam: Failed to parse as JSON and not a valid URL:",
      error,
      "Param:",
      trimmed
    );
    return null;
  }
}

/**
 * Manage automatic connection attempts to a server URL, including initiating connections,
 * preserving auth headers, storing OAuth tokens (when appropriate), and navigating to
 * the server on successful connection.
 *
 * Note: Proxy fallback is handled automatically by useMcp's built-in autoProxyFallback.
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
  const [configLoaded, setConfigLoaded] = useState(false);

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

      // Prepare proxy configuration
      // Note: Use "headers" instead of deprecated "customHeaders"
      // Always provide proxyAddress when we have headers so autoProxyFallback can use them
      const proxyConfig =
        connectionType === "Via Proxy"
          ? {
              proxyAddress: `${window.location.origin}/inspector/api/proxy`,
              headers: finalCustomHeaders,
            }
          : Object.keys(finalCustomHeaders).length > 0
            ? {
                // Provide proxyAddress for autoProxyFallback to use with headers
                proxyAddress: `${window.location.origin}/inspector/api/proxy`,
                headers: finalCustomHeaders,
              }
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
        setIsAutoConnecting(true);
        attemptConnection(config);
      }
    },
    [connections, navigate, attemptConnection]
  );

  // Load config and initiate auto-connect
  // Wait for context's configLoaded to ensure localStorage is loaded before attempting connections
  // In embedded mode, skip this check since we don't use localStorage
  useEffect(() => {
    // Early return if already processed
    if (configLoaded) {
      return;
    }

    // In embedded mode, we don't need to wait for storage to load
    // Proceed immediately with autoConnect
    if (embedded) {
      const urlParams = new URLSearchParams(window.location.search);
      let queryAutoConnectParam = urlParams.get("autoConnect");

      // URLSearchParams.get() automatically decodes, but handle double-encoding if present
      if (queryAutoConnectParam) {
        try {
          // Try decoding again in case it was double-encoded
          queryAutoConnectParam = decodeURIComponent(queryAutoConnectParam);
        } catch {
          // If decoding fails, use the original value
        }

        console.log(
          "[useAutoConnect] Raw autoConnect param:",
          queryAutoConnectParam
        );
        const config = parseAutoConnectParam(queryAutoConnectParam);
        console.log("[useAutoConnect] Parsed config:", config);

        if (config) {
          handleAutoConnectConfig(config);
        }

        setConfigLoaded(true);
        return;
      }

      // No autoConnect param in embedded mode - mark as loaded
      setConfigLoaded(true);
      return;
    }

    // Non-embedded mode: Wait for storage to load
    // Wait for storage to load (contextConfigLoaded must be explicitly true)
    if (contextConfigLoaded !== true) {
      return;
    }

    // Check for autoConnect query parameter first
    const urlParams = new URLSearchParams(window.location.search);
    let queryAutoConnectParam = urlParams.get("autoConnect");

    // URLSearchParams.get() automatically decodes, but handle double-encoding if present
    if (queryAutoConnectParam) {
      try {
        // Try decoding again in case it was double-encoded
        queryAutoConnectParam = decodeURIComponent(queryAutoConnectParam);
      } catch {
        // If decoding fails, use the original value
      }
    }

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
  }, [configLoaded, contextConfigLoaded, handleAutoConnectConfig, embedded]);

  // Handle connection state changes (success and auth states)
  // Proxy fallback is now handled by useMcp's built-in autoProxyFallback
  useEffect(() => {
    if (!autoConnectConfig) {
      return;
    }

    const connection = connections.find((c) => c.url === autoConnectConfig.url);

    // Handle successful connection
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
        setIsAutoConnecting(false);
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

    // Handle failed connection - show error and navigate home
    // Note: useMcp's autoProxyFallback will have already tried proxy fallback internally
    if (connection?.state === "failed") {
      console.warn("[useAutoConnect] Connection failed after all retries");

      toast.error(
        "Cannot connect to server. Please check the URL and try again."
      );

      // Defer state updates to avoid updating during render
      queueMicrotask(() => {
        removeConnection(connection.id);
        setIsAutoConnecting(false);
        setAutoConnectConfig(null);

        // Navigate to home page after connection failure
        navigate("/");
      });
    }
  }, [connections, autoConnectConfig, removeConnection, navigate]);

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
