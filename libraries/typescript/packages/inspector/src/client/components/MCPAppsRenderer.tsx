/**
 * MCPAppsRenderer - SEP-1865 MCP Apps Renderer
 *
 * Renders MCP Apps widgets via @mcp-ui/client AppFrame + a self-constructed
 * AppBridge (ext-apps). Guest HTML is resolved client-side; the sandbox proxy
 * remains ours. RPC logging wraps AppFrame's transport via InspectorAppBridge.
 */

import { AppFrame } from "@mcp-ui/client";
import {
  AppBridge,
  type McpUiHostCapabilities,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Transport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { X } from "lucide-react";
import { useMcpClient } from "@mcp-use/client/react";
import type { MessageContentBlock } from "mcp-use/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { consoleLogBus } from "../console-log-bus";
import { MCP_APPS_CONFIG } from "../constants";
import { useTheme } from "../context/ThemeContext";
import { useWidgetDebug } from "../context/WidgetDebugContext";
import type { WidgetDeclaredCsp } from "../context/WidgetDebugContext";
import { useDeviceViewport } from "../hooks/useDeviceViewport";
import { useMcpAppsHostContext } from "../hooks/useMcpAppsHostContext";
import { wrapTransportWithLogging } from "../lib/mcp-apps-logging-transport";
import { cn } from "../lib/utils";
import { useWidgetDisplayModeControls } from "../lib/widget-fullscreen";
import { buildMcpAppsSandboxUrl } from "../utils/mcp-apps-sandbox-url";
import { resolveMcpAppsWidgetHtml } from "../utils/mcp-apps-widget-html";
import { FullscreenNavbar } from "./FullscreenNavbar";
import { Spinner } from "./ui/spinner";
import { WidgetWrapper } from "./ui/WidgetWrapper";
import { TextShimmer } from "./ui/text-shimmer.js";

/**
 * Build CSP policy string from declared domains (matches sandbox-proxy buildCSP).
 * Used for CSP dialog display when no violations have occurred yet.
 */
function buildCSPString(csp: WidgetDeclaredCsp): string {
  const sanitize = (d: string) => d.replace(/['"<>;]/g, "").trim();
  const connectDomains = (csp.connectDomains || [])
    .map(sanitize)
    .filter(Boolean);
  const resourceDomains = (csp.resourceDomains || [])
    .map(sanitize)
    .filter(Boolean);
  const frameDomains = (csp.frameDomains || []).map(sanitize).filter(Boolean);
  const baseUriDomains = (csp.baseUriDomains || [])
    .map(sanitize)
    .filter(Boolean);

  const connectSrc =
    connectDomains.length > 0 ? connectDomains.join(" ") : "'none'";
  const resourceSrc =
    resourceDomains.length > 0
      ? ["data:", "blob:", ...resourceDomains].join(" ")
      : "data: blob:";
  const frameSrc = frameDomains.length > 0 ? frameDomains.join(" ") : "'none'";
  const baseUri =
    baseUriDomains.length > 0 ? baseUriDomains.join(" ") : "'none'";

  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resourceSrc}`,
    `style-src 'unsafe-inline' ${resourceSrc}`,
    `img-src ${resourceSrc}`,
    `font-src ${resourceSrc}`,
    `media-src ${resourceSrc}`,
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "object-src 'none'",
    `base-uri ${baseUri}`,
  ].join("; ");
}

type DisplayMode = "inline" | "pip" | "fullscreen";

interface MCPAppsRendererProps {
  serverId: string;
  toolCallId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  toolMetadata?: Record<string, unknown>;
  invoking?: string;
  invoked?: string;
  /** Partial/streaming tool arguments (forwarded to widget via sendToolInputPartial) */
  partialToolInput?: Record<string, unknown>;
  resourceUri: string;
  readResource: (uri: string) => Promise<any>;
  onSendFollowUp?: (content: MessageContentBlock[]) => void;
  className?: string;
  displayMode?: DisplayMode;
  onDisplayModeChange?: (mode: DisplayMode) => void;
  noWrapper?: boolean;
  customProps?: Record<string, string>;
  /** When provided, used directly instead of looking up via useMcpClient(). */
  serverBaseUrl?: string;
  /** When true, sends ui/notifications/tool-cancelled to the widget. */
  cancelled?: boolean;
  /** Called when the CSP mode changes after the widget is already loaded, requesting the tool to be re-executed. */
  onRerun?: () => void;
  /** Called once when the AppBridge handshake completes. Used by the preview/screenshot route. */
  onReady?: () => void;
  /** When true in fullscreen mode, suppresses the fullscreen navbar + top padding so the iframe fills the viewport edge-to-edge. Used by the preview/screenshot route. */
  chromeless?: boolean;
  /** Override the inline-mode max-width cap (default: 768 on desktop, device width on mobile). Used by the preview/screenshot route to render widgets wider than the chat-column width. */
  inlineWidthOverride?: number;
}

const HOST_INFO = { name: "mcp-use-inspector", version: "0.16.2" } as const;

/**
 * AppBridge subclass that wraps AppFrame's PostMessageTransport with RPC logging.
 * AppFrame owns transport construction; we intercept in connect().
 */
class InspectorAppBridge extends AppBridge {
  private readonly toolCallId: string;

  constructor(
    toolCallId: string,
    hostCapabilities: McpUiHostCapabilities,
    options?: ConstructorParameters<typeof AppBridge>[3]
  ) {
    super(null, HOST_INFO, hostCapabilities, options);
    this.toolCallId = toolCallId;
  }

  override connect(transport: Transport): Promise<void> {
    return super.connect(wrapTransportWithLogging(transport, this.toolCallId));
  }
}

function parseCustomProps(
  customProps?: Record<string, string>
): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  if (!customProps) return parsed;
  for (const [k, v] of Object.entries(customProps)) {
    if (
      typeof v === "string" &&
      (v.trim().startsWith("[") || v.trim().startsWith("{"))
    ) {
      try {
        parsed[k] = JSON.parse(v);
      } catch {
        parsed[k] = v;
      }
    } else {
      parsed[k] = v;
    }
  }
  return parsed;
}

function MCPAppsRendererBase({
  serverId,
  toolCallId,
  toolName,
  toolInput,
  toolOutput,
  toolMetadata,
  invoking,
  invoked,
  partialToolInput,
  resourceUri,
  readResource,
  onSendFollowUp,
  className,
  displayMode: displayModeProp,
  onDisplayModeChange,
  noWrapper,
  customProps,
  cancelled,
  onRerun,
  onReady,
  chromeless,
  inlineWidthOverride,
}: MCPAppsRendererProps) {
  const bridgeRef = useRef<InspectorAppBridge | null>(null);
  const frameContainerRef = useRef<HTMLDivElement | null>(null);
  const { resolvedTheme } = useTheme();
  const { servers } = useMcpClient();
  const server = servers.find((s) => s.id === serverId);

  const {
    playground,
    addWidget,
    removeWidget,
    addCspViolation,
    setWidgetModelContext,
    setWidgetDeclaredCsp,
  } = useWidgetDebug();

  const [initCount, setInitCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [widgetHtml, setWidgetHtml] = useState<string | null>(null);
  const [showSpinner, setShowSpinner] = useState(true);
  const hasLoadedOnceRef = useRef(false);
  const toolInputSentRef = useRef<string | null>(null);
  const lastSentPropsRef = useRef<string | null>(null);
  const lastSentToolOutputKeyRef = useRef<string | null>(null);
  const lastInitTimeRef = useRef(0);
  const resendTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const toolInputRef = useRef(toolInput);
  const toolOutputRef = useRef(toolOutput);
  const customPropsRef = useRef(customProps);
  const readResourceRef = useRef(readResource);
  const serverRef = useRef(server);
  const lastHostContextRef = useRef<string | null>(null);
  const onSendFollowUpRef = useRef(onSendFollowUp);
  const resourceUriRef = useRef(resourceUri);
  toolInputRef.current = toolInput;
  toolOutputRef.current = toolOutput;
  customPropsRef.current = customProps;
  readResourceRef.current = readResource;
  serverRef.current = server;
  onSendFollowUpRef.current = onSendFollowUp;
  resourceUriRef.current = resourceUri;

  const [widgetCsp, setWidgetCsp] = useState<
    | {
        connectDomains?: string[];
        resourceDomains?: string[];
        frameDomains?: string[];
        baseUriDomains?: string[];
      }
    | undefined
  >(undefined);
  const [declaredCsp, setDeclaredCsp] = useState<
    | {
        connectDomains?: string[];
        resourceDomains?: string[];
        frameDomains?: string[];
        baseUriDomains?: string[];
      }
    | undefined
  >(undefined);
  const [widgetPermissions, setWidgetPermissions] = useState<
    | {
        camera?: object;
        microphone?: object;
        geolocation?: object;
        clipboardWrite?: object;
      }
    | undefined
  >(undefined);
  const [prefersBorder, setPrefersBorder] = useState<boolean>(false);
  const [internalDisplayMode, setInternalDisplayMode] =
    useState<DisplayMode>("inline");
  const displayMode = displayModeProp ?? internalDisplayMode;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevControlledDisplayModeRef = useRef(displayModeProp);

  const setDisplayMode = useCallback(
    (mode: DisplayMode) => {
      if (displayModeProp !== undefined) {
        prevControlledDisplayModeRef.current = mode;
      }
      if (onDisplayModeChange) onDisplayModeChange(mode);
      else setInternalDisplayMode(mode);
    },
    [onDisplayModeChange, displayModeProp]
  );

  const {
    handleDisplayModeChange,
    fullscreenShellClassName,
    pipShellClassName,
    isFullscreen,
    isPip,
  } = useWidgetDisplayModeControls({
    containerRef,
    displayMode,
    setDisplayMode,
  });

  const handleDisplayModeChangeRef = useRef(handleDisplayModeChange);
  handleDisplayModeChangeRef.current = handleDisplayModeChange;

  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;

  useEffect(() => {
    if (displayModeProp === undefined) return;
    if (prevControlledDisplayModeRef.current === displayModeProp) return;
    prevControlledDisplayModeRef.current = displayModeProp;
    void handleDisplayModeChangeRef.current(displayModeProp);
  }, [displayModeProp]);

  const [inlineHeight, setInlineHeight] = useState<number>(
    MCP_APPS_CONFIG.DIMENSIONS.DEFAULT_HEIGHT
  );

  const cspMode = playground.cspMode;
  const deviceType = playground.deviceType;
  const customViewport = playground.customViewport;

  const { maxWidth, maxHeight } = useDeviceViewport(deviceType, customViewport);

  const inlineMaxWidth =
    inlineWidthOverride ?? (deviceType === "mobile" ? maxWidth : 768);

  const tool = useMemo(() => {
    if (!server?.tools) return undefined;
    return server.tools.find((t) => t.name === toolName);
  }, [server, toolName]);

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
  const hostContextRef = useRef(hostContext);
  hostContextRef.current = hostContext;

  useEffect(() => {
    hasLoadedOnceRef.current = false;
    readyFiredRef.current = false;
  }, [toolCallId, resourceUri]);

  // Fetch + resolve widget HTML client-side (no store/content HTTP round-trip)
  useEffect(() => {
    const fetchWidgetHtml = async () => {
      try {
        const resourceResult = await readResource(resourceUri);
        const listingResource = server?.resources?.find(
          (r) => r.uri === resourceUri
        );

        const resolved = resolveMcpAppsWidgetHtml({
          resourceResult,
          listingResource: listingResource as
            | { _meta?: { ui?: any } }
            | undefined,
          cspMode,
          resourceUri,
        });

        if (!resolved.mimeTypeValid) {
          setLoadError(
            resolved.mimeTypeWarning ||
              'Invalid MIME type - SEP-1865 requires "text/html;profile=mcp-app"'
          );
          return;
        }

        setWidgetHtml(resolved.html);
        if (!hasLoadedOnceRef.current) {
          setShowSpinner(true);
        }
        setWidgetCsp(resolved.csp);
        setDeclaredCsp(resolved.declaredCsp);
        setWidgetPermissions(resolved.permissions);
        setPrefersBorder(resolved.prefersBorder);

        addWidget(toolCallId, {
          toolName,
          protocol: "mcp-apps",
          hostContext,
        });

        const cspForDeclared = resolved.csp ?? resolved.declaredCsp;
        const declared =
          cspForDeclared && typeof cspForDeclared === "object"
            ? {
                connectDomains: cspForDeclared.connectDomains,
                resourceDomains: cspForDeclared.resourceDomains,
                frameDomains: cspForDeclared.frameDomains,
                baseUriDomains: cspForDeclared.baseUriDomains,
              }
            : undefined;
        let effectivePolicy: string | undefined;
        if (cspMode === "permissive") {
          effectivePolicy = [
            "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: filesystem: about:",
            "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
            "style-src * 'unsafe-inline' data: blob:",
            "img-src * data: blob: https: http:",
            "media-src * data: blob: https: http:",
            "font-src * data: blob: https: http:",
            "connect-src * data: blob: https: http: ws: wss: about:",
            "frame-src * data: blob: https: http: about:",
            "object-src * data: blob:",
            "base-uri *",
            "form-action *",
          ].join("; ");
        } else if (declared) {
          effectivePolicy = buildCSPString(declared);
        }
        setWidgetDeclaredCsp(toolCallId, declared, effectivePolicy);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to prepare widget"
        );
      }
    };

    fetchWidgetHtml();
    // cspMode excluded — changes handled by onRerun effect below.
  }, [serverId, resourceUri, toolCallId, toolName]);

  const prevCspModeRef = useRef(cspMode);
  useEffect(() => {
    if (prevCspModeRef.current === cspMode) return;
    prevCspModeRef.current = cspMode;
    if (hasLoadedOnceRef.current && onRerun) {
      onRerun();
    }
  }, [cspMode, onRerun]);

  useEffect(() => {
    if (initCount <= 1) return;

    let cancelledFetch = false;
    (async () => {
      try {
        const resourceResult = await readResource(resourceUri);
        if (cancelledFetch) return;
        const contentUiMeta = resourceResult?.contents?.[0]?._meta?.ui;
        if (contentUiMeta && "prefersBorder" in contentUiMeta) {
          setPrefersBorder(contentUiMeta.prefersBorder ?? false);
        }
      } catch {
        // readResource may fail during reconnection; ignore
      }
    })();
    return () => {
      cancelledFetch = true;
    };
  }, [initCount, resourceUri, readResource]);

  /**
   * Recreate the bridge when the AppFrame host remounts (PiP portal /
   * fullscreen). A connected Protocol cannot cleanly reconnect; AppFrame will
   * call connect() again on the new iframe, so we must hand it a fresh bridge.
   * `isPip`/`isFullscreen` recreate in the same render as the portal move
   * (sandboxGeneration alone would bump one effect-tick too late).
   */
  const bridge = useMemo(() => {
    if (!widgetHtml) return null;

    const hostCapabilities: McpUiHostCapabilities = {
      openLinks: {},
      serverTools: {},
      serverResources: {},
      logging: {},
      sandbox: {
        csp: cspMode === "permissive" ? undefined : widgetCsp,
        permissions: widgetPermissions,
      },
    };

    const instance = new InspectorAppBridge(toolCallId, hostCapabilities, {
      hostContext: hostContextRef.current,
    });

    instance.onmessage = async ({ content }) => {
      if (content.length > 0 && onSendFollowUpRef.current) {
        onSendFollowUpRef.current(content as MessageContentBlock[]);
      }
      return {};
    };

    instance.onopenlink = async ({ url }) => {
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return {};
    };

    instance.oncalltool = (async ({ name, arguments: args }) => {
      const currentServer = serverRef.current;
      if (!currentServer) {
        throw new Error("Server connection not available");
      }

      try {
        const result = await currentServer.callTool(name, args || {}, {
          timeout: MCP_APPS_CONFIG.TIMEOUTS.TOOL_CALL,
          resetTimeoutOnProgress: true,
        });
        return result;
      } catch (error) {
        instance.sendToolCancelled({
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }) as typeof instance.oncalltool;

    instance.onreadresource = async ({ uri }) => {
      const result = await readResourceRef.current(uri);
      return result.contents || [];
    };

    instance.onlistresources = async () => {
      const currentServer = serverRef.current;
      if (!currentServer) {
        throw new Error("Server connection not available");
      }
      return { resources: currentServer.resources };
    };

    instance.onrequestdisplaymode = async ({ mode }) => {
      const requestedMode = (mode ?? "inline") as DisplayMode;
      await handleDisplayModeChangeRef.current(requestedMode);
      return { mode: requestedMode };
    };

    instance.onupdatemodelcontext = async ({ content, structuredContent }) => {
      setWidgetModelContext(toolCallId, { content, structuredContent });
      try {
        localStorage.setItem(
          `mcp-use:widget-state:${toolCallId}`,
          JSON.stringify(structuredContent)
        );
      } catch (_) {
        void _;
      }
      return {};
    };

    instance.onloggingmessage = async ({ level, data }) => {
      consoleLogBus.publish({
        level: level as any,
        args: Array.isArray(data) ? data : [data],
        timestamp: new Date().toISOString(),
        url: resourceUriRef.current,
      });
      if (
        level === "error" &&
        typeof window !== "undefined" &&
        window.parent !== window
      ) {
        const message =
          typeof data === "string"
            ? data
            : typeof (data as { message?: unknown })?.message === "string"
              ? String((data as { message: string }).message)
              : "MCP Apps runtime error";
        const stack =
          typeof (data as { stack?: unknown })?.stack === "string"
            ? String((data as { stack: string }).stack)
            : undefined;
        window.parent.postMessage(
          {
            type: "mcp-inspector:widget:error",
            source: "mcp-apps:logging",
            message,
            stack,
            timestamp: Date.now(),
            toolId: toolCallId,
            url: resourceUriRef.current,
          },
          "*"
        );
      }
      return {};
    };

    return instance;
    // Handlers use refs; recreate only on remount/identity/CSP metadata.
  }, [
    widgetHtml,
    toolCallId,
    isPip,
    isFullscreen,
    cspMode,
    widgetCsp,
    widgetPermissions,
  ]);

  useEffect(() => {
    bridgeRef.current = bridge;
    if (!bridge) return;

    lastInitTimeRef.current = 0;
    toolInputSentRef.current = null;
    lastSentPropsRef.current = null;
    lastSentToolOutputKeyRef.current = null;
    setInitCount(0);

    return () => {
      lastInitTimeRef.current = 0;
      clearTimeout(resendTimerRef.current);
      const toClose = bridge;
      bridgeRef.current = null;
      lastHostContextRef.current = null;
      const TEARDOWN_TIMEOUT = 2000;
      void (async () => {
        try {
          await Promise.race([
            toClose.teardownResource({}),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("teardown timeout")),
                TEARDOWN_TIMEOUT
              )
            ),
          ]);
        } catch {
          // Timeout or error — proceed with close
        } finally {
          toClose.close().catch(() => {});
        }
      })();
    };
  }, [bridge]);

  useEffect(() => {
    return () => {
      removeWidget(toolCallId);
    };
  }, [toolCallId, removeWidget]);

  // Sandbox URL: CSP mode + permissions (+ declared csp) as query params.
  // We intentionally omit SandboxConfig.csp so AppFrame's buildSandboxUrl does
  // not add a competing `csp` param; the proxy reads our query params and the
  // resource-ready message (csp undefined from AppFrame is fine).
  // Backend-less CDN shell may return a blob: URL — revoke on replace/unmount.
  const sandboxUrl = useMemo(() => {
    if (!widgetHtml) return null;
    return buildMcpAppsSandboxUrl({
      cspMode,
      permissions: widgetPermissions,
      widgetCsp: declaredCsp,
    });
  }, [widgetHtml, cspMode, widgetPermissions, declaredCsp]);

  useEffect(() => {
    const url = sandboxUrl;
    return () => {
      if (url?.protocol === "blob:") {
        URL.revokeObjectURL(url.href);
      }
    };
  }, [sandboxUrl]);

  const isBlobSandbox = sandboxUrl?.protocol === "blob:";

  const sandboxOrigin = useMemo(() => {
    if (!sandboxUrl) return null;
    if (isBlobSandbox) return null;
    try {
      return sandboxUrl.origin;
    } catch {
      return null;
    }
  }, [sandboxUrl, isBlobSandbox]);

  // Show spinner when portal remount recreates the bridge
  const prevPipFsRef = useRef({ isPip, isFullscreen });
  useEffect(() => {
    const prev = prevPipFsRef.current;
    if (prev.isPip !== isPip || prev.isFullscreen !== isFullscreen) {
      prevPipFsRef.current = { isPip, isFullscreen };
      if (hasLoadedOnceRef.current) {
        setShowSpinner(true);
      }
    }
  }, [isPip, isFullscreen]);

  // CSP violations + iframe console error forwarding (AppFrame gives no iframe ref).
  // Blob sandbox origins are opaque ("null") or page-origin depending on browser —
  // trust event.source === iframe.contentWindow instead of the origin string.
  useEffect(() => {
    if (!sandboxOrigin && !isBlobSandbox) return;

    const handleMessage = (event: MessageEvent) => {
      const iframe = frameContainerRef.current?.querySelector("iframe") ?? null;
      if (!iframe?.contentWindow) return;
      if (event.source !== iframe.contentWindow) return;
      if (
        !isBlobSandbox &&
        event.origin !== sandboxOrigin &&
        sandboxOrigin !== "*"
      ) {
        return;
      }

      if (event.data?.type === "mcp-apps:csp-violation") {
        const {
          directive,
          blockedUri,
          sourceFile,
          lineNumber,
          columnNumber,
          effectiveDirective,
          originalPolicy,
          timestamp,
        } = event.data;

        addCspViolation(toolCallId, {
          directive,
          effectiveDirective,
          blockedUri,
          sourceFile,
          lineNumber,
          columnNumber,
          originalPolicy,
          timestamp: timestamp || Date.now(),
        });

        console.warn(
          `[MCP Apps CSP Violation] ${directive}: Blocked ${blockedUri}`,
          sourceFile ? `at ${sourceFile}:${lineNumber}:${columnNumber}` : ""
        );
        return;
      }

      if (event.data?.type === "iframe-console-log") {
        if (
          event.data.level === "error" &&
          typeof window !== "undefined" &&
          window.parent !== window
        ) {
          const args = Array.isArray(event.data.args) ? event.data.args : [];
          const first = args[0];
          const message =
            typeof first === "string"
              ? first
              : typeof first?.message === "string"
                ? first.message
                : "MCP Apps iframe runtime error";
          const stack =
            typeof first?.error?.stack === "string"
              ? first.error.stack
              : typeof first?.stack === "string"
                ? first.stack
                : undefined;
          window.parent.postMessage(
            {
              type: "mcp-inspector:widget:error",
              source: "mcp-apps:iframe-console:error",
              message,
              stack,
              timestamp: Date.now(),
              toolId: toolCallId,
              url:
                typeof event.data.url === "string"
                  ? event.data.url
                  : resourceUri,
            },
            "*"
          );
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [sandboxOrigin, isBlobSandbox, toolCallId, addCspViolation, resourceUri]);

  const handleInitialized = useCallback(() => {
    const now = Date.now();
    const activeBridge = bridgeRef.current;
    if (!activeBridge) return;

    if (lastInitTimeRef.current > 0 && now - lastInitTimeRef.current < 2000) {
      clearTimeout(resendTimerRef.current);
      resendTimerRef.current = setTimeout(() => {
        const mergedArgs = {
          ...toolInputRef.current,
          ...parseCustomProps(customPropsRef.current),
        };
        activeBridge.sendToolInput({ arguments: mergedArgs });
        const output = toolOutputRef.current;
        if (output) {
          activeBridge.sendToolResult(
            output as unknown as Parameters<
              typeof activeBridge.sendToolResult
            >[0]
          );
        }
      }, 300);
      return;
    }
    lastInitTimeRef.current = now;
    setInitCount((c) => c + 1);
  }, []);

  const handleSizeChanged = useCallback(
    ({ height }: { width?: number; height?: number }) => {
      // AppFrame already applies height/width on its iframe; we only track
      // inlineHeight for our wrapper chrome (avoid a second iframe resize).
      if (displayModeRef.current !== "inline") return;
      if (height === undefined) return;
      setInlineHeight(height);
    },
    []
  );

  const handleAppFrameError = useCallback((error: Error) => {
    setLoadError(error.message || "Failed to connect MCP App");
  }, []);

  useEffect(() => {
    const active = bridgeRef.current;
    if (!active || initCount === 0) return;

    const contextKey = JSON.stringify(hostContext);
    if (lastHostContextRef.current === contextKey) return;
    lastHostContextRef.current = contextKey;

    active.setHostContext(hostContext);
  }, [hostContext, initCount]);

  useEffect(() => {
    const active = bridgeRef.current;
    if (!active || initCount === 0 || !partialToolInput) return;

    active.sendToolInputPartial({ arguments: partialToolInput });
  }, [initCount, partialToolInput]);

  useEffect(() => {
    const active = bridgeRef.current;
    if (!active || initCount === 0) return;

    const parsedCustomProps = parseCustomProps(customProps);
    const mergedArgs = {
      ...toolInput,
      ...parsedCustomProps,
    };
    const propsKey = JSON.stringify(mergedArgs);

    const sentKey = `${toolCallId}:${initCount}`;
    if (
      toolInputSentRef.current === sentKey &&
      lastSentPropsRef.current === propsKey
    ) {
      return;
    }

    if (partialToolInput) {
      const frame = requestAnimationFrame(() => {
        active.sendToolInput({ arguments: mergedArgs });
        toolInputSentRef.current = sentKey;
        lastSentPropsRef.current = propsKey;
      });
      return () => cancelAnimationFrame(frame);
    } else {
      active.sendToolInput({ arguments: mergedArgs });
      toolInputSentRef.current = sentKey;
      lastSentPropsRef.current = propsKey;
    }
  }, [initCount, toolInput, customProps, toolCallId, partialToolInput]);

  useEffect(() => {
    const active = bridgeRef.current;
    if (!active || initCount === 0) return;

    if (toolOutput) {
      const contentKey = JSON.stringify({
        content: (toolOutput as any)?.structuredContent ?? toolOutput,
        customProps: customProps ?? null,
      });
      if (lastSentToolOutputKeyRef.current === contentKey) return;
      lastSentToolOutputKeyRef.current = contentKey;
      const result = toolOutput as CallToolResult;

      if (customProps && Object.keys(customProps).length > 0) {
        const parsed = parseCustomProps(customProps);
        active.sendToolResult({
          ...result,
          structuredContent: parsed,
        } as unknown as Parameters<typeof active.sendToolResult>[0]);
      } else {
        active.sendToolResult(
          result as unknown as Parameters<typeof active.sendToolResult>[0]
        );
      }
    }
  }, [initCount, toolOutput, toolCallId, customProps]);

  useEffect(() => {
    const active = bridgeRef.current;
    if (!active || initCount === 0 || !cancelled) return;
    active.sendToolCancelled({ reason: "Cancelled by user" });
  }, [cancelled, initCount]);

  const readyFiredRef = useRef(false);
  useEffect(() => {
    if (readyFiredRef.current) return;
    if (initCount > 0) {
      readyFiredRef.current = true;
      onReady?.();
    }
  }, [initCount, onReady]);

  useEffect(() => {
    if (initCount === 0 || !showSpinner) return;

    const timer = setTimeout(() => {
      setShowSpinner(false);
      hasLoadedOnceRef.current = true;
    }, 300);

    return () => clearTimeout(timer);
  }, [initCount, showSpinner]);

  const initialToolInput = useMemo(() => {
    return {
      ...toolInput,
      ...parseCustomProps(customProps),
    };
  }, [toolInput, customProps]);

  const initialToolResult = useMemo(() => {
    if (!toolOutput) return undefined;
    if (customProps && Object.keys(customProps).length > 0) {
      return {
        ...(toolOutput as CallToolResult),
        structuredContent: parseCustomProps(customProps),
      } as CallToolResult;
    }
    return toolOutput as CallToolResult;
  }, [toolOutput, customProps]);

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

  if (!widgetHtml || !bridge || !sandboxUrl) {
    return (
      <WidgetWrapper className={className} noWrapper={noWrapper}>
        <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full">
          <Spinner className="size-5" />
        </div>
      </WidgetWrapper>
    );
  }

  const containerClassName = (() => {
    if (fullscreenShellClassName) {
      return fullscreenShellClassName;
    }
    if (pipShellClassName) {
      return pipShellClassName;
    }
    return "flex group flex-1 items-center justify-center";
  })();

  const frameStyle: CSSProperties = {
    height: isFullscreen || isPip ? "100%" : `${inlineHeight}px`,
    width: "100%",
    maxWidth: displayMode === "inline" ? `${inlineMaxWidth}px` : "100%",
    transition: isFullscreen || isPip ? undefined : "height 300ms ease-out",
  };

  const widgetShell = (
    <div
      ref={containerRef}
      className={containerClassName}
      style={
        isPip
          ? { maxWidth: MCP_APPS_CONFIG.DIMENSIONS.PIP_MAX_WIDTH }
          : undefined
      }
    >
      {isFullscreen && !chromeless && (
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
          className="absolute left-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-md bg-background/80 hover:bg-background border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
          aria-label="Close PiP mode"
          title="Close PiP mode"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div
        className={cn(
          "relative w-full min-h-0",
          isFullscreen || isPip
            ? "flex flex-1 flex-col"
            : "flex flex-1 justify-center items-center",
          !isPip && !isFullscreen && (invoking || invoked) && "pt-8"
        )}
      >
        {showSpinner && (
          <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full z-10">
            <Spinner className="size-5" />
          </div>
        )}
        <div
          className={cn(
            "relative w-full",
            isFullscreen || isPip ? "h-full min-h-0 flex-1" : "h-full"
          )}
          style={
            isFullscreen || isPip
              ? undefined
              : { maxWidth: frameStyle.maxWidth }
          }
        >
          {!isPip && !isFullscreen && (invoking || invoked) && (
            <div className="absolute -top-8 left-2 z-10 whitespace-nowrap pointer-events-none">
              {invoking && !toolOutput && (
                <TextShimmer className="text-xs ">{invoking}</TextShimmer>
              )}
              {invoked && !!toolOutput && (
                <span className="text-xs text-muted-foreground">{invoked}</span>
              )}
            </div>
          )}
          {/*
            DOM for e2e: container[data-testid=mcp-app-frame] > AppFrame's div > iframe
            (no title= on the iframe — AppFrame does not expose title/className).
            Former selector iframe[title^="MCP App: "] must be updated to
            [data-testid="mcp-app-frame"] iframe (or the testid itself).
          */}
          <div
            ref={frameContainerRef}
            data-testid="mcp-app-frame"
            data-mcp-app-tool={toolName}
            className={cn(
              "mcp-app-frame",
              displayMode === "inline" && "w-full",
              displayMode === "fullscreen" && "w-full h-full rounded-none",
              displayMode === "pip" && "w-full h-full",
              displayMode !== "fullscreen" && prefersBorder && "rounded-lg",
              "overflow-hidden",
              prefersBorder && "border border-zinc-200 dark:border-zinc-700",
              // Style AppFrame's inner iframe (no className/title props on AppFrame)
              "[&>div]:h-full [&>div]:w-full",
              "[&_iframe]:w-full [&_iframe]:h-full [&_iframe]:border-0 [&_iframe]:bg-transparent"
            )}
            style={frameStyle}
          >
            <AppFrame
              html={widgetHtml}
              sandbox={{ url: sandboxUrl }}
              appBridge={bridge}
              toolInput={initialToolInput}
              toolResult={initialToolResult}
              onInitialized={handleInitialized}
              onSizeChanged={handleSizeChanged}
              onError={handleAppFrameError}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <WidgetWrapper className={className} noWrapper={noWrapper}>
      {isPip && typeof document !== "undefined"
        ? createPortal(widgetShell, document.body)
        : widgetShell}
    </WidgetWrapper>
  );
}

function mcpAppsRendererAreEqual(
  prev: MCPAppsRendererProps,
  next: MCPAppsRendererProps
): boolean {
  const keys: (keyof MCPAppsRendererProps)[] = [
    "serverId",
    "toolCallId",
    "toolName",
    "resourceUri",
    "displayMode",
    "cancelled",
    "noWrapper",
  ];
  for (const k of keys) {
    if (prev[k] !== next[k]) return false;
  }
  if (prev.toolInput !== next.toolInput) return false;
  if (prev.toolOutput !== next.toolOutput) return false;
  if (prev.toolMetadata !== next.toolMetadata) return false;
  if (prev.partialToolInput !== next.partialToolInput) return false;
  if (prev.customProps !== next.customProps) return false;
  if (prev.readResource !== next.readResource) return false;
  if (prev.onSendFollowUp !== next.onSendFollowUp) return false;
  if (prev.onRerun !== next.onRerun) return false;
  if (prev.onReady !== next.onReady) return false;
  if (prev.chromeless !== next.chromeless) return false;
  if (prev.inlineWidthOverride !== next.inlineWidthOverride) return false;
  if (prev.onDisplayModeChange !== next.onDisplayModeChange) return false;
  if (prev.className !== next.className) return false;
  if (prev.serverBaseUrl !== next.serverBaseUrl) return false;
  if (prev.invoking !== next.invoking) return false;
  if (prev.invoked !== next.invoked) return false;
  return true;
}

export const MCPAppsRenderer = memo(
  MCPAppsRendererBase,
  mcpAppsRendererAreEqual
);
