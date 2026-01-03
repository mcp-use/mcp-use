import { ElicitationRequestToast } from "@/client/components/elicitation/ElicitationRequestToast";
import { SamplingRequestToast } from "@/client/components/sampling/SamplingRequestToast";
import { MCPServerRemovedEvent, Telemetry } from "@/client/telemetry";
import {
  useMcpClient as useBaseMcpClient,
  type McpServerOptions as BaseMcpServerOptions,
  type McpNotification,
  type McpServer,
  type PendingElicitationRequest,
  type PendingSamplingRequest,
} from "mcp-use/react";
import { applyProxyConfig } from "mcp-use/utils";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Re-export types for backward compatibility
export type {
  McpNotification,
  PendingElicitationRequest,
  PendingSamplingRequest,
};

// Alias MCPConnection to McpServer for backward compatibility
export type MCPConnection = McpServer & {
  customHeaders?: Record<string, string>;
  transportType?: "http" | "sse";
  proxyConfig?: {
    proxyAddress?: string;
    customHeaders?: Record<string, string>;
  };
};

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

interface ConnectionConfig {
  id: string;
  url: string;
  name: string;
  proxyConfig?: {
    proxyAddress?: string;
    customHeaders?: Record<string, string>;
  };
  transportType?: "http" | "sse";
}

