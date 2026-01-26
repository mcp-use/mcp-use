/**
 * MCPAppsRenderer - SEP-1865 MCP Apps Renderer
 *
 * Renders MCP Apps widgets using the SEP-1865 protocol:
 * - JSON-RPC 2.0 over postMessage
 * - Double-iframe sandbox architecture
 * - tools/call, resources/read, ui/message, ui/open-link support
 *
 * Uses SandboxedIframe for DRY double-iframe setup.
 */

import {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type CSSProperties,
} from "react";
import {
  SandboxedIframe,
  type SandboxedIframeHandle,
} from "../ui/SandboxedIframe";
import { isVisibleToModelOnly } from "@/client/utils/mcpAppsUtils";
import { Spinner } from "../ui/spinner";
import { X } from "lucide-react";
import { useTheme } from "@/client/context/ThemeContext";
import { IframeConsole } from "../IframeConsole";
import {
  AppBridge,
  PostMessageTransport,
  type McpUiHostContext,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";

// Remove manual type definitions since we're importing from the SDK
type CspMode = "permissive" | "widget-declared";
type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

// LoggingTransport wrapper for debugging JSON-RPC messages
class LoggingTransport implements Transport {
  private inner: Transport;
  private onSend?: (message: JSONRPCMessage) => void;
  private onReceive?: (message: JSONRPCMessage) => void;
  private _sessionId?: string;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  setProtocolVersion?: (version: string) => void;

  constructor(
    inner: Transport,
    handlers: {
      onSend?: (message: JSONRPCMessage) => void;
      onReceive?: (message: JSONRPCMessage) => void;
    }
  ) {
    this.inner = inner;
    this.onSend = handlers.onSend;
    this.onReceive = handlers.onReceive;
  }

  get sessionId() {
    return this._sessionId ?? this.inner.sessionId;
  }

  set sessionId(value: string | undefined) {
    this._sessionId = value;
    this.inner.sessionId = value;
  }

  async start() {
    this.inner.onmessage = (message, extra) => {
      this.onReceive?.(message);
      this.onmessage?.(message, extra);
    };
    this.inner.onerror = (error) => {
      this.onerror?.(error);
    };
    this.inner.onclose = () => {
      this.onclose?.();
    };
    this.inner.setProtocolVersion = (version) => {
      this.setProtocolVersion?.(version);
    };
    await this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    this.onSend?.(message);
    await this.inner.send(message, options);
  }

  async close() {
    await this.inner.close();
  }
}

interface MCPAppsRendererProps {
  serverId: string;
  toolCallId: string;
  toolName: string;
  toolState?: ToolState;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  toolErrorText?: string;
  resourceUri: string;
  toolMetadata?: Record<string, unknown>;
  toolsMetadata?: Record<string, Record<string, unknown>>;
  readResource?: (uri: string) => Promise<any>;
  onSendFollowUp?: (text: string) => void;
  onCallTool?: (
    toolName: string,
    params: Record<string, unknown>
  ) => Promise<unknown>;
  className?: string;
}

export function MCPAppsRenderer({
  serverId,
  toolCallId,
  toolName,
  toolState = "output-available",
  toolInput,
  toolOutput,
  toolErrorText,
  resourceUri,
  toolMetadata,
  toolsMetadata,
  readResource,
  onSendFollowUp,
  onCallTool,
  className,
}: MCPAppsRendererProps) {
  const sandboxRef = useRef<SandboxedIframeHandle>(null);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [widgetHtml, setWidgetHtml] = useState<string | null>(null);
  const [widgetCsp, setWidgetCsp] = useState<McpUiResourceCsp | undefined>(
    undefined
  );
  const [widgetPermissions, setWidgetPermissions] = useState<
    McpUiResourcePermissions | undefined
  >(undefined);
  const [widgetPermissive, setWidgetPermissive] = useState<boolean>(false);
  const [prefersBorder, setPrefersBorder] = useState<boolean>(true);
  const [iframeHeight, setIframeHeight] = useState<number>(400);
  const [displayMode, setDisplayMode] = useState<
    "inline" | "pip" | "fullscreen"
  >("inline");

  const cspMode: CspMode = "permissive"; // Default to permissive for now
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  // Generate unique tool ID for console tracking
  const toolIdRef = useRef(`mcp-app-${toolCallId}`);
  const toolId = toolIdRef.current;

  // Refs to hold latest values without triggering effect re-runs
  const bridgeRef = useRef<AppBridge | null>(null);
  const hostContextRef = useRef<McpUiHostContext | null>(null);
  const isReadyRef = useRef(false);
  const displayModeRef = useRef(displayMode);

  const onSendFollowUpRef = useRef(onSendFollowUp);
  const onCallToolRef = useRef(onCallTool);
  const readResourceRef = useRef(readResource);
  const serverIdRef = useRef(serverId);
  const toolCallIdRef = useRef(toolCallId);
  const toolsMetadataRef = useRef(toolsMetadata);
  const setDisplayModeRef = useRef(setDisplayMode);
  const lastToolInputRef = useRef<string | null>(null);
  const lastToolOutputRef = useRef<string | null>(null);
  const lastToolErrorRef = useRef<string | null>(null);

  useEffect(() => {
    onSendFollowUpRef.current = onSendFollowUp;
    onCallToolRef.current = onCallTool;
    readResourceRef.current = readResource;
    serverIdRef.current = serverId;
    toolCallIdRef.current = toolCallId;
    toolsMetadataRef.current = toolsMetadata;
    displayModeRef.current = displayMode;
    setDisplayModeRef.current = setDisplayMode;
  });

  // Fetch widget HTML when tool output is available
  useEffect(() => {
    if (toolState !== "output-available") return;
    if (widgetHtml) return; // Already fetched

    const fetchWidgetHtml = async () => {
      try {
        console.log("[MCP Apps] Fetching widget HTML for:", {
          serverId,
          resourceUri,
          toolCallId,
        });

        if (!readResourceRef.current) {
          throw new Error("readResource function not available");
        }

        // First, fetch the HTML resource from the MCP server using the readResource function
        const resourceData = await readResourceRef.current(resourceUri);

        console.log("[MCP Apps] Resource data received:", {
          hasContents: !!resourceData?.contents,
          contentsLength: resourceData?.contents?.length,
        });

        const contents = resourceData?.contents || [];
        const content = contents[0];

        if (!content) {
          throw new Error("No content in resource");
        }

        console.log("[MCP Apps] Resource fetched:", {
          hasContent: !!content,
          mimeType: content.mimeType,
          hasText: "text" in content,
          hasBlob: "blob" in content,
        });

        // Extract HTML from resource
        let html: string;
        if ("text" in content && typeof content.text === "string") {
          html = content.text;
        } else if ("blob" in content && typeof content.blob === "string") {
          html = atob(content.blob); // Base64 decode
        } else {
          throw new Error("No HTML content in resource");
        }

        // Extract metadata from resource
        const mimeType = content.mimeType;
        const uiMeta = content._meta?.ui;
        const csp = uiMeta?.csp;
        const permissions = uiMeta?.permissions;
        const prefersBorder = uiMeta?.prefersBorder;

        // Validate MIME type
        const mimeTypeValid = mimeType === "text/html;profile=mcp-app";
        if (!mimeTypeValid) {
          console.warn(
            `[MCP Apps] Invalid mimetype "${mimeType || "missing"}" - SEP-1865 requires "text/html;profile=mcp-app"`
          );
        }

        // Store widget data with fetched HTML
        const storeResponse = await fetch(
          "/inspector/api/mcp-apps/widget/store",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serverId,
              resourceUri,
              toolId: toolCallId,
              toolName,
              protocol: "mcp-apps",
              cspMode,
              html,
              csp,
              permissions,
              prefersBorder,
              mimeType,
              toolInput,
              toolOutput,
              theme,
            }),
          }
        );

        if (!storeResponse.ok) {
          throw new Error(
            `Failed to store widget: ${storeResponse.statusText}`
          );
        }

        // Set state with fetched data
        const effectivePermissive = cspMode === "permissive";
        console.log("[MCP Apps] Widget prepared successfully:", {
          htmlLength: html.length,
          hasCsp: !!csp,
          hasPermissions: !!permissions,
          permissive: effectivePermissive,
        });

        setWidgetHtml(html);
        setWidgetCsp(csp);
        setWidgetPermissions(permissions);
        setWidgetPermissive(effectivePermissive);
        setPrefersBorder(prefersBorder ?? true);
      } catch (err) {
        console.error("[MCP Apps] Error fetching widget:", err);
        setLoadError(
          err instanceof Error ? err.message : "Failed to prepare widget"
        );
      }
    };

    fetchWidgetHtml();
  }, [
    toolState,
    toolCallId,
    widgetHtml,
    serverId,
    resourceUri,
    toolInput,
    toolOutput,
    toolName,
    theme,
    cspMode,
  ]);

  // Build host context for widget
  const hostContext = useMemo<McpUiHostContext>(
    () => ({
      theme,
      displayMode,
      availableDisplayModes: ["inline", "pip", "fullscreen"],
      containerDimensions: {
        maxHeight: 800,
        maxWidth: 1200,
      },
      locale: navigator.language || "en-US",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      platform: "web",
      userAgent: navigator.userAgent,
      deviceCapabilities: {
        hover: true,
        touch: false,
      },
      safeAreaInsets: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      styles: {
        variables: {} as any, // AppBridge expects McpUiStyles but we provide empty for now
      },
      toolInfo: {
        id: toolCallId,
        tool: {
          name: toolName,
          inputSchema: (toolMetadata?.inputSchema as any) ?? { type: "object" },
          description: toolMetadata?.description as string | undefined,
        },
      },
    }),
    [theme, displayMode, toolCallId, toolName, toolMetadata]
  );

  useEffect(() => {
    hostContextRef.current = hostContext;
  }, [hostContext]);

  // Register AppBridge event handlers
  const registerBridgeHandlers = useCallback((bridge: AppBridge) => {
    console.log("[MCP Apps] Registering bridge handlers");

    bridge.oninitialized = () => {
      console.log("[MCP Apps] Widget initialized");
      setIsReady(true);
      isReadyRef.current = true;
    };

    bridge.onmessage = async ({ content }) => {
      console.log("[MCP Apps] Message received:", content);
      const textContent = content.find((item) => item.type === "text")?.text;
      if (textContent) {
        onSendFollowUpRef.current?.(textContent);
      }
      return {};
    };

    bridge.onopenlink = async ({ url }) => {
      console.log("[MCP Apps] Open link requested:", url);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return {};
    };

    bridge.oncalltool = async ({ name, arguments: args }, _extra) => {
      console.log("[MCP Apps] Tool call requested:", name, args);

      // Check if tool is model-only (not callable by apps)
      const calledToolMeta = toolsMetadataRef.current?.[name];
      if (isVisibleToModelOnly(calledToolMeta)) {
        throw new Error(
          `Tool "${name}" is not callable by apps (visibility: model-only)`
        );
      }

      if (!onCallToolRef.current) {
        throw new Error("Tool calls not supported");
      }

      const result = await onCallToolRef.current(
        name,
        (args ?? {}) as Record<string, unknown>
      );
      return result as CallToolResult;
    };

    bridge.onreadresource = async ({ uri }) => {
      console.log("[MCP Apps] Resource read requested:", uri);

      if (!readResourceRef.current) {
        throw new Error("Resource read not supported");
      }

      const result = await readResourceRef.current(uri);
      return result;
    };

    bridge.onsizechange = ({ width, height }) => {
      const currentMode = displayModeRef.current;
      console.log("[MCP Apps] Size change received:", {
        width,
        height,
        currentDisplayMode: currentMode,
      });

      if (currentMode !== "inline") {
        console.log("[MCP Apps] Ignoring size change (not in inline mode)");
        return;
      }

      if (typeof height === "number" && height > 0) {
        setIframeHeight(height);
      }
    };

    bridge.onrequestdisplaymode = async (params) => {
      try {
        console.log("[MCP Apps] ⭐ onrequestdisplaymode handler called!");
        console.log("[MCP Apps] Full params received:", params);
        console.log("[MCP Apps] mode value:", params.mode);
        console.log("[MCP Apps] mode type:", typeof params.mode);

        const requestedMode = params.mode ?? "inline";
        console.log(
          "[MCP Apps] Requested mode:",
          params.mode,
          "→",
          requestedMode
        );
        console.log(
          "[MCP Apps] setDisplayModeRef.current exists?",
          !!setDisplayModeRef.current
        );

        if (setDisplayModeRef.current) {
          setDisplayModeRef.current(requestedMode);
          console.log(
            "[MCP Apps] setDisplayMode called successfully with:",
            requestedMode
          );
        } else {
          console.error("[MCP Apps] setDisplayModeRef.current is not set!");
        }

        const response = { mode: requestedMode };
        console.log("[MCP Apps] Returning response:", response);
        return response;
      } catch (error) {
        console.error("[MCP Apps] Error in onrequestdisplaymode:", error);
        throw error;
      }
    };

    console.log(
      "[MCP Apps] Bridge handlers registered, onrequestdisplaymode:",
      !!bridge.onrequestdisplaymode
    );
  }, []);

  // Handle CSP violations and console logs (not part of AppBridge)
  const handleCspViolation = useCallback(
    (event: MessageEvent) => {
      // Forward console logs to window for useIframeConsole hook
      if (event.data?.type === "iframe-console-log") {
        console.log("[MCP Apps] Console log received from widget:", event.data);
        // Re-broadcast to window with iframeId so useIframeConsole can capture it
        window.postMessage(
          {
            ...event.data,
            iframeId: toolId,
          },
          "*"
        );
        return;
      }

      if (event.data?.type === "mcp-apps:csp-violation") {
        console.warn(
          `[MCP Apps CSP Violation] ${event.data.directive}: Blocked ${event.data.blockedUri}`
        );
      }
    },
    [toolId]
  );

  // Initialize AppBridge when HTML is ready
  useEffect(() => {
    if (!widgetHtml) return;
    const iframe = sandboxRef.current?.getIframeElement();
    if (!iframe?.contentWindow) return;

    console.log("[MCP Apps] Initializing AppBridge");
    setIsReady(false);
    isReadyRef.current = false;

    const bridge = new AppBridge(
      null,
      { name: "mcp-use-inspector", version: "0.15.0" },
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        sandbox: {
          csp: widgetPermissive ? undefined : widgetCsp,
          permissions: widgetPermissions as any, // Type compatibility
        },
      },
      { hostContext: hostContextRef.current ?? {} }
    );

    const transport = new LoggingTransport(
      new PostMessageTransport(iframe.contentWindow, iframe.contentWindow),
      {
        onSend: (message) => {
          console.log("[MCP Apps] Host → Widget:", message);
        },
        onReceive: (message) => {
          console.log("[MCP Apps] Widget → Host:", message);
        },
      }
    );

    // Register handlers BEFORE connecting
    registerBridgeHandlers(bridge);
    bridgeRef.current = bridge;

    console.log("[MCP Apps] About to connect bridge, handlers registered");

    let isActive = true;
    bridge.connect(transport).catch((error) => {
      if (!isActive) return;
      console.error("[MCP Apps] Bridge connection error:", error);
      setLoadError(
        error instanceof Error ? error.message : "Failed to connect MCP App"
      );
    });

    return () => {
      isActive = false;
      bridgeRef.current = null;
      if (isReadyRef.current) {
        bridge.teardownResource({}).catch(() => {});
      }
      bridge.close().catch(() => {});
    };
  }, [
    widgetHtml,
    widgetCsp,
    widgetPermissions,
    widgetPermissive,
    registerBridgeHandlers,
  ]);

  // Update host context when it changes
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !isReady) return;

    console.log("[MCP Apps] Updating host context:", hostContext);
    bridge.setHostContext(hostContext);
  }, [hostContext, isReady]);

  // Send tool input when ready
  useEffect(() => {
    if (!isReady || toolState !== "output-available") return;
    const bridge = bridgeRef.current;
    if (!bridge || lastToolInputRef.current !== null) return;

    const resolvedToolInput = toolInput ?? {};
    lastToolInputRef.current = JSON.stringify(resolvedToolInput);

    console.log("[MCP Apps] Sending tool input:", resolvedToolInput);
    bridge.sendToolInput({ arguments: resolvedToolInput });
  }, [isReady, toolInput, toolState]);

  // Send tool output when ready
  useEffect(() => {
    if (!isReady || toolState !== "output-available") return;
    const bridge = bridgeRef.current;
    if (!bridge || !toolOutput) return;

    const serialized = JSON.stringify(toolOutput);
    if (lastToolOutputRef.current === serialized) return;
    lastToolOutputRef.current = serialized;

    console.log("[MCP Apps] Sending tool output:", toolOutput);
    console.log("[MCP Apps] Tool output type:", typeof toolOutput);
    console.log(
      "[MCP Apps] Tool output keys:",
      toolOutput ? Object.keys(toolOutput) : "null"
    );
    console.log("[MCP Apps] Tool output._meta:", (toolOutput as any)?._meta);
    console.log(
      "[MCP Apps] Tool output._meta['mcp-use/props']:",
      (toolOutput as any)?._meta?.["mcp-use/props"]
    );
    bridge.sendToolResult(toolOutput as CallToolResult);
  }, [isReady, toolOutput, toolState]);

  // Send error result when tool fails
  useEffect(() => {
    if (!isReady || toolState !== "output-error") return;
    const bridge = bridgeRef.current;
    if (!bridge) return;

    const errorMessage =
      toolErrorText ??
      (toolOutput instanceof Error
        ? toolOutput.message
        : typeof toolOutput === "string"
          ? toolOutput
          : "Tool execution failed");

    if (lastToolErrorRef.current === errorMessage) return;
    lastToolErrorRef.current = errorMessage;

    console.log("[MCP Apps] Sending error result:", errorMessage);
    bridge.sendToolResult({
      content: [{ type: "text", text: errorMessage }],
      isError: true,
    });
  }, [isReady, toolErrorText, toolOutput, toolState]);

  // Reset refs when tool call changes
  useEffect(() => {
    lastToolInputRef.current = null;
    lastToolOutputRef.current = null;
    lastToolErrorRef.current = null;
  }, [toolCallId]);

  // Debug: Log display mode changes
  useEffect(() => {
    console.log("[MCP Apps] Display mode changed to:", displayMode);
  }, [displayMode]);

  // Loading states
  if (toolState !== "output-available") {
    return (
      <div className="border border-border/40 rounded-md bg-muted/30 text-xs text-muted-foreground px-3 py-2">
        Waiting for tool to finish executing...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="border border-destructive/40 bg-destructive/10 text-destructive text-xs rounded-md px-3 py-2">
        Failed to load MCP App: {loadError}
      </div>
    );
  }

  if (!widgetHtml) {
    return (
      <div className="border border-border/40 rounded-md bg-muted/30 text-xs text-muted-foreground px-3 py-2 flex items-center gap-2">
        <Spinner className="size-3" />
        Preparing MCP App widget...
      </div>
    );
  }

  const isPip = displayMode === "pip";
  const isFullscreen = displayMode === "fullscreen";

  console.log("[MCP Apps Render] Current display mode:", displayMode, {
    isPip,
    isFullscreen,
  });

  const containerClassName = (() => {
    if (isFullscreen) {
      return "fixed inset-0 z-40 w-full h-full bg-background flex flex-col";
    }
    if (isPip) {
      return [
        "fixed bottom-6 right-6 z-50",
        "w-[768px] h-[480px]",
        "bg-background shadow-2xl border border-border overflow-hidden rounded-3xl",
      ].join(" ");
    }
    return className || "mt-3 space-y-2 relative group";
  })();

  const iframeStyle: CSSProperties = {
    height: isFullscreen || isPip ? "100%" : `${iframeHeight}px`,
    width: "100%",
    maxWidth: "100%",
    transition:
      isFullscreen || isPip
        ? undefined
        : "height 300ms ease-out, width 300ms ease-out",
  };

  return (
    <div className={containerClassName}>
      {/* Console and debug controls - only in inline mode */}
      {!isFullscreen && !isPip && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
          <IframeConsole iframeId={toolId} enabled={true} />
        </div>
      )}

      {/* Fullscreen navbar with close button */}
      {isFullscreen && (
        <div className="flex items-center justify-between px-4 h-14 border-b border-border/40 bg-background/95 backdrop-blur z-40 shrink-0">
          <div />
          <div className="font-medium text-sm text-muted-foreground">
            {toolName}
          </div>
          <button
            onClick={() => setDisplayMode("inline")}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Exit fullscreen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* PiP close button */}
      {isPip && (
        <button
          onClick={() => setDisplayMode("inline")}
          className="absolute right-3 top-3 z-50 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 hover:bg-background border border-border shadow-lg text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Exit Picture in Picture"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* Sandboxed iframe with conditional styling */}
      <SandboxedIframe
        ref={sandboxRef}
        html={widgetHtml}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        csp={widgetCsp}
        permissions={widgetPermissions}
        permissive={widgetPermissive}
        onMessage={handleCspViolation}
        title={`MCP App: ${toolName}`}
        className={`bg-background overflow-hidden ${
          isFullscreen
            ? "flex-1 border-0 rounded-none"
            : isPip
              ? "rounded-md border-0"
              : `rounded-md ${prefersBorder ? "border border-border/40" : ""}`
        }`}
        style={iframeStyle}
      />

      {/* Info footer - hide in fullscreen and pip */}
      {!isFullscreen && !isPip && (
        <div className="text-[11px] text-muted-foreground/70 mt-2">
          MCP App: <code>{resourceUri}</code>
        </div>
      )}
    </div>
  );
}
