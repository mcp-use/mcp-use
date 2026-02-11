/**
 * MCPAppsRenderer - SEP-1865 MCP Apps Renderer
 *
 * Renders MCP Apps widgets using the SEP-1865 protocol:
 * - JSON-RPC 2.0 over postMessage
 * - Double-iframe sandbox architecture
 * - AppBridge SDK for communication
 * - tools/call, resources/read, ui/message, ui/open-link support
 *
 * Reuses existing inspector infrastructure:
 * - Widget storage (WidgetData)
 * - RPC logging (rpcLogBus)
 * - Console capture (useIframeConsole)
 * - Theme context (useTheme)
 */

import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  CallToolResult,
  JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { X } from "lucide-react";
import { useMcpClient } from "mcp-use/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { rpcLogBus } from "../../server/rpc-log-bus.js";
import { consoleLogBus } from "../console-log-bus";
import { IFRAME_SANDBOX_PERMISSIONS, MCP_APPS_CONFIG } from "../constants";
import { useTheme } from "../context/ThemeContext";
import { useWidgetDebug } from "../context/WidgetDebugContext";
import { useDeviceViewport } from "../hooks/useDeviceViewport";
import { useMcpAppsHostContext } from "../hooks/useMcpAppsHostContext";
import { cn } from "../lib/utils";
import { FullscreenNavbar } from "./FullscreenNavbar";
import type { SandboxedIframeHandle } from "./ui/SandboxedIframe";
import { SandboxedIframe } from "./ui/SandboxedIframe";
import { WidgetWrapper } from "./ui/WidgetWrapper";

type DisplayMode = "inline" | "pip" | "fullscreen";

interface MCPAppsRendererProps {
  serverId: string;
  toolCallId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  toolMetadata?: Record<string, unknown>;
  resourceUri: string;
  readResource: (uri: string) => Promise<any>;
  onSendFollowUp?: (text: string) => void;
  className?: string;
  displayMode?: DisplayMode;
  onDisplayModeChange?: (mode: DisplayMode) => void;
  noWrapper?: boolean;
  customProps?: Record<string, string>;
}

/**
 * MCPAppsRenderer Component
 */
