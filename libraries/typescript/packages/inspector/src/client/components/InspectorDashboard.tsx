import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Label } from "@/client/components/ui/label";
import { NotFound } from "@/client/components/ui/not-found";
import { RandomGradientBackground } from "@/client/components/ui/random-gradient-background";
import { Switch } from "@/client/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useMcpContext } from "@/client/context/McpContext";
import { MCPServerAddedEvent, Telemetry } from "@/client/telemetry";
import {
  CircleMinus,
  Copy,
  Loader2,
  MoreVertical,
  RotateCcw,
  Settings,
} from "lucide-react";
import { useMcp } from "mcp-use/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConnectionSettingsForm } from "./ConnectionSettingsForm";
import type { CustomHeader } from "./CustomHeadersEditor";
import { ServerConnectionModal } from "./ServerConnectionModal";
import { ServerIcon } from "./ServerIcon";

// Temporary connection tester component
function ConnectionTester({
  config,
  onSuccess,
  onFailure,
}: {
  config: {
    url: string;
    name: string;
    proxyConfig?: {
      proxyAddress?: string;
      proxyToken?: string;
      customHeaders?: Record<string, string>;
    };
    transportType?: "http" | "sse";
  };
  onSuccess: () => void;
  onFailure: (error: string) => void;
}) {
  const callbackUrl =
    typeof window !== "undefined"
      ? new URL("/inspector/oauth/callback", window.location.origin).toString()
      : "/inspector/oauth/callback";

  // Validate and apply proxy configuration
  let finalUrl = config.url;
  let customHeaders: Record<string, string> = {};
  let urlError: string | null = null;

  try {
    if (config.proxyConfig?.proxyAddress) {
      const proxyUrl = new URL(config.proxyConfig.proxyAddress);
      const originalUrl = new URL(config.url);
      finalUrl = `${proxyUrl.origin}${proxyUrl.pathname}${originalUrl.pathname}${originalUrl.search}`;

      customHeaders["X-Target-URL"] = config.url;
    } else {
      // Validate the URL even if not using proxy
      new URL(config.url);
    }
  } catch (err) {
    urlError = `Invalid URL format. Please include the protocol (http:// or https://).\nExample: https://${config.url}`;
  }

  if (config.proxyConfig?.customHeaders) {
    customHeaders = { ...customHeaders, ...config.proxyConfig.customHeaders };
  }

  // Show error immediately if URL is invalid
  useEffect(() => {
    if (urlError) {
      onFailure(urlError);
    }
  }, [urlError, onFailure]);

  const mcpHook = useMcp({
    url: urlError ? undefined : finalUrl, // Don't connect if URL is invalid
    callbackUrl,
    customHeaders:
      Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    transportType: config.transportType || "http",
    enabled: !urlError, // Disable connection if URL is invalid
  });

  const hasCalledRef = useRef(false);

  useEffect(() => {
    if (hasCalledRef.current) return;

    if (mcpHook.state === "ready") {
      hasCalledRef.current = true;
      // Don't clear storage on success - we want to keep the connection alive
      // The real McpConnectionWrapper will take over
      onSuccess();
    } else if (
      mcpHook.state === "authenticating" ||
      mcpHook.state === "pending_auth"
    ) {
      // Authentication is in progress - keep waiting for OAuth callback
    } else if (mcpHook.state === "failed" && mcpHook.error) {
      // If there's an authUrl available, authentication is in progress - don't fail yet
      if (mcpHook.authUrl) {
        return;
      }
      hasCalledRef.current = true;
      const errorMessage = mcpHook.error;
      // Clear storage on failure to clean up the failed connection attempt
      mcpHook.clearStorage();
      onFailure(errorMessage);
    }
  }, [
    mcpHook.state,
    mcpHook.error,
    mcpHook.authUrl,
    onSuccess,
    onFailure,
    mcpHook,
  ]);

  return null;
}