export function McpProvider({
  children,
  embedded = false,
}: {
  children: ReactNode;
  embedded?: boolean;
}) {
  const [configLoaded, setConfigLoaded] = useState(false);
  const [autoConnect, setAutoConnect] = useState(true);
  const [connectionConfigs, setConnectionConfigs] = useState<
    ConnectionConfig[]
  >([]);

  // Get base context
  const baseContext = useBaseMcpClient();

  // Import transport wrapper for RPC logging
  const wrapTransportRef = useRef<
    ((transport: any, serverId: string) => any) | null
  >(null);
  const [wrapTransportReady, setWrapTransportReady] = useState(false);
  const wrapperLoadAttemptedRef = useRef(false);

  // Load the transport wrapper immediately on mount
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
          setWrapTransportReady(true); // Continue without wrapper
        });
    }
  }, []);

  // Initialize from localStorage (skip in embedded mode)
  useEffect(() => {
    if (embedded) {
      setConfigLoaded(true);
      return;
    }

    try {
      const savedConfigs = localStorage.getItem("mcp-inspector-connections");
      if (savedConfigs) {
        const parsed = JSON.parse(savedConfigs);
        if (Array.isArray(parsed)) {
          setConnectionConfigs(parsed);
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
  }, [embedded]);

  // Save to localStorage whenever configs change (skip in embedded mode)
  useEffect(() => {
    if (!configLoaded || embedded) return;
    localStorage.setItem(
      "mcp-inspector-connections",
      JSON.stringify(connectionConfigs)
    );
  }, [connectionConfigs, configLoaded, embedded]);

  useEffect(() => {
    if (!configLoaded || embedded) return;
    localStorage.setItem("mcp-inspector-auto-connect", String(autoConnect));
  }, [autoConnect, configLoaded, embedded]);

  // Auto-connect servers when configs are loaded and autoConnect is enabled
  useEffect(() => {
    if (!configLoaded || !autoConnect || !wrapTransportReady) return;

    connectionConfigs.forEach((config) => {
      // Check if server is already added
      if (baseContext.getServer(config.id)) return;

      const storageKeyPrefix = embedded ? "mcp-embedded:auth" : "mcp:auth";
      const storageKey = `${storageKeyPrefix}:${config.url}`;
      const hasPreStoredOAuthTokens = (() => {
        if (typeof window === "undefined" || embedded) return false;
        try {
          const stored = localStorage.getItem(storageKey);
          return stored !== null;
        } catch {
          return false;
        }
      })();

      const callbackUrl =
        typeof window !== "undefined"
          ? new URL(
              "/inspector/oauth/callback",
              window.location.origin
            ).toString()
          : "/inspector/oauth/callback";

      // Apply proxy configuration if provided
      const { url: finalUrl, headers: customHeaders } = applyProxyConfig(
        config.url,
        config.proxyConfig
      );

      const options: BaseMcpServerOptions = {
        url: finalUrl,
        name: config.name,
        callbackUrl,
        timeout: 5000,
        customHeaders:
          Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
        transportType: config.transportType || "http",
        preventAutoAuth: !hasPreStoredOAuthTokens,
        useRedirectFlow: true,
        enabled: true,
        storageKeyPrefix,
        wrapTransport: wrapTransportRef.current
          ? (transport: any, serverIdFromConnector: string) => {
              console.log(
                "[McpContext] Applying transport wrapper, serverId:",
                config.id,
                "from connector:",
                serverIdFromConnector
              );
              return wrapTransportRef.current!(transport, config.id);
            }
          : undefined,
        // Toast notifications for sampling requests
        onSamplingRequest: (request: PendingSamplingRequest) => {
          if (typeof window !== "undefined") {
            import("sonner").then(({ toast }) => {
              const toastId = toast(
                <SamplingRequestToast
                  requestId={request.id}
                  serverName={request.serverName}
                  onViewDetails={() => {
                    const event = new globalThis.CustomEvent(
                      "navigate-to-sampling",
                      { detail: { requestId: request.id } }
                    );
                    window.dispatchEvent(event);
                    toast.dismiss(toastId);
                  }}
                  onApprove={(defaultResponse) => {
                    const server = baseContext.getServer(config.id);
                    if (server) {
                      server.approveSampling(request.id, defaultResponse);
                      toast.success("Sampling request approved");
                    }
                    toast.dismiss(toastId);
                  }}
                  onDeny={() => {
                    const server = baseContext.getServer(config.id);
                    if (server) {
                      server.rejectSampling(
                        request.id,
                        "User denied sampling request from toast"
                      );
                      toast.error("Sampling request denied");
                    }
                    toast.dismiss(toastId);
                  }}
                />,
                { duration: 5000 }
              );
            });
          }
        },
        // Toast notifications for elicitation requests
        onElicitationRequest: (request: PendingElicitationRequest) => {
          if (typeof window !== "undefined") {
            import("sonner").then(({ toast }) => {
              const toastId = toast(
                <ElicitationRequestToast
                  requestId={request.id}
                  serverName={request.serverName}
                  mode={request.request.mode || "form"}
                  message={request.request.message}
                  url={
                    request.request.mode === "url"
                      ? (request.request as any).url
                      : undefined
                  }
                  onViewDetails={() => {
                    const event = new globalThis.CustomEvent(
                      "navigate-to-elicitation",
                      { detail: { requestId: request.id } }
                    );
                    window.dispatchEvent(event);
                    toast.dismiss(toastId);
                  }}
                  onOpenUrl={
                    request.request.mode === "url"
                      ? () => {
                          window.open((request.request as any).url, "_blank");
                          toast.dismiss(toastId);
                        }
                      : undefined
                  }
                  onCancel={() => {
                    const server = baseContext.getServer(config.id);
                    if (server) {
                      server.rejectElicitation(
                        request.id,
                        "User cancelled elicitation request from toast"
                      );
                      toast.error("Elicitation request cancelled");
                    }
                    toast.dismiss(toastId);
                  }}
                />,
                { duration: 5000 }
              );
            });
          }
        },
        // Notification received handler (optional additional logging)
        onNotificationReceived: (notification: McpNotification) => {
          console.log("[McpContext] Notification received:", notification);
        },
      };

      baseContext.addServer(config.id, options);
    });
  }, [
    configLoaded,
    autoConnect,
    wrapTransportReady,
    connectionConfigs,
    embedded,
    baseContext,
  ]);

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
      const id = url;

      // Check if connection already exists
      const existingConfig = connectionConfigs.find((c) => c.id === id);
      if (existingConfig) {
        // Check if we're trying to update the proxy config
        const proxyConfigChanged =
          JSON.stringify(existingConfig.proxyConfig) !==
          JSON.stringify(proxyConfig);

        if (proxyConfigChanged && proxyConfig) {
          // Remove and re-add with new config
          setConnectionConfigs((prev) => prev.filter((c) => c.id !== id));
          baseContext.removeServer(id);

          setTimeout(() => {
            const newConfig: ConnectionConfig = {
              id,
              url,
              name: name || existingConfig.name || "MCP Server",
              proxyConfig,
              transportType: transportType || existingConfig.transportType,
            };
            setConnectionConfigs((prev) => [...prev, newConfig]);
          }, 10);
          return;
        }
        return;
      }

      // New connection
      const newConfig: ConnectionConfig = {
        id,
        url,
        name: name || "MCP Server",
        proxyConfig,
        transportType,
      };

      setConnectionConfigs((prev) => [...prev, newConfig]);
    },
    [connectionConfigs, baseContext]
  );

  const removeConnection = useCallback(
    (id: string) => {
      baseContext.removeServer(id);
      setConnectionConfigs((prev) => prev.filter((c) => c.id !== id));

      // Track removal
      Telemetry.getInstance().capture(
        new MCPServerRemovedEvent({ serverId: id })
      );
    },
    [baseContext]
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

      // For config changes, we need to reconnect
      // Remove and re-add the server
      baseContext.removeServer(id);
      setTimeout(() => {
        const configToUpdate = connectionConfigs.find((c) => c.id === id);
        if (configToUpdate) {
          addConnection(
            configToUpdate.url,
            config.name || configToUpdate.name,
            config.proxyConfig || configToUpdate.proxyConfig,
            config.transportType || configToUpdate.transportType
          );
        }
      }, 10);
    },
    [connectionConfigs, baseContext, addConnection]
  );

  const connectServer = useCallback(
    (id: string) => {
      // Trigger reconnection by finding the config and re-adding
      const config = connectionConfigs.find((c) => c.id === id);
      if (config) {
        baseContext.removeServer(id);
        setTimeout(() => {
          addConnection(
            config.url,
            config.name,
            config.proxyConfig,
            config.transportType
          );
        }, 10);
      }
    },
    [connectionConfigs, baseContext, addConnection]
  );

  const disconnectServer = useCallback(
    (id: string) => {
      const server = baseContext.getServer(id);
      if (server?.disconnect) {
        server.disconnect();
      }
    },
    [baseContext]
  );

  // Convert base servers to MCPConnection format with extra metadata
  const connections: MCPConnection[] = useMemo(() => {
    return baseContext.servers.map((server: McpServer): MCPConnection => {
      const config = connectionConfigs.find((c) => c.id === server.id);
      return {
        ...server,
        customHeaders: config?.proxyConfig?.customHeaders,
        transportType: config?.transportType,
        proxyConfig: config?.proxyConfig,
      };
    });
  }, [baseContext.servers, connectionConfigs]);

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
    <McpContext.Provider value={contextValue}>{children}</McpContext.Provider>
  );
}
