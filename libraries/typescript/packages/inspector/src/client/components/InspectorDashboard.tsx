import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { NotFound } from "@/client/components/ui/not-found";
import { MESH_PANEL_FINE_OVERLAY_NOISE_DATA_URL } from "@/client/components/ui/random-gradient-background";
import { MeshGradient } from "@paper-design/shaders-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  MCPServerAddedEvent,
  MCPServerConnectionEvent,
  MCPServerRemovedEvent,
  Telemetry,
} from "@/client/telemetry";
import {
  CircleMinus,
  Copy,
  Info,
  Loader2,
  MoreVertical,
  Play,
  RotateCcw,
  Settings,
  Square,
} from "lucide-react";
import {
  useMcpClient,
  type McpServer,
  type McpServerOptions,
} from "mcp-use/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/client/utils/clipboard";
import {
  getStoredConnectionConfig,
  isAliasOnlyConnectionUpdate,
  type EditableConnectionConfig,
} from "@/client/utils/connectionUpdates";
import {
  getConfiguredServerAlias,
  getServerDisplayName,
} from "@/client/utils/serverNames";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { ConnectionSettingsForm } from "./ConnectionSettingsForm";
import type { CustomHeader } from "./CustomHeadersEditor";
import { ServerCapabilitiesModal } from "./ServerCapabilitiesModal";
import { ServerConnectionModal } from "./ServerConnectionModal";
import { ServerIcon } from "./ServerIcon";

const CONNECT_PANEL_MESH_ANIMATION_PAUSED_KEY =
  "mcp-inspector-connect-panel-mesh-animation-paused";

/**
 * Render the MCP Inspector dashboard for managing, testing, and navigating to MCP servers.
 *
 * This component displays a list of saved connections, a connection settings form, and controls
 * for adding, editing, removing, resyncing, and inspecting servers. It adapts older add/update/remove
 * semantics to the newer client API, persists UI state (timeouts, headers, OAuth fields), tracks
 * transient connection and navigation state, and opens modals for connection editing and server
 * capabilities. Telemetry for inspector opens and server additions is emitted.
 *
 * Proxy fallback is handled automatically by useMcp's built-in autoProxyFallback feature.
 *
 * @returns A JSX element representing the Inspector dashboard UI.
 */
