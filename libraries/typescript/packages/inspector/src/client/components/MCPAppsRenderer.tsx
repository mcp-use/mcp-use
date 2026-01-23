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

import {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type CSSProperties,
} from "react";
import { X } from "lucide-react";
import { useMcpClient } from "mcp-use/react";
import { useTheme } from "../context/ThemeContext";
import { cn } from "../lib/utils";
import {
  useWidgetDebug,
  DEVICE_VIEWPORT_CONFIGS,
} from "../context/WidgetDebugContext";
import type { SandboxedIframeHandle } from "./ui/SandboxedIframe";
import { SandboxedIframe } from "./ui/SandboxedIframe";
import { WidgetWrapper } from "./ui/WidgetWrapper";
import {
  AppBridge,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  JSONRPCMessage,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { rpcLogBus } from "../../server/rpc-log-bus.js";

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
  const [displayMode, setDisplayMode] = useState<DisplayMode>("inline");

  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);

  // Use playground settings when available
  const cspMode = playground.cspMode;
  const deviceType = playground.deviceType;
  const customViewport = playground.customViewport;

  // Calculate dimensions based on device type
  const { maxWidth, maxHeight } = useMemo(() => {
    if (deviceType === "custom") {
      return {
        maxWidth: customViewport.width,
        maxHeight: customViewport.height,
      };
    }
    return {
      maxWidth: DEVICE_VIEWPORT_CONFIGS[deviceType].width,
      maxHeight: DEVICE_VIEWPORT_CONFIGS[deviceType].height,
    };
  }, [deviceType, customViewport]);

  // Build host context per SEP-1865
  const hostContext = useMemo<McpUiHostContext>(
    () => ({
      theme: resolvedTheme,
      displayMode,
      availableDisplayModes: ["inline", "pip", "fullscreen"],
      containerDimensions: { maxHeight, maxWidth },
      locale: playground.locale,
      timeZone: playground.timeZone,
      platform: deviceType === "mobile" ? "mobile" : "web",
      userAgent: navigator.userAgent,
      deviceCapabilities: playground.capabilities,
      safeAreaInsets: playground.safeAreaInsets,
      styles: { variables: {} as any },
      toolInfo: {
        id: toolCallId,
        tool: {
          name: toolName,
          inputSchema: (toolMetadata?.inputSchema as any) || { type: "object" },
          description: toolMetadata?.description as string | undefined,
        },
      },
    }),
    [
      resolvedTheme,
      displayMode,
      maxHeight,
      maxWidth,
      playground,
      deviceType,
      toolCallId,
      toolName,
      toolMetadata,
    ]
  );

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

        // Store widget data
        const storeResponse = await fetch(
          "/inspector/api/mcp-apps/widget/store",
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
            }),
          }
        );

        if (!storeResponse.ok) {
          throw new Error(
            `Failed to store widget: ${storeResponse.statusText}`
          );
        }

        // Fetch widget content with CSP metadata
        const contentResponse = await fetch(
          `/inspector/api/mcp-apps/widget-content/${toolCallId}?csp_mode=${cspMode}`
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
  }, [
    serverId,
    resourceUri,
    toolCallId,
    toolName,
    toolInput,
    toolOutput,
    resolvedTheme,
    cspMode,
    addWidget,
    hostContext,
  ]);

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
          timeout: 600000, // 10 minutes
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
      setDisplayMode(requestedMode);
      return { mode: requestedMode };
    };

    bridge.onupdatemodelcontext = async ({ content, structuredContent }) => {
      setWidgetModelContext(toolCallId, { content, structuredContent });
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
    cspMode,
    widgetCsp,
    widgetPermissions,
    hostContext,
    toolCallId,
    server,
    readResource,
    onSendFollowUp,
    displayMode,
    setWidgetModelContext,
    removeWidget,
  ]);

  // Update host context when it changes
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !isReady) return;
    bridge.setHostContext(hostContext);
  }, [hostContext, isReady]);

  // Send tool input when ready
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !isReady || !toolInput) return;

    bridge.sendToolInput({ arguments: toolInput });
  }, [isReady, toolInput]);

  // Send tool output when ready
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !isReady || !toolOutput) return;

    bridge.sendToolResult(toolOutput as CallToolResult);
  }, [isReady, toolOutput]);

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
        setDisplayMode("inline");
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [displayMode]);

  // Handle display mode changes
  const handleDisplayModeChange = useCallback(
    async (mode: DisplayMode) => {
      try {
        if (mode === "fullscreen") {
          if (containerRef) {
            await containerRef.requestFullscreen();
          }
          setDisplayMode(mode);
        } else {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          }
          setDisplayMode(mode);
        }
      } catch (err) {
        console.error("[MCPAppsRenderer] Display mode error:", err);
        setDisplayMode(mode);
      }
    },
    [containerRef]
  );

  // Loading states
  if (loadError) {
    return (
      <WidgetWrapper className={className}>
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
      <WidgetWrapper className={className}>
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
        "fixed bottom-6 right-6 z-50 rounded-3xl w-[768px] h-96",
        "shadow-2xl border overflow-hidden",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
      ].join(" ");
    }

    return "mt-3 space-y-2 relative group";
  })();

  const iframeStyle: CSSProperties = {
    height: isFullscreen || isPip ? "100%" : "400px",
    width: "100%",
    maxWidth: "100%",
    transition:
      isFullscreen || isPip
        ? undefined
        : "height 300ms ease-out, width 300ms ease-out",
  };

  return (
    <WidgetWrapper className={className}>
      <div ref={setContainerRef} className={containerClassName}>
        {isFullscreen && (
          <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-700 bg-background shrink-0">
            <div />
            <div className="font-medium text-sm text-zinc-600 dark:text-zinc-400">
              {toolName}
            </div>
            <button
              onClick={() => handleDisplayModeChange("inline")}
              className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              aria-label="Exit fullscreen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {isPip && (
          <button
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
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            csp={widgetCsp}
            permissions={widgetPermissions}
            permissive={cspMode === "permissive"}
            onMessage={handleSandboxMessage}
            title={`MCP App: ${toolName}`}
            className={cn(
              displayMode === "inline" && "w-full max-w-[768px]",
              displayMode === "fullscreen" && "w-full h-full rounded-none",
              displayMode === "pip" && "w-full h-full rounded-lg",
              "bg-background overflow-hidden border border-zinc-200 dark:border-zinc-700"
            )}
            style={iframeStyle}
          />
        </div>

        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 px-4 pb-2">
          MCP App: <code className="font-mono">{resourceUri}</code>
        </div>
      </div>
    </WidgetWrapper>
  );
}