export function MCPAppsRenderer({
  serverId,
  toolCallId,
  toolName,
  toolInput,
  toolOutput,
  toolMetadata,
  resourceUri,
  readResource,
  onSendFollowUp,
  className,
  displayMode: displayModeProp,
  onDisplayModeChange,
  noWrapper,
  customProps,
}: MCPAppsRendererProps) {
  const sandboxRef = useRef<SandboxedIframeHandle>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const { resolvedTheme } = useTheme();
  const { servers } = useMcpClient();
  const server = servers.find((s) => s.id === serverId);

  const {
    playground,
    addWidget,
    removeWidget,
    addCspViolation,
    setWidgetModelContext,
  } = useWidgetDebug();

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [widgetHtml, setWidgetHtml] = useState<string | null>(null);
  const [widgetCsp, setWidgetCsp] = useState<any>(undefined);
  const [widgetPermissions, setWidgetPermissions] = useState<any>(undefined);
  const [prefersBorder, setPrefersBorder] = useState<boolean>(true);
  const [internalDisplayMode, setInternalDisplayMode] =
    useState<DisplayMode>("inline");

  // Use controlled displayMode if provided, otherwise use internal state
  const displayMode = displayModeProp ?? internalDisplayMode;

  // Use useRef instead of useState to avoid state updates during ref callback
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Use playground settings when available
  const cspMode = playground.cspMode;
  const deviceType = playground.deviceType;
  const customViewport = playground.customViewport;

  // Calculate dimensions based on device type
  const { maxWidth, maxHeight } = useDeviceViewport(deviceType, customViewport);

  // Calculate inline max-width: desktop/tablet use 768px (ChatGPT chat width), mobile uses device width
  const inlineMaxWidth = deviceType === "mobile" ? maxWidth : 768;

  // Get the tool definition from the server's tool list (memoized to prevent infinite re-renders)
  // Stringify toolName to ensure stable reference if it's passed as an object
  const tool = useMemo(() => {
    if (!server?.tools) return undefined;
    return server.tools.find((t) => t.name === toolName);
  }, [server, toolName]);

  // Build host context per SEP-1865
  const hostContext = useMcpAppsHostContext({
    theme: resolvedTheme,
    displayMode,
    maxWidth,
    maxHeight,
    playground,
    deviceType,
    toolCallId,
    toolName,
    toolInput,
    toolOutput,
    toolMetadata,
    tool,
  });

  // Fetch widget HTML when component mounts
  useEffect(() => {
    const fetchWidgetHtml = async () => {
      try {
        // Fetch resource to get MIME type and CSP metadata
        const resourceResult = await readResource(resourceUri);
        const resourceContent = resourceResult?.contents?.[0];
        const resourceMimeType = resourceContent?.mimeType;
        const resourceMeta = resourceContent?._meta;

        // Extract MCP Apps metadata from resource
        const mcpAppsCsp = resourceMeta?.ui?.csp;
        const mcpAppsPermissions = resourceMeta?.ui?.permissions;
        // Check both MCP Apps and Apps SDK (ChatGPT) metadata paths
        const mcpAppsPrefersBorder =
          resourceMeta?.ui?.prefersBorder ?? // MCP Apps protocol
          resourceMeta?.["openai/widgetPrefersBorder"] ?? // Apps SDK protocol
          true; // Default to true if not specified

        // Detect dev mode from widget metadata (same logic as Apps SDK)
        const widgetMeta = resourceMeta?.["mcp-use/widget"];
        const computedUseDevMode = widgetMeta?.html && widgetMeta?.dev;
        const widgetName = widgetMeta?.name;
        const slugifiedName = widgetMeta?.slugifiedName || widgetName;

        // Calculate dev widget URL if in dev mode
        let devWidgetUrl: string | undefined;
        let devServerBaseUrl: string | undefined;

        if (computedUseDevMode && slugifiedName) {
          // Extract server base URL from serverId (may include /mcp suffix)
          const serverBaseUrl = serverId.replace(/\/mcp$/, "");
          devServerBaseUrl = new URL(serverBaseUrl).origin;

          // Normalize 0.0.0.0 to localhost for browser compatibility
          devServerBaseUrl = devServerBaseUrl.replace("0.0.0.0", "localhost");
          devWidgetUrl = `${devServerBaseUrl}/mcp-use/widgets/${slugifiedName}`;
        }

        // Store widget data including dev URLs
        const storeResponse = await fetch(
          MCP_APPS_CONFIG.API_ENDPOINTS.WIDGET_STORE,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serverId,
              uri: resourceUri, // Backend expects 'uri' not 'resourceUri'
              toolInput,
              toolOutput,
              toolId: toolCallId,
              toolName,
              theme: resolvedTheme,
              protocol: "mcp-apps",
              cspMode,
              resourceData: resourceResult,
              mimeType: resourceMimeType,
              mcpAppsCsp,
              mcpAppsPermissions,
              devWidgetUrl, // Store dev URL for HMR
              devServerBaseUrl, // Store dev base URL
            }),
          }
        );

        if (!storeResponse.ok) {
          throw new Error(
            `Failed to store widget: ${storeResponse.statusText}`
          );
        }

        // Use dev endpoint in dev mode for live HMR, otherwise use cached content
        const contentEndpoint = computedUseDevMode
          ? MCP_APPS_CONFIG.API_ENDPOINTS.DEV_WIDGET_CONTENT(toolCallId)
          : MCP_APPS_CONFIG.API_ENDPOINTS.WIDGET_CONTENT(toolCallId);

        // Fetch widget content with CSP metadata
        const contentResponse = await fetch(
          `${contentEndpoint}?csp_mode=${cspMode}`
        );

        if (!contentResponse.ok) {
          const errorData = await contentResponse.json().catch(() => ({}));
          throw new Error(
            errorData.error ||
              `Failed to fetch widget: ${contentResponse.statusText}`
          );
        }

        const { html, csp, permissions, mimeTypeWarning, mimeTypeValid } =
          await contentResponse.json();

        if (!mimeTypeValid) {
          setLoadError(
            mimeTypeWarning ||
              'Invalid MIME type - SEP-1865 requires "text/html;profile=mcp-app"'
          );
          return;
        }

        setWidgetHtml(html);
        setWidgetCsp(csp);
        setWidgetPermissions(permissions);
        setPrefersBorder(mcpAppsPrefersBorder);

        // Register widget in debug context
        addWidget(toolCallId, {
          toolName,
          protocol: "mcp-apps",
          hostContext,
        });
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to prepare widget"
        );
      }
    };

    fetchWidgetHtml();
    // Only re-fetch when the widget identity changes, not on every render.
    // hostContext, addWidget, toolInput, toolOutput, resolvedTheme are intentionally
    // excluded to prevent infinite re-render loops — they are captured by closure
    // at the time of the fetch and don't warrant refetching the widget HTML.
  }, [serverId, resourceUri, toolCallId, toolName, cspMode]);

  // Initialize AppBridge when HTML is ready
  useEffect(() => {
    if (!widgetHtml || !sandboxRef.current) return;

    const iframe = sandboxRef.current.getIframeElement();
    if (!iframe?.contentWindow) return;

    setIsReady(false);

    // Create a custom transport that posts messages through the SandboxedIframe
    // The SandboxedIframe will relay them to the correct nested iframe
    const customTransport: Transport = {
      sessionId: undefined,
      async start() {
        // Transport starts immediately, messages are handled by the message listener
      },
      async send(message: JSONRPCMessage) {
        // Send through SandboxedIframe which will relay to the proxy and then to guest
        sandboxRef.current?.postMessage(message);

        // Log sent message
        rpcLogBus.publish({
          serverId: `widget-${toolCallId}`,
          direction: "send",
          timestamp: new Date().toISOString(),
          message,
        });
      },
      async close() {
        // Cleanup handled by component unmount
      },
      onmessage: undefined,
      onerror: undefined,
      onclose: undefined,
    };

    const bridge = new AppBridge(
      null,
      { name: "mcp-use-inspector", version: "0.16.2" },
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        sandbox: {
          csp: cspMode === "permissive" ? undefined : widgetCsp,
          permissions: widgetPermissions,
        },
      },
      { hostContext }
    );

    // Register bridge handlers
    bridge.oninitialized = () => {
      console.log("[MCPAppsRenderer] Widget initialized");
      setIsReady(true);
    };

    bridge.onmessage = async ({ content }) => {
      const textContent = content.find((item) => item.type === "text")?.text;
      if (textContent && onSendFollowUp) {
        onSendFollowUp(textContent);
      }
      return {};
    };

    bridge.onopenlink = async ({ url }) => {
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return {};
    };

    bridge.oncalltool = async ({ name, arguments: args }) => {
      if (!server) {
        throw new Error("Server connection not available");
      }

      try {
        const result = await server.callTool(name, args || {}, {
          timeout: MCP_APPS_CONFIG.TIMEOUTS.TOOL_CALL,
          resetTimeoutOnProgress: true,
        });
        return result as CallToolResult;
      } catch (error) {
        bridge.sendToolCancelled({
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    bridge.onreadresource = async ({ uri }) => {
      const result = await readResource(uri);
      return result.contents || [];
    };

    bridge.onlistresources = async () => {
      if (!server) {
        throw new Error("Server connection not available");
      }
      return { resources: server.resources };
    };

    bridge.onrequestdisplaymode = async ({ mode }) => {
      const requestedMode = mode ?? "inline";
      if (onDisplayModeChange) {
        onDisplayModeChange(requestedMode);
      } else {
        setInternalDisplayMode(requestedMode);
      }
      return { mode: requestedMode };
    };

    bridge.onupdatemodelcontext = async ({ content, structuredContent }) => {
      setWidgetModelContext(toolCallId, { content, structuredContent });
      return {};
    };

    bridge.onloggingmessage = async ({ level, logger: _logger, data }) => {
      // Publish to console log bus (avoids postMessage issues with browser extensions)
      consoleLogBus.publish({
        level: level as any,
        args: [data],
        timestamp: new Date().toISOString(),
        url: resourceUri,
      });
      return {};
    };

    bridge.onsizechange = ({ width, height }) => {
      if (displayMode !== "inline") return;
      const iframeEl = iframe;
      if (!iframeEl || (height === undefined && width === undefined)) return;

      // Apply size changes with animation
      const style = getComputedStyle(iframeEl);
      const isBorderBox = style.boxSizing === "border-box";

      let adjustedWidth = width;
      let adjustedHeight = height;

      if (adjustedWidth !== undefined && isBorderBox) {
        adjustedWidth +=
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.borderRightWidth);
      }
      if (adjustedHeight !== undefined && isBorderBox) {
        adjustedHeight +=
          parseFloat(style.borderTopWidth) +
          parseFloat(style.borderBottomWidth);
      }

      const from: Keyframe = {};
      const to: Keyframe = {};

      if (adjustedWidth !== undefined) {
        from.width = `${iframeEl.offsetWidth}px`;
        iframeEl.style.width = to.width = `min(${adjustedWidth}px, 100%)`;
      }
      if (adjustedHeight !== undefined) {
        from.height = `${iframeEl.offsetHeight}px`;
        iframeEl.style.height = to.height = `${adjustedHeight}px`;
      }

      iframeEl.animate([from, to], { duration: 300, easing: "ease-out" });
    };

    bridgeRef.current = bridge;

    // Connect bridge with custom transport
    let isActive = true;
    bridge.connect(customTransport).catch((error) => {
      if (!isActive) return;
      setLoadError(
        error instanceof Error ? error.message : "Failed to connect MCP App"
      );
    });

    // Set up message handler for incoming messages from widget (via SandboxedIframe)
    const handleMessage = (event: MessageEvent) => {
      // Only process messages from our sandbox proxy
      const proxyOrigin = new URL(iframe.src).origin;
      if (event.origin !== proxyOrigin) return;
      if (event.source !== iframe.contentWindow) return;

      // Log received message
      rpcLogBus.publish({
        serverId: `widget-${toolCallId}`,
        direction: "receive",
        timestamp: new Date().toISOString(),
        message: event.data,
      });

      // Pass message to AppBridge
      if (customTransport.onmessage && event.data) {
        customTransport.onmessage(event.data as JSONRPCMessage);
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      isActive = false;
      window.removeEventListener("message", handleMessage);
      if (bridge) {
        bridge.teardownResource({}).catch(() => {});
        bridge.close().catch(() => {});
      }
      bridgeRef.current = null;
      removeWidget(toolCallId);
    };
  }, [
    widgetHtml,
    sandboxRef,
    // cspMode,
    // widgetCsp,
    // widgetPermissions,
    // // hostContext removed - it's updated via separate useEffect calling setHostContext
    toolCallId,
    server,
    readResource,
    // onSendFollowUp,
    // displayMode,
    // setWidgetModelContext,
    // removeWidget,
  ]);

  // Update host context when it changes
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !isReady) return;
    console.log("[MCPAppsRenderer] setHostContext called with:", hostContext);
    bridge.setHostContext(hostContext);
  }, [hostContext, isReady]);

  // Send tool input when ready
  // Also resend when toolCallId changes (indicates re-execution)
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !isReady) return;

    // Merge customProps with toolInput
    const mergedArgs = {
      ...toolInput,
      ...customProps,
    };

    bridge.sendToolInput({ arguments: mergedArgs });
  }, [isReady, toolInput, customProps, toolCallId]);

  // Send tool output when ready
  // Allow sending null to reset widget to pending state (Issue #930)
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !isReady) return;

    // Send toolOutput even if null (allows widget to show pending state on re-execution)
    if (toolOutput) {
      bridge.sendToolResult(toolOutput as CallToolResult);
    }
    // Note: When toolOutput is null, widget stays in pending state (isPending=true)
  }, [isReady, toolOutput, toolCallId]);

  // Handle CSP violations
  const handleSandboxMessage = useCallback(
    (event: MessageEvent) => {
      if (event.data?.type !== "mcp-apps:csp-violation") return;

      const {
        directive,
        blockedUri,
        sourceFile,
        lineNumber,
        columnNumber,
        effectiveDirective,
        timestamp,
      } = event.data;

      addCspViolation(toolCallId, {
        directive,
        effectiveDirective,
        blockedUri,
        sourceFile,
        lineNumber,
        columnNumber,
        timestamp: timestamp || Date.now(),
      });

      console.warn(
        `[MCP Apps CSP Violation] ${directive}: Blocked ${blockedUri}`,
        sourceFile ? `at ${sourceFile}:${lineNumber}:${columnNumber}` : ""
      );
    },
    [toolCallId, addCspViolation]
  );

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && displayMode === "fullscreen") {
        if (onDisplayModeChange) {
          onDisplayModeChange("inline");
        } else {
          setInternalDisplayMode("inline");
        }
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [displayMode, onDisplayModeChange]);

  // Handle display mode changes
  const handleDisplayModeChange = useCallback(
    async (mode: DisplayMode) => {
      try {
        if (mode === "fullscreen") {
          if (containerRef.current) {
            await containerRef.current.requestFullscreen();
          }
        } else {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          }
        }

        // Call the callback if provided (controlled), otherwise update internal state
        if (onDisplayModeChange) {
          onDisplayModeChange(mode);
        } else {
          setInternalDisplayMode(mode);
        }
      } catch (err) {
        console.error("[MCPAppsRenderer] Display mode error:", err);
        // Still update state even on error
        if (onDisplayModeChange) {
          onDisplayModeChange(mode);
        } else {
          setInternalDisplayMode(mode);
        }
      }
    },
    [onDisplayModeChange]
  );

  // Loading states
  if (loadError) {
    return (
      <WidgetWrapper className={className} noWrapper={noWrapper}>
        <div className="border border-red-200/50 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/20 rounded-lg p-4">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load MCP App: {loadError}
          </p>
        </div>
      </WidgetWrapper>
    );
  }

  if (!widgetHtml) {
    return (
      <WidgetWrapper className={className} noWrapper={noWrapper}>
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Preparing MCP App widget...
        </div>
      </WidgetWrapper>
    );
  }

  const isPip = displayMode === "pip";
  const isFullscreen = displayMode === "fullscreen";

  const containerClassName = (() => {
    if (isFullscreen) {
      return "fixed inset-0 z-40 w-full h-full bg-background flex flex-col";
    }

    if (isPip) {
      return [
        `fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-3xl w-fit min-w-[300px] max-w-[min(90vw,1200px)] h-[${MCP_APPS_CONFIG.DIMENSIONS.PIP_HEIGHT}px]`,
        "shadow-2xl border overflow-hidden",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
      ].join(" ");
    }

    return "flex group flex-1 items-center justify-center";
  })();

  const iframeStyle: CSSProperties = {
    height:
      isFullscreen || isPip
        ? "100%"
        : `${MCP_APPS_CONFIG.DIMENSIONS.DEFAULT_HEIGHT}px`,
    width: "100%",
    maxWidth: displayMode === "inline" ? `${inlineMaxWidth}px` : "100%",
    transition:
      isFullscreen || isPip
        ? undefined
        : "height 300ms ease-out, width 300ms ease-out",
  };

  return (
    <WidgetWrapper className={className} noWrapper={noWrapper}>
      <div ref={containerRef} className={containerClassName}>
        {isFullscreen && (
          <FullscreenNavbar
            title={toolName}
            onClose={() => handleDisplayModeChange("inline")}
            testId="debugger-exit-fullscreen-button"
          />
        )}

        {isPip && (
          <button
            data-testid="debugger-exit-pip-button"
            onClick={() => handleDisplayModeChange("inline")}
            className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-background/80 hover:bg-background border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
            aria-label="Close PiP mode"
            title="Close PiP mode"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Main content with centering like Apps SDK */}
        <div
          className={cn(
            "flex-1 w-full flex justify-center items-center",
            isFullscreen && "pt-14"
          )}
        >
          <SandboxedIframe
            ref={sandboxRef}
            html={widgetHtml}
            sandbox={IFRAME_SANDBOX_PERMISSIONS}
            csp={widgetCsp}
            permissions={widgetPermissions}
            permissive={cspMode === "permissive"}
            onMessage={handleSandboxMessage}
            title={`MCP App: ${toolName}`}
            className={cn(
              displayMode === "inline" && "w-full",
              displayMode === "fullscreen" && "w-full h-full rounded-none",
              displayMode === "pip" && "w-full h-full",
              displayMode !== "fullscreen" && prefersBorder && "rounded-lg",
              "overflow-hidden",
              prefersBorder && "border border-zinc-200 dark:border-zinc-700"
            )}
            style={iframeStyle}
          />
        </div>
      </div>
    </WidgetWrapper>
  );
}