export function InspectorDashboard() {
  const {
    servers: connections,
    addServer,
    removeServer: removeConnection,
    updateServerMetadata,
    updateServer,
  } = useMcpClient();

  // Track which server connections have been reported to telemetry (dedup)
  const reportedConnectionsRef = useRef<Set<string>>(new Set());

  // Track server connection state transitions for telemetry
  useEffect(() => {
    connections.forEach((connection) => {
      if (
        connection.state === "ready" &&
        !reportedConnectionsRef.current.has(connection.id)
      ) {
        reportedConnectionsRef.current.add(connection.id);
        try {
          Telemetry.getInstance()
            .capture(
              new MCPServerConnectionEvent({
                serverId: connection.id,
                serverUrl: connection.url,
                success: true,
                connectionType: "http",
              })
            )
            .catch(() => {});
        } catch {
          // ignore telemetry errors
        }
      } else if (
        connection.state === "failed" &&
        reportedConnectionsRef.current.has(connection.id)
      ) {
        reportedConnectionsRef.current.delete(connection.id);
      }
    });
  }, [connections]);

  // Wrapper to track server removal in telemetry
  const handleRemoveConnection = useCallback(
    (connectionId: string) => {
      try {
        Telemetry.getInstance()
          .capture(new MCPServerRemovedEvent({ serverId: connectionId }))
          .catch(() => {});
      } catch {
        // ignore telemetry errors
      }
      reportedConnectionsRef.current.delete(connectionId);
      removeConnection(connectionId);
    },
    [removeConnection]
  );

  // Track concurrent updates to prevent race conditions
  const [updatingConnections, setUpdatingConnections] = useState<Set<string>>(
    new Set()
  );
  const updatingConnectionsRef = useRef<Set<string>>(new Set());

  // Keep ref in sync with state
  useEffect(() => {
    updatingConnectionsRef.current = updatingConnections;
  }, [updatingConnections]);

  // Adapter functions for backward compatibility
  const addConnection = useCallback(
    (
      url: string,
      name?: string,
      proxyConfig?: any,
      transportType?: "http" | "sse"
    ) => {
      addServer(url, {
        url,
        name,
        proxyConfig,
        transportType,
      });
    },
    [addServer]
  );

  const updateConnectionConfig = useCallback(
    async (
      id: string,
      config: {
        name?: string;
        proxyConfig?: {
          proxyAddress?: string;
          headers?: Record<string, string>;
        };
        transportType?: "http" | "sse";
      }
    ) => {
      // Check if already updating this connection
      if (updatingConnectionsRef.current.has(id)) {
        console.warn(
          `[InspectorDashboard] Connection ${id} is already being updated, skipping`
        );
        return;
      }

      // Mark as updating
      setUpdatingConnections((prev) => new Set(prev).add(id));

      try {
        // Use the new updateServer method for atomic updates
        await updateServer(id, config);
      } catch (error) {
        console.error(
          `[InspectorDashboard] Failed to update connection ${id}:`,
          error
        );
      } finally {
        // Clear the updating flag
        setUpdatingConnections((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
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
          `[InspectorDashboard] Failed to update connection metadata for ${id}:`,
          error
        );
      }
    },
    [updateServerMetadata]
  );

  const connectServer = useCallback(
    async (id: string) => {
      // Check if already updating this connection
      if (updatingConnectionsRef.current.has(id)) {
        console.warn(
          `[InspectorDashboard] Connection ${id} is already being reconnected, skipping`
        );
        return;
      }

      const server = connections.find((s) => s.id === id);
      if (!server) return;

      // Mark as updating
      setUpdatingConnections((prev) => new Set(prev).add(id));

      try {
        // Trigger reconnection by updating with the same config (forces disconnect/reconnect)
        await updateServer(id, {
          url: server.url,
          name: server.name,
        });
      } catch (error) {
        console.error(
          `[InspectorDashboard] Failed to reconnect server ${id}:`,
          error
        );
      } finally {
        // Clear the updating flag
        setUpdatingConnections((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [connections, updateServer]
  );

  const navigate = useNavigate();
  const location = useLocation();
  const [_connectingServers, setConnectingServers] = useState<Set<string>>(
    new Set()
  );
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null
  );
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null
  );
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [infoModalConnection, setInfoModalConnection] = useState<any | null>(
    null
  );

  // Track inspector open on mount
  useEffect(() => {
    const telemetry = Telemetry.getInstance();
    telemetry
      .trackInspectorOpen({
        connectionCount: connections.length,
      })
      .catch(() => {
        // Silently fail - telemetry should not break the application
      });
  }, []); // Only run once on mount

  // Form state
  const [alias, setAlias] = useState("");
  const [url, setUrl] = useState("");
  const [connectionType, setConnectionType] = useState("Direct");
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([]);
  const [requestTimeout, setRequestTimeout] = useState("10000");
  const [resetTimeoutOnProgress, setResetTimeoutOnProgress] = useState("True");
  const [maxTotalTimeout, setMaxTotalTimeout] = useState("60000");
  const [proxyAddress, setProxyAddress] = useState(
    `${window.location.origin}/inspector/api/proxy`
  );
  // OAuth fields
  const [clientId, setClientId] = useState("");
  const [scope, setScope] = useState("");

  const connectFormGradientRef = useRef<HTMLDivElement>(null);
  const [connectFormGradientSize, setConnectFormGradientSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const measureConnectFormGradient = useCallback(() => {
    if (connectFormGradientRef.current) {
      const { width, height } =
        connectFormGradientRef.current.getBoundingClientRect();
      setConnectFormGradientSize({
        width: Math.round(width),
        height: Math.round(height),
      });
    }
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(measureConnectFormGradient);
    const ro = new ResizeObserver(measureConnectFormGradient);
    if (connectFormGradientRef.current) {
      ro.observe(connectFormGradientRef.current);
    }
    window.addEventListener("resize", measureConnectFormGradient);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measureConnectFormGradient);
    };
  }, [measureConnectFormGradient]);

  const [meshAnimationPaused, setMeshAnimationPaused] = useState(() => {
    try {
      return (
        localStorage.getItem(CONNECT_PANEL_MESH_ANIMATION_PAUSED_KEY) === "true"
      );
    } catch {
      return false;
    }
  });

  const toggleMeshAnimationPaused = useCallback(() => {
    setMeshAnimationPaused((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(
          CONNECT_PANEL_MESH_ANIMATION_PAUSED_KEY,
          next ? "true" : "false"
        );
      } catch {
        // ignore quota / private mode
      }
      return next;
    });
  }, []);

  const handleAddConnection = useCallback(() => {
    if (!url.trim()) return;

    // Validate URL format and auto-add https:// if protocol is missing
    let normalizedUrl = url.trim();
    try {
      const parsedUrl = new URL(normalizedUrl);
      const isValid =
        parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

      if (!isValid) {
        toast.error("Invalid URL protocol. Please use http:// or https://");
        return;
      }
    } catch (error) {
      // If parsing fails, try adding https:// prefix
      try {
        const urlWithHttps = `https://${normalizedUrl}`;
        const parsedUrl = new URL(urlWithHttps);
        const isValid =
          parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

        if (!isValid) {
          toast.error("Invalid URL protocol. Please use http:// or https://");
          return;
        }
        // Use the normalized URL with https://
        normalizedUrl = urlWithHttps;
      } catch (retryError) {
        toast.error("Invalid URL format. Please enter a valid URL.");
        return;
      }
    }

    // Convert custom headers array to object
    const headersObject = customHeaders.reduce(
      (acc, header) => {
        if (header.name && header.value) {
          acc[header.name] = header.value;
        }
        return acc;
      },
      {} as Record<string, string>
    );

    // Prepare proxy configuration if "Via Proxy" is selected
    const proxyConfig =
      connectionType === "Via Proxy" && proxyAddress.trim()
        ? {
            proxyAddress: proxyAddress.trim(),
            headers: headersObject,
          }
        : undefined;

    // Build server configuration with proper typing
    const serverConfig: McpServerOptions = {
      url: normalizedUrl,
      name: alias.trim() || normalizedUrl,
      transportType: "http",
      preventAutoAuth: true, // Prevent auto OAuth popup - user must click "Authenticate" button
      clientOptions: {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html;profile=mcp-app"],
            },
          },
        },
      },
      ...(proxyConfig
        ? {
            proxyConfig,
            // Disable autoProxyFallback when proxy is explicitly configured
            // User has chosen "Via Proxy" - use proxy from the start
            autoProxyFallback: false,
          }
        : {}),
      ...(Object.keys(headersObject).length > 0 && !proxyConfig
        ? { headers: headersObject }
        : {}),
    };

    // Add server directly - useMcp handles proxy fallback automatically via autoProxyFallback
    addServer(normalizedUrl, serverConfig);

    // Track server added
    const telemetry = Telemetry.getInstance();
    telemetry
      .capture(
        new MCPServerAddedEvent({
          serverId: url.trim(),
          serverUrl: url.trim(),
          connectionType: "http",
          viaProxy: !!proxyConfig?.proxyAddress,
        })
      )
      .catch(() => {
        // Silently fail - telemetry should not break the application
      });

    // Reset form
    setAlias("");
    setUrl("");
    setCustomHeaders([]);
    setClientId("");
    setScope("");

    toast.success("Server added successfully");
  }, [url, alias, connectionType, proxyAddress, customHeaders, addServer]);

  const handleClearAllConnections = () => {
    // Remove all connections
    connections.forEach((connection) => {
      handleRemoveConnection(connection.id);
    });
  };

  const handleCopyError = async (errorMessage: string) => {
    try {
      await copyToClipboard(errorMessage);
      toast.success("Error message copied to clipboard");
    } catch {
      toast.error("Failed to copy error message");
    }
  };

  const handleCopyConnectionConfig = async (connection: any) => {
    try {
      // Try to get the original stored config from localStorage
      // This contains the proxyConfig and customHeaders that were originally saved
      let storedConfig: any = null;
      try {
        const stored = localStorage.getItem("mcp-inspector-connections");
        if (stored) {
          const allServers = JSON.parse(stored);
          storedConfig = allServers[connection.id];
        }
      } catch (e) {
        // If we can't read from localStorage, fall back to connection object
        console.warn(
          "[InspectorDashboard] Could not read from localStorage:",
          e
        );
      }

      // Extract headers from stored config (which has the original proxyConfig)
      // Check both 'headers' and 'customHeaders' for backwards compatibility
      const customHeaders =
        storedConfig?.proxyConfig?.headers ||
        storedConfig?.proxyConfig?.customHeaders ||
        storedConfig?.headers ||
        storedConfig?.customHeaders ||
        connection.proxyConfig?.headers ||
        connection.proxyConfig?.customHeaders ||
        connection.headers ||
        connection.customHeaders ||
        {};

      // Determine connection type and proxyConfig
      const hasProxyAddress =
        storedConfig?.proxyConfig?.proxyAddress ||
        connection.proxyConfig?.proxyAddress;
      const connectionType = hasProxyAddress ? "Via Proxy" : "Direct";
      const proxyConfig = hasProxyAddress
        ? storedConfig?.proxyConfig || connection.proxyConfig
        : undefined;

      const config = {
        url: connection.url,
        ...(getConfiguredServerAlias(storedConfig || connection)
          ? { name: getConfiguredServerAlias(storedConfig || connection) }
          : {}),
        transportType: connection.transportType || "http",
        connectionType,
        proxyConfig,
        customHeaders,
        requestTimeout: connection.requestTimeout || 10000,
        resetTimeoutOnProgress: connection.resetTimeoutOnProgress !== false,
        maxTotalTimeout: connection.maxTotalTimeout || 60000,
        oauth: connection.oauth,
      };

      await copyToClipboard(JSON.stringify(config, null, 2));
      toast.success("Connection configuration copied to clipboard");
    } catch {
      toast.error("Failed to copy connection configuration");
    }
  };

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  const handleUpdateConnection = useCallback(
    (config: EditableConnectionConfig) => {
      if (!editingConnectionId) return;

      const currentConnection =
        getStoredConnectionConfig<EditableConnectionConfig>(
          editingConnectionId
        ) ||
        connections.find(
          (connection: McpServer) => connection.id === editingConnectionId
        );

      // If the URL changed, we need to remove the old one and add a new one
      if (config.url !== editingConnectionId) {
        removeConnection(editingConnectionId);
        addConnection(
          config.url,
          config.name,
          config.proxyConfig,
          config.transportType
        );
      } else if (
        currentConnection &&
        isAliasOnlyConnectionUpdate(currentConnection, config)
      ) {
        updateConnectionMetadata(editingConnectionId, {
          name: config.name || config.url,
        });
      } else {
        // Otherwise just update the existing connection
        updateConnectionConfig(editingConnectionId, {
          name: config.name,
          proxyConfig: config.proxyConfig,
          transportType: config.transportType,
        });
      }

      // Close the modal
      setEditingConnectionId(null);

      toast.success("Connection settings updated");
    },
    [
      editingConnectionId,
      connections,
      removeConnection,
      addConnection,
      updateConnectionMetadata,
      updateConnectionConfig,
    ]
  );

  const handleServerClick = (connection: any) => {
    // Don't allow clicking failed connections - use the reload button instead
    if (connection.state === "failed") {
      return;
    }

    if (connection.state !== "ready") {
      toast.error("Server is not connected and cannot be inspected");
      return;
    }
    // Preserve tunnelUrl and tab parameters if present
    const urlParams = new URLSearchParams(location.search);
    const tunnelUrl = urlParams.get("tunnelUrl");
    const tab = urlParams.get("tab");
    const params = new URLSearchParams();
    params.set("server", connection.id);
    if (tunnelUrl) params.set("tunnelUrl", tunnelUrl);
    if (tab) params.set("tab", tab);
    navigate(`/?${params.toString()}`);
  };

  const handleReconnect = (connection: any) => {
    console.log("[InspectorDashboard] Reconnecting server:", connection.id);
    if (connection.state === "failed" && connection.retry) {
      connection.retry();
    } else {
      connectServer(connection.id);
    }
  };

  // Monitor connecting servers and remove them from the set when they connect or fail
  useEffect(() => {
    setConnectingServers((prev) => {
      const next = new Set(prev);
      let changed = false;
      prev.forEach((serverId) => {
        const connection = connections.find((c) => c.id === serverId);
        if (
          connection &&
          (connection.state === "ready" || connection.state === "failed")
        ) {
          next.delete(serverId);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [connections]);

  // Monitor pending navigation and navigate when server becomes ready
  useEffect(() => {
    if (!pendingNavigation) return;

    const connection = connections.find((c) => c.id === pendingNavigation);
    const hasData =
      (connection?.tools?.length || 0) > 0 ||
      (connection?.resources?.length || 0) > 0 ||
      (connection?.prompts?.length || 0) > 0;

    // Navigate if connection is ready OR if it has loaded some data (partial success)
    if (
      connection &&
      (connection.state === "ready" ||
        (hasData && connection.state !== "discovering"))
    ) {
      setPendingNavigation(null);
      // Preserve tunnelUrl and tab parameters if present
      const urlParams = new URLSearchParams(location.search);
      const tunnelUrl = urlParams.get("tunnelUrl");
      const tab = urlParams.get("tab");
      const params = new URLSearchParams();
      params.set("server", connection.id);
      if (tunnelUrl) params.set("tunnelUrl", tunnelUrl);
      if (tab) params.set("tab", tab);
      navigate(`/?${params.toString()}`);
    }
    // Only cancel navigation if connection truly failed with no data loaded
    else if (
      connection &&
      connection.state === "failed" &&
      !hasData &&
      connection.error
    ) {
      console.warn(
        "[InspectorDashboard] Connection failed with no data, canceling navigation"
      );
      setPendingNavigation(null);
    }
  }, [connections, pendingNavigation, navigate]);

  return (
    <div className="flex flex-col lg:flex-row items-start justify-start gap-4 h-auto lg:h-full relative">
      <div className="w-full px-3 pt-6 sm:px-6 sm:pt-3 overflow-visible lg:overflow-auto">
        <div className="flex mb-3 md:mb-0 flex-col sm:flex-row items-center sm:items-center gap-3 relative z-10">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/mcp-use/mcp-use"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block order-1 sm:order-2"
              >
                <Badge
                  variant="secondary"
                  className="text-xs cursor-pointer hover:bg-secondary/80 transition-colors"
                >
                  v
                  {(typeof window !== "undefined" &&
                    (window as any).__INSPECTOR_VERSION__) ||
                    "1.0.0"}
                </Badge>
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <p>Visit GitHub</p>
            </TooltipContent>
          </Tooltip>
          <h2 className="text-2xl font-medium tracking-tight text-center sm:text-left order-2 sm:order-1">
            MCP Inspector
          </h2>
        </div>
        <p className="text-muted-foreground relative z-10 text-center sm:text-left">
          Inspect and debug MCP (Model Context Protocol) servers
        </p>

        <div className="space-y-4 mt-4 sm:mt-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-center justify-between gap-3">
            <h3 className="hidden sm:block text-base font-medium text-center sm:text-left">
              Connected Servers
            </h3>
            <div className="hidden sm:flex items-center gap-3 justify-center sm:justify-start">
              {connections.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAllConnections}
                >
                  Clear All
                </Button>
              )}
            </div>
          </div>
          {connections.length === 0 ? (
            <NotFound message="No servers connected yet. Add a server above to get started." />
          ) : (
            <div className="grid gap-3">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  data-testid={`server-tile-${connection.id}`}
                  onClick={() => handleServerClick(connection)}
                  className={`group rounded-lg bg-zinc-100 dark:bg-white/10 p-4 transition-colors ${
                    connection.state === "ready"
                      ? "hover:bg-zinc-200 dark:hover:bg-white/15 cursor-pointer"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <ServerIcon server={connection} size="md" />
                        <h4 className="font-semibold text-sm">
                          {getServerDisplayName(connection)}
                        </h4>
                        <div className="flex items-center gap-2">
                          {updatingConnections.has(connection.id) ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                          ) : connection.error &&
                            connection.state !== "ready" ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  data-testid={`server-tile-status-${connection.state}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyError(connection.error!);
                                  }}
                                  className={`w-2 h-2 rounded-full transition-colors ${
                                    (connection.error.includes("401") ||
                                      connection.error.includes(
                                        "Unauthorized"
                                      )) &&
                                    connection.error.includes(
                                      "does not support OAuth"
                                    )
                                      ? "bg-yellow-500 animate-status-pulse-yellow hover:bg-yellow-600"
                                      : "bg-rose-500 animate-status-pulse-red hover:bg-rose-600"
                                  }`}
                                  title="Click to copy error message"
                                  aria-label="Copy error message to clipboard"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">{connection.error}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <div
                              data-testid={`server-tile-status-${connection.state}`}
                              className={`w-2 h-2 rounded-full ${
                                connection.state === "ready"
                                  ? "bg-emerald-600 animate-status-pulse"
                                  : connection.state === "failed"
                                    ? "bg-rose-600 animate-status-pulse-red"
                                    : "bg-yellow-500 animate-status-pulse-yellow"
                              }`}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground dark:text-zinc-400 font-mono">
                          {connection.url}
                        </p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await copyToClipboard(connection.url);
                                  toast.success("URL copied to clipboard");
                                } catch {
                                  toast.error("Failed to copy URL");
                                }
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded"
                              title="Copy URL"
                            >
                              <Copy className="w-3 h-3 text-muted-foreground" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Copy URL</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    {/* Desktop: Show all action buttons */}
                    <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            data-testid="server-tile-copy-config"
                            variant="secondary"
                            size="sm"
                            onClick={(e) =>
                              handleActionClick(e, () =>
                                handleCopyConnectionConfig(connection)
                              )
                            }
                            className="h-8 w-8 p-0"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Copy connection config</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            data-testid="server-tile-info"
                            variant="secondary"
                            size="sm"
                            onClick={(e) =>
                              handleActionClick(e, () => {
                                setInfoModalConnection(connection);
                                setInfoModalOpen(true);
                              })
                            }
                            className="h-8 w-8 p-0"
                          >
                            <Info className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>View server info</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            data-testid="server-tile-settings"
                            variant="secondary"
                            size="sm"
                            onClick={(e) =>
                              handleActionClick(e, () =>
                                setEditingConnectionId(connection.id)
                              )
                            }
                            className="h-8 w-8 p-0"
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Edit connection settings</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            data-testid="server-tile-remove"
                            variant="secondary"
                            size="sm"
                            onClick={(e) =>
                              handleActionClick(e, () =>
                                handleRemoveConnection(connection.id)
                              )
                            }
                            className="h-8 w-8 p-0"
                          >
                            <CircleMinus className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Remove connection</p>
                        </TooltipContent>
                      </Tooltip>
                      {(connection.state === "ready" ||
                        connection.state === "failed" ||
                        connection.state === "discovering") && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              data-testid="server-tile-reconnect"
                              variant="secondary"
                              size="sm"
                              onClick={(e) =>
                                handleActionClick(e, () =>
                                  handleReconnect(connection)
                                )
                              }
                              className="h-8 w-8 p-0"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              {connection.state === "failed"
                                ? "Retry connection"
                                : connection.state === "discovering"
                                  ? "Reconnect"
                                  : "Resync connection"}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {/* Mobile: Show 3-dots overflow menu */}
                    <div className="lg:hidden flex-shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyConnectionConfig(connection);
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy connection config
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setInfoModalConnection(connection);
                              setInfoModalOpen(true);
                            }}
                          >
                            <Info className="h-4 w-4 mr-2" />
                            View server info
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingConnectionId(connection.id);
                            }}
                          >
                            <Settings className="h-4 w-4 mr-2" />
                            Edit connection settings
                          </DropdownMenuItem>
                          {(connection.state === "ready" ||
                            connection.state === "failed" ||
                            connection.state === "discovering") && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReconnect(connection);
                              }}
                            >
                              <RotateCcw className="h-4 w-4 mr-2" />
                              {connection.state === "failed"
                                ? "Retry connection"
                                : connection.state === "discovering"
                                  ? "Reconnect"
                                  : "Resync connection"}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveConnection(connection.id);
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <CircleMinus className="h-4 w-4 mr-2" />
                            Remove connection
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {(connection.state === "pending_auth" ||
                    connection.state === "authenticating") && (
                    <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                      {connection.state === "authenticating" ? (
                        <Button
                          size="sm"
                          className="bg-yellow-500/20 border-0 dark:bg-yellow-400/10 text-yellow-800 dark:text-yellow-500"
                          variant="outline"
                          disabled
                        >
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Authenticating...
                        </Button>
                      ) : connection.authUrl ? (
                        <Button
                          data-testid="server-tile-authenticate"
                          size="sm"
                          className="bg-yellow-500/20 border-0 dark:bg-yellow-400/10 text-yellow-800 dark:text-yellow-500"
                          variant="outline"
                          asChild
                        >
                          <a
                            href={connection.authUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Authenticate
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  )}
                  {connection.state === "failed" &&
                    connection.error &&
                    (connection.error.includes("401") ||
                      connection.error.includes("Unauthorized")) &&
                    connection.error.includes("does not support OAuth") && (
                      <div className="text-sm mt-2 p-2 bg-yellow-500/10 dark:bg-yellow-400/10 border border-yellow-500/20 dark:border-yellow-400/20 rounded text-yellow-800 dark:text-yellow-400">
                        {connection.error}
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        ref={connectFormGradientRef}
        className="w-full relative overflow-hidden h-auto lg:h-full py-4 px-4 sm:py-6 sm:px-6 lg:p-10 items-center justify-center flex"
      >
        <div className="absolute inset-0 z-0 overflow-hidden dark:opacity-60 pointer-events-none">
          <MeshGradient
            width={connectFormGradientSize?.width ?? 1280}
            height={connectFormGradientSize?.height ?? 720}
            colors={["#e0eaff", "#f9ffbd", "#dedede", "#ffffff"]}
            distortion={0.8}
            swirl={0.1}
            grainMixer={0}
            grainOverlay={0.2}
            speed={meshAnimationPaused ? 0 : 1}
          />
        </div>
        <div
          className="absolute inset-0 z-[1] pointer-events-none opacity-[0.07] mix-blend-soft-light dark:opacity-[0.06]"
          aria-hidden
        >
          <div
            className="absolute inset-0 noise"
            style={{
              background: `url("${MESH_PANEL_FINE_OVERLAY_NOISE_DATA_URL}")`,
              filter: "contrast(150%) brightness(550%)",
            }}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleMeshAnimationPaused}
              aria-label={
                meshAnimationPaused
                  ? "Enable background shader animation"
                  : "Disable background shader animation"
              }
              className="absolute bottom-3 right-3 sm:bottom-5 sm:right-5 z-[8] flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-zinc-500/60 bg-transparent text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-800 dark:border-zinc-500/50 dark:text-zinc-400 dark:hover:border-zinc-400 dark:hover:text-zinc-200"
            >
              {meshAnimationPaused ? (
                <Play className="h-3 w-3 ml-px" fill="currentColor" />
              ) : (
                <Square className="h-2.5 w-2.5" fill="currentColor" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>
              {meshAnimationPaused
                ? "Enable shader animation"
                : "Disable shader animation"}
            </p>
          </TooltipContent>
        </Tooltip>
        <div className="relative w-full max-w-xl mx-auto z-10 flex flex-col gap-3 rounded-3xl p-4 sm:p-6 bg-black/70 dark:bg-black/90 shadow-2xl shadow-black/50 backdrop-blur-md">
          <ConnectionSettingsForm
            alias={alias}
            setAlias={setAlias}
            url={url}
            setUrl={setUrl}
            connectionType={connectionType}
            setConnectionType={setConnectionType}
            customHeaders={customHeaders}
            setCustomHeaders={setCustomHeaders}
            requestTimeout={requestTimeout}
            setRequestTimeout={setRequestTimeout}
            resetTimeoutOnProgress={resetTimeoutOnProgress}
            setResetTimeoutOnProgress={setResetTimeoutOnProgress}
            maxTotalTimeout={maxTotalTimeout}
            setMaxTotalTimeout={setMaxTotalTimeout}
            proxyAddress={proxyAddress}
            setProxyAddress={setProxyAddress}
            clientId={clientId}
            setClientId={setClientId}
            scope={scope}
            setScope={setScope}
            onConnect={handleAddConnection}
            variant="styled"
            showConnectButton={true}
            showExportButton={true}
          />
        </div>
      </div>

      {/* Connection Options Dialog */}
      <ServerConnectionModal
        connection={
          editingConnectionId
            ? connections.find((c) => c.id === editingConnectionId) || null
            : null
        }
        open={editingConnectionId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingConnectionId(null);
          }
        }}
        onConnect={handleUpdateConnection}
      />

      {/* Server Info Modal */}
      <ServerCapabilitiesModal
        open={infoModalOpen}
        onOpenChange={setInfoModalOpen}
        connection={infoModalConnection}
      />
    </div>
  );
}