export function InspectorDashboard() {
  const mcpContext = useMcpContext();
  const {
    connections,
    addConnection,
    removeConnection,
    updateConnectionConfig,
    autoConnect,
    setAutoConnect,
    connectServer,
    disconnectServer: _disconnectServer,
  } = mcpContext;
  const navigate = useNavigate();
  const location = useLocation();
  const [connectingServers, setConnectingServers] = useState<Set<string>>(
    new Set()
  );
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null
  );
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null
  );

  // Log connections on every render to debug
  console.warn(
    "[InspectorDashboard] Render - connections:",
    connections.map((c) => ({ id: c.id, state: c.state }))
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
  const [transportType, setTransportType] = useState("SSE");
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
  const [redirectUrl, setRedirectUrl] = useState(
    typeof window !== "undefined"
      ? new URL("/inspector/oauth/callback", window.location.origin).toString()
      : "/inspector/oauth/callback"
  );
  const [scope, setScope] = useState("");

  // UI state
  const [isConnecting, setIsConnecting] = useState(false);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const hasShownToastRef = useRef(false);
  const [hasTriedBothConnectionTypes, setHasTriedBothConnectionTypes] =
    useState(false);
  const [pendingConnectionConfig, setPendingConnectionConfig] = useState<{
    url: string;
    name: string;
    proxyConfig?: {
      proxyAddress?: string;
      customHeaders?: Record<string, string>;
    };
    transportType?: "http" | "sse";
  } | null>(null);

  // Load auto-switch setting from localStorage on mount
  useEffect(() => {
    const autoSwitchSetting = localStorage.getItem("mcp-inspector-auto-switch");
    if (autoSwitchSetting !== null) {
      setAutoSwitch(autoSwitchSetting === "true");
    }
  }, []);

  const handleAddConnection = useCallback(
    (isRetry = false, overrideConnectionType?: string) => {
      if (!url.trim()) return;

      setIsConnecting(true);
      hasShownToastRef.current = false;
      if (!isRetry) {
        setHasTriedBothConnectionTypes(false);
      }

      // Use overridden connection type if provided (for retry logic), otherwise use state
      const effectiveConnectionType = overrideConnectionType || connectionType;

      // Prepare proxy configuration if "Via Proxy" is selected
      const proxyConfig =
        effectiveConnectionType === "Via Proxy" && proxyAddress.trim()
          ? {
              proxyAddress: proxyAddress.trim(),
              customHeaders: customHeaders.reduce(
                (acc, header) => {
                  if (header.name && header.value) {
                    acc[header.name] = header.value;
                  }
                  return acc;
                },
                {} as Record<string, string>
              ),
            }
          : {
              customHeaders: customHeaders.reduce(
                (acc, header) => {
                  if (header.name && header.value) {
                    acc[header.name] = header.value;
                  }
                  return acc;
                },
                {} as Record<string, string>
              ),
            };

      // Map UI transport type to actual transport type
      // "SSE" in UI means "Streamable HTTP" which uses 'http' transport
      // "WebSocket" in UI means "WebSocket" which uses 'sse' transport
      const actualTransportType = transportType === "SSE" ? "http" : "sse";

      // Store pending connection config - don't add to saved connections yet
      setPendingConnectionConfig({
        url,
        name: url,
        proxyConfig,
        transportType: actualTransportType,
      });
    },
    [url, connectionType, proxyAddress, customHeaders, transportType]
  );

  // Handle successful connection
  const handleConnectionSuccess = useCallback(() => {
    if (!pendingConnectionConfig) return;

    setIsConnecting(false);

    // Add to saved connections now that it's successful
    addConnection(
      pendingConnectionConfig.url,
      pendingConnectionConfig.name,
      pendingConnectionConfig.proxyConfig,
      pendingConnectionConfig.transportType
    );

    // Track server added
    const telemetry = Telemetry.getInstance();
    telemetry
      .capture(
        new MCPServerAddedEvent({
          serverId: pendingConnectionConfig.url,
          serverUrl: pendingConnectionConfig.url,
          connectionType: pendingConnectionConfig.transportType,
          viaProxy: !!pendingConnectionConfig.proxyConfig?.proxyAddress,
        })
      )
      .catch(() => {
        // Silently fail - telemetry should not break the application
      });

    setPendingConnectionConfig(null);
    toast.success("Connection established successfully");

    // Reset form
    setUrl("");
    setCustomHeaders([]);
    setClientId("");
    setScope("");
  }, [pendingConnectionConfig, addConnection]);

  // Handle failed connection
  const handleConnectionFailure = useCallback(
    (errorMessage: string) => {
      // Skip auto-switch for auth errors (both transports will fail the same way)
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Authentication required");

      // Try auto-switch if enabled and we haven't tried both connection types yet
      if (autoSwitch && !hasTriedBothConnectionTypes && !isAuthError) {
        const shouldTryProxy = connectionType === "Direct";
        const shouldTryDirect = connectionType === "Via Proxy";

        if (shouldTryProxy) {
          toast.error("Direct connection failed, trying with proxy...");
          setHasTriedBothConnectionTypes(true);
          // Clear pending config first to unmount the old ConnectionTester
          setPendingConnectionConfig(null);
          // Switch to proxy and retry after a brief delay
          setConnectionType("Via Proxy");
          setTimeout(() => {
            setIsConnecting(true);
            // Pass 'Via Proxy' explicitly to override the memoized callback's connectionType
            handleAddConnection(true, "Via Proxy");
          }, 1000); // Small delay to show the toast
        } else if (shouldTryDirect) {
          toast.error("Proxy connection failed, trying direct...");
          setHasTriedBothConnectionTypes(true);
          // Clear pending config first to unmount the old ConnectionTester
          setPendingConnectionConfig(null);
          // Switch to direct and retry after a brief delay
          setConnectionType("Direct");
          setTimeout(() => {
            setIsConnecting(true);
            // Pass 'Direct' explicitly to override the memoized callback's connectionType
            handleAddConnection(true, "Direct");
          }, 1000); // Small delay to show the toast
        }
      } else {
        toast.error(errorMessage);
        // Clear pending config on final failure
        setPendingConnectionConfig(null);
        setIsConnecting(false);
      }
    },
    [
      autoSwitch,
      hasTriedBothConnectionTypes,
      connectionType,
      handleAddConnection,
    ]
  );

  const handleClearAllConnections = () => {
    // Remove all connections
    connections.forEach((connection) => {
      removeConnection(connection.id);
    });
  };

  const handleCopyError = async (errorMessage: string) => {
    try {
      await navigator.clipboard.writeText(errorMessage);
      toast.success("Error message copied to clipboard");
    } catch {
      toast.error("Failed to copy error message");
    }
  };

  const handleCopyConnectionConfig = async (connection: any) => {
    try {
      const config = {
        url: connection.url,
        name: connection.name,
        transportType: connection.transportType || "http",
        connectionType: connection.proxyConfig ? "Via Proxy" : "Direct",
        proxyConfig: connection.proxyConfig,
        customHeaders: connection.customHeaders || {},
        requestTimeout: connection.requestTimeout || 10000,
        resetTimeoutOnProgress: connection.resetTimeoutOnProgress !== false,
        maxTotalTimeout: connection.maxTotalTimeout || 60000,
        oauth: connection.oauth,
      };

      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
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
    (config: {
      url: string;
      name?: string;
      transportType: "http" | "sse";
      proxyConfig?: {
        proxyAddress?: string;
        customHeaders?: Record<string, string>;
      };
    }) => {
      if (!editingConnectionId) return;

      // If the URL changed, we need to remove the old one and add a new one
      if (config.url !== editingConnectionId) {
        removeConnection(editingConnectionId);
        addConnection(
          config.url,
          config.name,
          config.proxyConfig,
          config.transportType
        );
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
      removeConnection,
      addConnection,
      updateConnectionConfig,
    ]
  );

  const handleServerClick = (connection: any) => {
    // If disconnected, connect the server
    if (connection.state === "disconnected") {
      console.warn(
        "[InspectorDashboard] Connecting server and setting pending navigation:",
        connection.id
      );
      setConnectingServers((prev) => new Set(prev).add(connection.id));
      setPendingNavigation(connection.id);
      connectServer(connection.id);
      return;
    }

    if (connection.state !== "ready") {
      toast.error("Server is not connected and cannot be inspected");
      return;
    }
    // Preserve tunnelUrl parameter if present
    const urlParams = new URLSearchParams(location.search);
    const tunnelUrl = urlParams.get("tunnelUrl");
    const newUrl = tunnelUrl
      ? `/?server=${encodeURIComponent(connection.id)}&tunnelUrl=${encodeURIComponent(tunnelUrl)}`
      : `/?server=${encodeURIComponent(connection.id)}`;
    navigate(newUrl);
  };

  // Monitor connecting servers and remove them from the set when they connect or fail
  useEffect(() => {
    connectingServers.forEach((serverId) => {
      const connection = connections.find((c) => c.id === serverId);
      if (
        connection &&
        (connection.state === "ready" || connection.state === "failed")
      ) {
        setConnectingServers((prev) => {
          const next = new Set(prev);
          next.delete(serverId);
          return next;
        });
      }
    });
  }, [connections, connectingServers]);

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
        (hasData && connection.state !== "connecting"))
    ) {
      setPendingNavigation(null);
      // Preserve tunnelUrl parameter if present
      const urlParams = new URLSearchParams(location.search);
      const tunnelUrl = urlParams.get("tunnelUrl");
      const newUrl = tunnelUrl
        ? `/?server=${encodeURIComponent(connection.id)}&tunnelUrl=${encodeURIComponent(tunnelUrl)}`
        : `/?server=${encodeURIComponent(connection.id)}`;
      navigate(newUrl);
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
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="auto-connect"
                  className="text-sm cursor-pointer"
                >
                  Auto-connect
                </Label>
                <Switch
                  id="auto-connect"
                  checked={autoConnect}
                  onCheckedChange={setAutoConnect}
                />
              </div>
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
                  onClick={() => handleServerClick(connection)}
                  className="group rounded-lg bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 p-4 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <ServerIcon
                          serverUrl={connection.url}
                          serverName={connection.name}
                          size="md"
                        />
                        <h4 className="font-semibold text-sm">
                          {connection.name}
                        </h4>
                        <div className="flex items-center gap-2">
                          {connectingServers.has(connection.id) ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                          ) : connection.error &&
                            connection.state !== "ready" ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyError(connection.error!);
                                  }}
                                  className="w-2 h-2 rounded-full bg-rose-500 animate-status-pulse-red hover:bg-rose-600 transition-colors"
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
                              className={`w-2 h-2 rounded-full ${
                                connection.state === "disconnected"
                                  ? "bg-gray-400 dark:bg-gray-600"
                                  : connection.state === "ready"
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
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(connection.url);
                                toast.success("URL copied to clipboard");
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
                            variant="secondary"
                            size="sm"
                            onClick={(e) =>
                              handleActionClick(e, () =>
                                removeConnection(connection.id)
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
                      {connection.state !== "disconnected" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(e) =>
                                handleActionClick(e, connection.retry)
                              }
                              className="h-8 w-8 p-0"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Resync connection</p>
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
                              setEditingConnectionId(connection.id);
                            }}
                          >
                            <Settings className="h-4 w-4 mr-2" />
                            Edit connection settings
                          </DropdownMenuItem>
                          {connection.state !== "disconnected" && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                connection.retry();
                              }}
                            >
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Resync connection
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              removeConnection(connection.id);
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
                        <Button
                          size="sm"
                          className="bg-yellow-500/20 border-0 dark:bg-yellow-400/10 text-yellow-800 dark:text-yellow-500"
                          variant="outline"
                          onClick={(e) => handleActionClick(e, connection.authenticate)}
                          disabled={connection.state === "authenticating"}
                        >
                          {connection.state === "authenticating" ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Authenticating...
                            </>
                          ) : (
                            "Authenticate"
                          )}
                        </Button>
                        {connection.authUrl && connection.state === "pending_auth" && (
                          <>
                            {" "}
                            or{" "}
                            <a
                              href={connection.authUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              open auth page
                            </a>
                          </>
                        )}
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-full relative overflow-hidden h-auto lg:h-full py-4 px-4 sm:py-6 sm:px-6 lg:p-10 items-center justify-center flex">
        <div className="relative w-full max-w-xl mx-auto z-10 flex flex-col gap-3 rounded-3xl p-4 sm:p-6 bg-black/70 dark:bg-black/90 shadow-2xl shadow-black/50 backdrop-blur-md">
          <ConnectionSettingsForm
            transportType={transportType}
            setTransportType={setTransportType}
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
            redirectUrl={redirectUrl}
            setRedirectUrl={setRedirectUrl}
            scope={scope}
            setScope={setScope}
            autoSwitch={autoSwitch}
            setAutoSwitch={setAutoSwitch}
            onConnect={handleAddConnection}
            variant="styled"
            showConnectButton={true}
            showExportButton={true}
            isConnecting={isConnecting}
          />
        </div>
        <RandomGradientBackground className="absolute inset-0" />
      </div>

      {/* Temporary connection tester - only rendered when testing a new connection */}
      {pendingConnectionConfig && (
        <ConnectionTester
          key={`${pendingConnectionConfig.url}-${pendingConnectionConfig.transportType}-${connectionType}`}
          config={pendingConnectionConfig}
          onSuccess={handleConnectionSuccess}
          onFailure={handleConnectionFailure}
        />
      )}

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
    </div>
  );
}
