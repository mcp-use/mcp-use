import type { MCPConnection } from "@/client/context/McpContext";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

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
}

/**
 * Parse autoConnect parameter - supports both URL strings and full config objects
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

export function useAutoConnect({
  connections,
  addConnection,
  removeConnection,
}: UseAutoConnectOptions): AutoConnectState {
  const navigate = useNavigate();
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [autoConnectConfig, setAutoConnectConfig] =
    useState<ConnectionConfig | null>(null);
  const [hasTriedBothModes, setHasTriedBothModes] = useState(false);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);
  const retryScheduledRef = useRef(false);

  // Load auto-switch setting from localStorage
  useEffect(() => {
    const autoSwitchSetting = localStorage.getItem("mcp-inspector-auto-switch");
    if (autoSwitchSetting !== null) {
      setAutoSwitch(autoSwitchSetting === "true");
    }
  }, []);

  // Unified connection attempt function
  const attemptConnection = useCallback(
    (config: ConnectionConfig) => {
      const { url, name, transportType, connectionType, customHeaders } =
        config;

      // Prepare proxy configuration if using proxy
      const proxyConfig =
        connectionType === "Via Proxy"
          ? {
              proxyAddress: `${window.location.origin}/inspector/api/proxy/mcp`,
              customHeaders: customHeaders || {},
            }
          : customHeaders && Object.keys(customHeaders).length > 0
            ? { proxyAddress: undefined, customHeaders }
            : undefined;

      console.warn(
        `[useAutoConnect] Attempting connection (${connectionType}):`,
        { url, transportType, proxyConfig }
      );

      addConnection(url, name, proxyConfig, transportType);
    },
    [addConnection]
  );

  // Load config and initiate auto-connect
  useEffect(() => {
    if (configLoaded) return;

    // Check for autoConnect query parameter first
    const urlParams = new URLSearchParams(window.location.search);
    const queryAutoConnectParam = urlParams.get("autoConnect");

    if (queryAutoConnectParam) {
      const config = parseAutoConnectParam(queryAutoConnectParam);

      if (config) {
        const existing = connections.find((c) => c.url === config.url);
        if (!existing) {
          setAutoConnectConfig(config);
          setHasTriedBothModes(false);
          setIsAutoConnecting(true);
          attemptConnection(config);
        }
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
            const existing = connections.find((c) => c.url === config.url);
            if (!existing) {
              setAutoConnectConfig(config);
              setHasTriedBothModes(false);
              setIsAutoConnecting(true);
              attemptConnection(config);
            }
          }
        }
      })
      .catch(() => setConfigLoaded(true));
  }, [configLoaded, connections, attemptConnection]);

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
      // Preserve tunnelUrl parameter if present
      const urlParams = new URLSearchParams(window.location.search);
      const tunnelUrl = urlParams.get("tunnelUrl");
      const newUrl = tunnelUrl
        ? `/?server=${encodeURIComponent(connection.id)}&tunnelUrl=${encodeURIComponent(tunnelUrl)}`
        : `/?server=${encodeURIComponent(connection.id)}`;
      navigate(newUrl);

      setTimeout(() => {
        setAutoConnectConfig(null);
        setHasTriedBothModes(false);
        setIsAutoConnecting(false);
        retryScheduledRef.current = false;
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
        setHasTriedBothModes(true);
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
        // Both modes failed - clear loading and reset state
        toast.error("Proxy connection also failed");
        setHasTriedBothModes(true);

        // Defer state updates to avoid updating during render
        queueMicrotask(() => {
          removeConnection(connection.id);
          setIsAutoConnecting(false);
          setAutoConnectConfig(null);
          retryScheduledRef.current = false;
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
        (conn) => conn.state !== "connecting" && conn.state !== "loading"
      );
      if (hasEstablishedConnection) {
        const timeoutId = setTimeout(() => setIsAutoConnecting(false), 500);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [isAutoConnecting, connections, autoConnectConfig]);

  return { isAutoConnecting, autoConnectUrl: autoConnectConfig?.url || null };
}
