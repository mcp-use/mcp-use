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
  memo,
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
import type { WidgetDeclaredCsp } from "../context/WidgetDebugContext";
import { FullscreenNavbar } from "./FullscreenNavbar";
import type { SandboxedIframeHandle } from "./ui/SandboxedIframe";
import { SandboxedIframe } from "./ui/SandboxedIframe";

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
import { Spinner } from "./ui/spinner";
import { WidgetWrapper } from "./ui/WidgetWrapper";
import { TextShimmer } from "./ui/text-shimmer.js";

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
  onSendFollowUp?: (text: string) => void;
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
}: MCPAppsRendererProps) {
  const sandboxRef = useRef<SandboxedIframeHandle>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const { resolvedTheme } = useTheme();
  const { servers } = useMcpClient();
  const serverFromContext = servers.find((s) => s.id === serverId);
  const server = serverFromContext;

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
  const [isReady, setIsReady] = useState(false);
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
  toolInputRef.current = toolInput;
  toolOutputRef.current = toolOutput;
  customPropsRef.current = customProps;
  readResourceRef.current = readResource;
  serverRef.current = server;
  const [widgetCsp, setWidgetCsp] = useState<any>(undefined);
  const [widgetPermissions, setWidgetPermissions] = useState<any>(undefined);
  const [prefersBorder, setPrefersBorder] = useState<boolean>(false);
  const [internalDisplayMode, setInternalDisplayMode] =
    useState<DisplayMode>("inline");

  // Use controlled displayMode if provided, otherwise use internal state
  const displayMode = displayModeProp ?? internalDisplayMode;

  // Keep a ref so the onsizechange closure (captured at bridge creation) always
  // reads the current displayMode without needing to recreate the bridge.
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;

  // Track the last height requested by the widget in inline mode.
  // This persists across fullscreen/PiP transitions so the iframe is
  // restored to the correct height when returning to inline (rather than
  // always snapping back to DEFAULT_HEIGHT).
  const [inlineHeight, setInlineHeight] = useState<number>(
    MCP_APPS_CONFIG.DIMENSIONS.DEFAULT_HEIGHT
  );

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
        const contentMeta = resourceContent?._meta;

        // Per SEP-1865: _meta.ui may appear on both resources/list entries
        // and resources/read content items, with content-item taking precedence.
        const listingResource = server?.resources?.find(
          (r) => r.uri === resourceUri
        );
        const listingUiMeta = (listingResource as any)?._meta?.ui;
        const contentUiMeta = contentMeta?.ui;
        const mergedUiMeta =
          listingUiMeta || contentUiMeta
            ? { ...listingUiMeta, ...contentUiMeta }
            : undefined;
        // const resourceMeta = {
        //   ...contentMeta,
        //   ...(mergedUiMeta ? { ui: mergedUiMeta } : {}),
        // };

        // MCP Apps: Use ui.csp from resource per SEP-1865. Fallback to openai/widgetCSP
        // from tool metadata (transformed to camelCase) when resource lacks it.
        let mcpAppsCsp = mergedUiMeta?.csp;
        if (!mcpAppsCsp && (toolMetadata as any)?.["openai/widgetCSP"]) {
          const wcsp = (toolMetadata as any)["openai/widgetCSP"] as Record<
            string,
            unknown
          >;
          const fallback: Record<string, unknown> = {};
          if (Array.isArray(wcsp.connect_domains))
            fallback.connectDomains = wcsp.connect_domains;
          if (Array.isArray(wcsp.resource_domains))
            fallback.resourceDomains = wcsp.resource_domains;
          if (Array.isArray(wcsp.frame_domains))
            fallback.frameDomains = wcsp.frame_domains;
          if (Array.isArray(wcsp.base_uri_domains))
            fallback.baseUriDomains = wcsp.base_uri_domains;
          if (Array.isArray(wcsp.script_directives))
            fallback.scriptDirectives = wcsp.script_directives;
          if (Object.keys(fallback).length > 0) mcpAppsCsp = fallback as any;
        }
        const mcpAppsPermissions = mergedUiMeta?.permissions;
        // MCP Apps only: prefersBorder is in resource _meta.ui per spec
        const mcpAppsPrefersBorder = mergedUiMeta?.prefersBorder ?? false;

        // Store widget data
        const storeResponse = await fetch(
          MCP_APPS_CONFIG.API_ENDPOINTS.WIDGET_STORE,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serverId,
              uri: resourceUri,
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
        const contentEndpoint =
          MCP_APPS_CONFIG.API_ENDPOINTS.WIDGET_CONTENT(toolCallId);
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

        const contentJson = await contentResponse.json();
        const { html, csp, permissions, mimeTypeWarning, mimeTypeValid } =
          contentJson;

        if (!mimeTypeValid) {
          setLoadError(
            mimeTypeWarning ||
              'Invalid MIME type - SEP-1865 requires "text/html;profile=mcp-app"'
          );
          return;
        }

        setWidgetHtml(html);
        setIsReady(false);
        if (!hasLoadedOnceRef.current) {
          setShowSpinner(true);
        }
        setWidgetCsp(csp);
        setWidgetPermissions(permissions);
        setPrefersBorder(mcpAppsPrefersBorder);

        // Register widget in debug context
        addWidget(toolCallId, {
          toolName,
          protocol: "mcp-apps",
          hostContext,
        });

        // Populate CSP dialog data: declared CSP and effective policy.
        // Use mcpAppsCsp when csp is undefined (permissive mode) so dialog shows widget-declared domains.
        const cspForDeclared = csp ?? mcpAppsCsp;
        const declaredCsp =
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
        } else if (declaredCsp) {
          effectivePolicy = buildCSPString(declaredCsp);
        }
        setWidgetDeclaredCsp(toolCallId, declaredCsp, effectivePolicy);
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
    // cspMode is intentionally excluded — changes are handled by the effect below.
  }, [serverId, resourceUri, toolCallId, toolName]);

  // When CSP mode changes after the widget has already loaded, request a
  // full tool re-execution so the fresh result is rendered with the new CSP.
  const prevCspModeRef = useRef(cspMode);
  useEffect(() => {
    if (prevCspModeRef.current === cspMode) return;
    prevCspModeRef.current = cspMode;
    if (hasLoadedOnceRef.current && onRerun) {
      onRerun();
    }
  }, [cspMode, onRerun]);

  // Re-read prefersBorder from the server when the widget re-initializes
  // (HMR support). When initCount > 1, it means the widget iframe reloaded
  // (e.g. Vite HMR page reload) and the server may have updated metadata.
  useEffect(() => {
    if (initCount <= 1) return;

    let cancelled = false;
    (async () => {
      try {
        const resourceResult = await readResource(resourceUri);
        if (cancelled) return;
        const contentUiMeta = resourceResult?.contents?.[0]?._meta?.ui;
        if (contentUiMeta && "prefersBorder" in contentUiMeta) {
          setPrefersBorder(contentUiMeta.prefersBorder ?? false);
        }
      } catch {
        // readResource may fail during reconnection; ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initCount, resourceUri, readResource]);

  // Initialize AppBridge when HTML is ready
  useEffect(() => {
    if (!widgetHtml || !sandboxRef.current) return;

    const iframe = sandboxRef.current.getIframeElement();
    if (!iframe?.contentWindow) return;

    setInitCount(0);

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

    // Register bridge handlers.
    // Debounce: only accept the first init per bridge lifecycle; subsequent
    // rapid re-inits (widget re-mounting after receiving data) are suppressed
    // to prevent a feedback loop. A deferred resend ensures the latest widget
    // instance still receives tool data after it settles.
    bridge.oninitialized = () => {
      const now = Date.now();
      if (lastInitTimeRef.current > 0 && now - lastInitTimeRef.current < 2000) {
        clearTimeout(resendTimerRef.current);
        resendTimerRef.current = setTimeout(() => {
          const cp = customPropsRef.current;
          const parsed: Record<string, unknown> = {};
          if (cp) {
            for (const [k, v] of Object.entries(cp)) {
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
          }
          const mergedArgs = { ...toolInputRef.current, ...parsed };
          bridge.sendToolInput({ arguments: mergedArgs });
          const output = toolOutputRef.current;
          if (output) {
            bridge.sendToolResult(output as CallToolResult);
          }
        }, 300);
        return;
      }
      lastInitTimeRef.current = now;
      setInitCount((c) => {
        const next = c + 1;
        return next;
      });
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
      const currentServer = serverRef.current;
      if (!currentServer) {
        throw new Error("Server connection not available");
      }

      try {
        const result = await currentServer.callTool(name, args || {}, {
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
      const result = await readResourceRef.current(uri);
      return result.contents || [];
    };

    bridge.onlistresources = async () => {
      const currentServer = serverRef.current;
      if (!currentServer) {
        throw new Error("Server connection not available");
      }
      return { resources: currentServer.resources };
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
      try {
        localStorage.setItem(
          `mcp-use:widget-state:${toolCallId}`,
          JSON.stringify(structuredContent)
        );
      } catch (_) {
        // localStorage may be unavailable (e.g., private browsing); ignore
        void _;
      }
      return {};
    };

    bridge.onloggingmessage = async ({ level, logger: _logger, data }) => {
      // Publish to console log bus (avoids postMessage issues with browser extensions)
      // When data is an array it means the original console call had multiple args
      // (bridge packs them as an array), so spread them rather than double-wrapping.
      consoleLogBus.publish({
        level: level as any,
        args: Array.isArray(data) ? data : [data],
        timestamp: new Date().toISOString(),
        url: resourceUri,
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
            url: resourceUri,
          },
          "*"
        );
      }
      return {};
    };

    bridge.onsizechange = ({ width, height }) => {
      // Use ref so this closure always reads the current displayMode even
      // though it was captured when the bridge was first created.
      if (displayModeRef.current !== "inline") return;
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
        // Persist in state so React uses this height when returning to inline
        // mode (avoids snapping back to DEFAULT_HEIGHT and missing a resize
        // event when the PiP container happens to be the same pixel height).
        setInlineHeight(adjustedHeight);
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
        return;
      }

      // Widget re-initialization detection (e.g. after Vite HMR page reload).
      // bridge.oninitialized already handles initCount bumping for all
      // ui/initialize messages (with debounce to prevent feedback loops).
      // No initCount bump needed here.

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
      lastInitTimeRef.current = 0;
      clearTimeout(resendTimerRef.current);
      isActive = false;
      window.removeEventListener("message", handleMessage);
      if (bridge) {
        const TEARDOWN_TIMEOUT = 2000;
        (async () => {
          try {
            await Promise.race([
              bridge.teardownResource({}),
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
            bridge.close().catch(() => {});
          }
        })();
      }
      bridgeRef.current = null;
      lastHostContextRef.current = null;
      removeWidget(toolCallId);
    };
  }, [
    widgetHtml,
    sandboxRef,
    toolCallId,
    // readResource, server: use refs to avoid bridge tear-down/recreate on parent re-renders
    // (which would reset initCount and cause iframe/widget to re-init, appearing as "re-render")
  ]);

  // Update host context when it changes (skip redundant notifications to avoid double render)
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0) return;

    const contextKey = JSON.stringify(hostContext);
    if (lastHostContextRef.current === contextKey) return;
    lastHostContextRef.current = contextKey;

    bridge.setHostContext(hostContext);
  }, [hostContext, initCount]);

  // Send partial/streaming tool input when available
  // This must be defined BEFORE the sendToolInput effect so it fires first
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0 || !partialToolInput) return;

    bridge.sendToolInputPartial({ arguments: partialToolInput });
  }, [initCount, partialToolInput]);

  // Send tool input when ready. Re-send when toolCallId changes (re-execution)
  // or when customProps changes (user selects/creates preset with different props).
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0) return;

    // Parse JSON strings in customProps so arrays/objects reach the widget as real values
    const parsedCustomProps: Record<string, unknown> = {};
    if (customProps) {
      for (const [k, v] of Object.entries(customProps)) {
        if (
          typeof v === "string" &&
          (v.trim().startsWith("[") || v.trim().startsWith("{"))
        ) {
          try {
            parsedCustomProps[k] = JSON.parse(v);
          } catch {
            parsedCustomProps[k] = v;
          }
        } else {
          parsedCustomProps[k] = v;
        }
      }
    }
    const mergedArgs = {
      ...toolInput,
      ...parsedCustomProps,
    };
    const propsKey = JSON.stringify(mergedArgs);

    // Skip only if we've already sent this exact payload for this toolCallId
    // Include initCount so a widget re-initialization (e.g. HMR page reload)
    // always re-sends the tool input to the new widget instance.
    const sentKey = `${toolCallId}:${initCount}`;
    if (
      toolInputSentRef.current === sentKey &&
      lastSentPropsRef.current === propsKey
    ) {
      return;
    }

    if (partialToolInput) {
      const frame = requestAnimationFrame(() => {
        bridge.sendToolInput({ arguments: mergedArgs });
        toolInputSentRef.current = sentKey;
        lastSentPropsRef.current = propsKey;
      });
      return () => cancelAnimationFrame(frame);
    } else {
      bridge.sendToolInput({ arguments: mergedArgs });
      toolInputSentRef.current = sentKey;
      lastSentPropsRef.current = propsKey;
    }
  }, [initCount, toolInput, customProps, toolCallId, partialToolInput]);

  // Send tool output when ready
  // Allow sending null to reset widget to pending state (Issue #930)
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0) return;

    // Send toolOutput even if null (allows widget to show pending state on re-execution)
    if (toolOutput) {
      // Skip if we already sent this exact payload (parent re-renders with new ref, same data).
      // Include customProps in the key so a preset change always triggers a re-send with the
      // new structuredContent, even when toolOutput itself hasn't changed.
      const contentKey = JSON.stringify({
        content: (toolOutput as any)?.structuredContent ?? toolOutput,
        customProps: customProps ?? null,
      });
      if (lastSentToolOutputKeyRef.current === contentKey) return;
      lastSentToolOutputKeyRef.current = contentKey;
      const result = toolOutput as CallToolResult;

      // When customProps are set (from user presets), inject them as
      // structuredContent so the widget receives them via useWidget().props.
      // Without this, props only flow through sendToolInput (toolInput) while
      // the widget reads props from the tool result's structuredContent.
      if (customProps && Object.keys(customProps).length > 0) {
        const parsed: Record<string, unknown> = {};
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
        bridge.sendToolResult({
          ...result,
          structuredContent: parsed,
        } as CallToolResult);
      } else {
        bridge.sendToolResult(result);
      }
    }
    // Note: When toolOutput is null, widget stays in pending state (isPending=true)
  }, [initCount, toolOutput, toolCallId, customProps]);

  // Send tool-cancelled notification when user cancels from the host UI
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0 || !cancelled) return;
    bridge.sendToolCancelled({ reason: "Cancelled by user" });
  }, [cancelled, initCount]);

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

  // Hide spinner after iframe loads + brief delay for widget to render (first load only)
  // Also hide when bridge initializes (initCount > 0), which proves the iframe is loaded
  // even if the onLoad event was missed during a rapid remount/re-render cycle.
  const iframeEffectivelyReady = isReady || initCount > 0;

  useEffect(() => {
    if (!iframeEffectivelyReady || !showSpinner) return;

    const timer = setTimeout(() => {
      setShowSpinner(false);
      hasLoadedOnceRef.current = true;
    }, 300);

    return () => clearTimeout(timer);
  }, [iframeEffectivelyReady, showSpinner]);

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
        <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full">
          <Spinner className="size-5" />
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
        `fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-3xl w-full min-w-[300px] h-[400px]`,
        "shadow-2xl border overflow-hidden",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
      ].join(" ");
    }

    return "flex group flex-1 items-center justify-center";
  })();

  const iframeStyle: CSSProperties = {
    height: isFullscreen || isPip ? "100%" : `${inlineHeight}px`,
    width: "100%",
    maxWidth: displayMode === "inline" ? `${inlineMaxWidth}px` : "100%",
    transition:
      isFullscreen || isPip
        ? undefined
        : "height 300ms ease-out, width 300ms ease-out",
  };

  return (
    <WidgetWrapper className={className} noWrapper={noWrapper}>
      <div
        ref={containerRef}
        className={containerClassName}
        style={
          isPip
            ? { maxWidth: MCP_APPS_CONFIG.DIMENSIONS.PIP_MAX_WIDTH }
            : undefined
        }
      >
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
            className="absolute left-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-md bg-background/80 hover:bg-background border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
            aria-label="Close PiP mode"
            title="Close PiP mode"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Main content with centering like Apps SDK */}
        <div
          className={cn(
            "flex-1 w-full h-full flex justify-center items-center relative",
            isFullscreen && "pt-14",
            !isPip && !isFullscreen && (invoking || invoked) && "pt-8"
          )}
        >
          {showSpinner && (
            <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full z-10">
              <Spinner className="size-5" />
            </div>
          )}
          <div
            className="relative w-full"
            style={{ maxWidth: iframeStyle.maxWidth }}
          >
            <div className="absolute -top-8 left-2 z-10 h-full">
              {/* Status label above the widget — only in inline mode */}
              {!isPip && !isFullscreen && (invoking || invoked) && (
                <div className="whitespace-nowrap">
                  {invoking && !toolOutput && (
                    <TextShimmer className="text-xs ">{invoking}</TextShimmer>
                  )}
                  {invoked && !!toolOutput && (
                    <span className="text-xs text-muted-foreground">
                      {invoked}
                    </span>
                  )}
                </div>
              )}
            </div>
            <SandboxedIframe
              ref={sandboxRef}
              html={widgetHtml}
              sandbox={IFRAME_SANDBOX_PERMISSIONS}
              csp={widgetCsp}
              permissions={widgetPermissions}
              permissive={cspMode === "permissive"}
              onLoad={() => setIsReady(true)}
              onMessage={handleSandboxMessage}
              title={`MCP App: ${toolName}`}
              className={cn(
                displayMode === "inline" && "w-full",
                displayMode === "fullscreen" && "w-full h-full rounded-none",
                displayMode === "pip" && "w-full h-full",
                displayMode !== "fullscreen" && prefersBorder && "rounded-lg",
                "overflow-hidden relative z-20",
                prefersBorder && "border border-zinc-200 dark:border-zinc-700"
              )}
              style={iframeStyle}
            />{" "}
          </div>
        </div>
      </div>
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
