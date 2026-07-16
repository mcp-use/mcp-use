import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiHostCapabilities,
  type McpUiMessageRequest,
  type McpUiOpenLinkRequest,
  type McpUiRequestDisplayModeRequest,
  type McpUiSizeChangedNotification,
  type McpUiUpdateModelContextRequest,
} from "./ext-apps-bridge.js";
import type {
  CallToolRequest,
  LoggingMessageNotificationParams,
  ReadResourceRequest,
  Transport,
} from "@modelcontextprotocol/client";
import React, {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { parseCustomProps } from "./parse-custom-props.js";
import { resolveViewResource } from "./resolve-view-resource.js";
import { buildViewSandboxBlobUrl } from "./sandbox-blob-url.js";
import type {
  ResolvedViewResource,
  ViewDisplayMode,
  ViewRendererProps,
} from "./types.js";
import {
  useViewDisplayModeControls,
  VIEW_DIMENSIONS,
} from "./use-display-mode.js";

const DEFAULT_HOST_INFO = { name: "mcp-use-client", version: "2.0.0" } as const;
const DEFAULT_TOOL_CALL_TIMEOUT = 600_000;
const SANDBOX_PROXY_READY = "ui/notifications/sandbox-proxy-ready";
const DEFAULT_HOST_CAPABILITIES: McpUiHostCapabilities = {
  openLinks: {},
  serverTools: {},
  serverResources: {},
  logging: {},
  updateModelContext: { text: {} },
};

function waitForSandboxProxyReady(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (
        event.source === iframe.contentWindow &&
        event.data?.method === SANDBOX_PROXY_READY
      ) {
        window.removeEventListener("message", listener);
        resolve();
      }
    };
    window.addEventListener("message", listener);
  });
}

function hookInitialized(bridge: AppBridge): Promise<void> {
  const prev = bridge.oninitialized;
  return new Promise((resolve) => {
    bridge.oninitialized = (...args: unknown[]) => {
      resolve();
      bridge.oninitialized = prev;
      (prev as ((...a: unknown[]) => void) | undefined)?.(...args);
    };
  });
}

function ViewRendererBase({
  viewId,
  source,
  sandboxUrl,
  toolName = "view",
  toolInput,
  toolOutput,
  partialToolInput,
  customProps,
  cancelled,
  hostInfo = DEFAULT_HOST_INFO,
  hostContext,
  hostCapabilities,
  cspMode = "widget-declared",
  displayMode: displayModeProp,
  onDisplayModeChange,
  inlineMaxWidth = 768,
  chromeless,
  onMessage,
  onModelContextUpdate,
  onLog,
  onReady,
  onLifecycleChange,
  onError,
  onCspViolation,
  onResourceResolved,
  wrapTransport,
  toolCallTimeout = DEFAULT_TOOL_CALL_TIMEOUT,
  className,
  testId = "mcp-app-frame",
  invoking,
  invoked,
}: ViewRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const connectionRef = useRef(
    source.kind === "live" ? source.connection : null
  );

  const [resolved, setResolved] = useState<ResolvedViewResource | null>(null);
  const [activeSandboxUrl, setActiveSandboxUrl] = useState<URL | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initCount, setInitCount] = useState(0);
  const [showSpinner, setShowSpinner] = useState(true);
  const [inlineHeight, setInlineHeight] = useState<number>(
    VIEW_DIMENSIONS.DEFAULT_HEIGHT
  );
  const [internalDisplayMode, setInternalDisplayMode] =
    useState<ViewDisplayMode>("inline");
  const displayMode = displayModeProp ?? internalDisplayMode;

  const hostContextRef = useRef(hostContext);
  hostContextRef.current = hostContext;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const toolInputRef = useRef(toolInput);
  toolInputRef.current = toolInput;
  const toolOutputRef = useRef(toolOutput);
  toolOutputRef.current = toolOutput;
  const customPropsRef = useRef(customProps);
  customPropsRef.current = customProps;
  const onResourceResolvedRef = useRef(onResourceResolved);
  onResourceResolvedRef.current = onResourceResolved;
  const onModelContextUpdateRef = useRef(onModelContextUpdate);
  onModelContextUpdateRef.current = onModelContextUpdate;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCspViolationRef = useRef(onCspViolation);
  onCspViolationRef.current = onCspViolation;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onLifecycleChangeRef = useRef(onLifecycleChange);
  onLifecycleChangeRef.current = onLifecycleChange;
  const sandboxUrlRef = useRef(sandboxUrl);
  sandboxUrlRef.current = sandboxUrl;
  const cspModeRef = useRef(cspMode);
  cspModeRef.current = cspMode;

  const resolveSandboxUrl = useCallback((next: ResolvedViewResource): URL => {
    const custom = sandboxUrlRef.current;
    if (custom) {
      return typeof custom === "function" ? custom(next) : custom;
    }
    return buildViewSandboxBlobUrl({
      cspMode: cspModeRef.current,
      permissions: next.permissions,
      widgetCsp: next.declaredCsp,
    });
  }, []);

  const setDisplayMode = useCallback(
    (mode: ViewDisplayMode) => {
      if (onDisplayModeChange) onDisplayModeChange(mode);
      else setInternalDisplayMode(mode);
    },
    [onDisplayModeChange]
  );

  const {
    handleDisplayModeChange,
    fullscreenShellClassName,
    pipShellClassName,
    isFullscreen,
    isPip,
  } = useViewDisplayModeControls({
    containerRef,
    displayMode,
    setDisplayMode,
  });

  const handleDisplayModeChangeRef = useRef(handleDisplayModeChange);
  handleDisplayModeChangeRef.current = handleDisplayModeChange;
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;

  const liveResourceUri =
    source.kind === "live" ? source.resourceUri : undefined;
  const preloadedHtml = source.kind === "preloaded" ? source.html : undefined;

  if (source.kind === "live") {
    connectionRef.current = source.connection;
  }

  // Resolve widget HTML from live connection or preloaded source
  useEffect(() => {
    let cancelledEffect = false;
    onLifecycleChangeRef.current?.({ status: "resolving" });

    const applyResolved = (next: ResolvedViewResource) => {
      setResolved(next);
      onLifecycleChangeRef.current?.({ status: "sandbox-loading" });
      const nextSandbox = resolveSandboxUrl(next);
      setActiveSandboxUrl((prev) =>
        prev?.href === nextSandbox.href ? prev : nextSandbox
      );
      onResourceResolvedRef.current?.(next);
    };

    if (source.kind === "preloaded") {
      const preloaded: ResolvedViewResource = {
        html: source.html,
        declaredCsp: source.csp,
        csp: cspMode === "permissive" ? undefined : source.csp,
        permissions: source.permissions,
        prefersBorder: source.prefersBorder ?? false,
        mimeType: "text/html;profile=mcp-app",
        mimeTypeValid: true,
        mimeTypeWarning: null,
      };
      applyResolved(preloaded);
      return;
    }

    const { connection, resourceUri } = source;
    connectionRef.current = connection;

    (async () => {
      try {
        const resourceResult = await connection.readResource(resourceUri);
        if (cancelledEffect) return;
        const listingResource = connection.resources?.find(
          (r) => r.uri === resourceUri
        ) as { _meta?: { ui?: unknown } } | undefined;
        const next = resolveViewResource({
          resourceResult,
          listingResource,
          cspMode,
          resourceUri,
        });
        if (!next.mimeTypeValid) {
          const message =
            next.mimeTypeWarning ||
            'Invalid MIME type - SEP-1865 requires "text/html;profile=mcp-app"';
          setLoadError(message);
          onLifecycleChangeRef.current?.({ status: "error", error: message });
          return;
        }
        applyResolved(next);
      } catch (err) {
        if (cancelledEffect) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to prepare view"
        );
        onLifecycleChangeRef.current?.({
          status: "error",
          error: err instanceof Error ? err.message : "Failed to prepare view",
        });
      }
    })();

    return () => {
      cancelledEffect = true;
    };
  }, [source.kind, liveResourceUri, preloadedHtml, cspMode, resolveSandboxUrl]);

  // Revoke blob sandbox URLs on unmount
  useEffect(() => {
    const url = activeSandboxUrl;
    return () => {
      if (url?.protocol === "blob:") {
        URL.revokeObjectURL(url.href);
      }
    };
  }, [activeSandboxUrl]);

  const isBlobSandbox = activeSandboxUrl?.protocol === "blob:";
  const sandboxOrigin =
    !activeSandboxUrl || isBlobSandbox
      ? null
      : (() => {
          try {
            return activeSandboxUrl.origin;
          } catch {
            return null;
          }
        })();

  // CSP violations + iframe console forwarding
  useEffect(() => {
    if (!sandboxOrigin && !isBlobSandbox) return;

    const handleMessage = (event: MessageEvent) => {
      const iframe = iframeRef.current;
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
        onCspViolationRef.current?.({
          directive: event.data.directive,
          effectiveDirective: event.data.effectiveDirective,
          blockedUri: event.data.blockedUri,
          sourceFile: event.data.sourceFile,
          lineNumber: event.data.lineNumber,
          columnNumber: event.data.columnNumber,
          originalPolicy: event.data.originalPolicy,
          timestamp: event.data.timestamp || Date.now(),
        });
        return;
      }

      if (event.data?.type === "iframe-console-log" && onLogRef.current) {
        onLogRef.current({
          level: event.data.level ?? "log",
          data: event.data.args,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [sandboxOrigin, isBlobSandbox]);

  // Bridge lifecycle: sandbox → connect → resource-ready → initialized
  useEffect(() => {
    if (!resolved || !activeSandboxUrl) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let disposed = false;
    let bridge: AppBridge | null = null;

    const run = async () => {
      try {
        onLifecycleChangeRef.current?.({ status: "connecting" });
        iframe.setAttribute(
          "sandbox",
          "allow-scripts allow-same-origin allow-forms"
        );
        const allowAttribute = buildAllowAttribute(resolved.permissions);
        if (allowAttribute) {
          iframe.setAttribute("allow", allowAttribute);
        }

        const readyPromise = waitForSandboxProxyReady(iframe);
        iframe.src = activeSandboxUrl.href;
        await readyPromise;
        if (disposed) return;

        const capabilities: McpUiHostCapabilities = {
          ...(hostCapabilities ?? DEFAULT_HOST_CAPABILITIES),
          sandbox: {
            csp: cspMode === "permissive" ? undefined : resolved.csp,
            permissions: resolved.permissions,
          },
        };

        bridge = new AppBridge(null, hostInfo, capabilities, {
          hostContext: hostContextRef.current,
        });

        bridge.onmessage = async ({
          content,
        }: McpUiMessageRequest["params"]) => {
          if (content.length > 0 && onMessageRef.current) {
            onMessageRef.current(content);
          }
          return {};
        };

        bridge.onopenlink = async ({ url }: McpUiOpenLinkRequest["params"]) => {
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          return {};
        };

        bridge.oncalltool = (async ({
          name,
          arguments: args,
        }: CallToolRequest["params"]) => {
          const conn = connectionRef.current;
          if (!conn) throw new Error("Server connection not available");
          try {
            return await conn.callTool(name, args || {}, {
              timeout: toolCallTimeout,
              resetTimeoutOnProgress: true,
            });
          } catch (error) {
            bridge?.sendToolCancelled({
              reason: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }) as typeof bridge.oncalltool;

        bridge.onreadresource = (async ({
          uri,
        }: ReadResourceRequest["params"]) => {
          const conn = connectionRef.current;
          if (!conn) throw new Error("Server connection not available");
          return (await conn.readResource(uri)) as object;
        }) as NonNullable<AppBridge["onreadresource"]>;

        bridge.onlistresources = (async () => {
          const conn = connectionRef.current;
          if (!conn) throw new Error("Server connection not available");
          return { resources: [...(conn.resources ?? [])] } as object;
        }) as NonNullable<AppBridge["onlistresources"]>;

        bridge.onrequestdisplaymode = async ({
          mode,
        }: McpUiRequestDisplayModeRequest["params"]) => {
          const requested = (mode ?? "inline") as ViewDisplayMode;
          const available = hostContextRef.current?.availableDisplayModes ?? [
            "inline",
            "pip",
            "fullscreen",
          ];
          const effective = available.includes(requested)
            ? requested
            : displayModeRef.current;
          await handleDisplayModeChangeRef.current(effective);
          return { mode: effective };
        };

        bridge.onupdatemodelcontext = async ({
          content,
          structuredContent,
        }: McpUiUpdateModelContextRequest["params"]) => {
          onModelContextUpdateRef.current?.({ content, structuredContent });
          return {};
        };

        bridge.onloggingmessage = async ({
          level,
          data,
        }: LoggingMessageNotificationParams) => {
          onLogRef.current?.({ level, data });
          return {};
        };

        bridge.onsizechange = async ({
          height,
        }: McpUiSizeChangedNotification["params"]) => {
          if (displayModeRef.current !== "inline") return;
          if (height !== undefined) setInlineHeight(height);
        };

        const initPromise = hookInitialized(bridge);
        let transport: Transport = new PostMessageTransport(
          iframe.contentWindow!,
          iframe.contentWindow!
        );
        if (wrapTransport) {
          transport = wrapTransport(transport, viewId);
        }
        await bridge.connect(transport);
        if (disposed) return;

        await bridge.sendSandboxResourceReady({
          html: resolved.html,
          csp: resolved.csp,
          permissions: resolved.permissions,
        });
        await initPromise;
        if (disposed) return;

        bridgeRef.current = bridge;
        setInitCount((c) => c + 1);
        onLifecycleChangeRef.current?.({ status: "initialized" });

        const mergedArgs = {
          ...toolInputRef.current,
          ...parseCustomProps(customPropsRef.current),
        };
        bridge.sendToolInput({ arguments: mergedArgs });
        const output = toolOutputRef.current;
        if (output) {
          bridge.sendToolResult(
            output as Parameters<typeof bridge.sendToolResult>[0]
          );
        }
        onLifecycleChangeRef.current?.({ status: "ready" });
      } catch (err) {
        if (!disposed) {
          const message =
            err instanceof Error ? err.message : "Failed to connect view";
          setLoadError(message);
          onErrorRef.current?.(message);
          onLifecycleChangeRef.current?.({ status: "error", error: message });
        }
      }
    };

    void run();

    return () => {
      disposed = true;
      const toClose = bridge;
      bridgeRef.current = null;
      if (!toClose) return;
      onLifecycleChangeRef.current?.({ status: "tearing-down" });
      void (async () => {
        try {
          await Promise.race([
            toClose.teardownResource({}),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("teardown timeout")), 2000)
            ),
          ]);
        } catch {
          // proceed
        } finally {
          toClose.close().catch(() => {});
          onLifecycleChangeRef.current?.({ status: "closed" });
        }
      })();
    };
  }, [
    resolved,
    activeSandboxUrl,
    hostInfo,
    hostCapabilities,
    cspMode,
    viewId,
    wrapTransport,
    toolCallTimeout,
  ]);

  // Host context updates after init
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0 || !hostContext) return;
    bridge.setHostContext(hostContext);
  }, [hostContext, initCount]);

  // Partial tool input
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0 || !partialToolInput) return;
    bridge.sendToolInputPartial({ arguments: partialToolInput });
  }, [initCount, partialToolInput]);

  // Tool input + custom props
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0) return;
    const mergedArgs = {
      ...toolInput,
      ...parseCustomProps(customProps),
    };
    bridge.sendToolInput({ arguments: mergedArgs });
  }, [initCount, toolInput, customProps]);

  // Tool output
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0 || !toolOutput) return;
    if (customProps && Object.keys(customProps).length > 0) {
      bridge.sendToolResult({
        ...(toolOutput as object),
        structuredContent: parseCustomProps(customProps),
      } as Parameters<typeof bridge.sendToolResult>[0]);
    } else {
      bridge.sendToolResult(
        toolOutput as Parameters<typeof bridge.sendToolResult>[0]
      );
    }
  }, [initCount, toolOutput, customProps]);

  // Cancellation
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0 || !cancelled) return;
    bridge.sendToolCancelled({ reason: "Cancelled by user" });
  }, [cancelled, initCount]);

  const readyFiredRef = useRef(false);
  useEffect(() => {
    if (readyFiredRef.current || initCount === 0) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  }, [initCount]);

  useEffect(() => {
    if (initCount === 0 || !showSpinner) return;
    const timer = setTimeout(() => setShowSpinner(false), 300);
    return () => clearTimeout(timer);
  }, [initCount, showSpinner]);

  if (loadError) {
    return (
      <div className={className}>
        <div className="border border-red-200/50 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/20 rounded-lg p-4">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load view: {loadError}
          </p>
        </div>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center w-full h-[200px]">
          <span className="text-sm text-muted-foreground">Loading view…</span>
        </div>
      </div>
    );
  }

  const containerClassName =
    fullscreenShellClassName ??
    pipShellClassName ??
    "flex group flex-1 items-center justify-center";

  const frameStyle: CSSProperties = {
    height: isFullscreen || isPip ? "100%" : `${inlineHeight}px`,
    width: "100%",
    maxWidth: displayMode === "inline" ? `${inlineMaxWidth}px` : "100%",
    transition: isFullscreen || isPip ? undefined : "height 300ms ease-out",
  };

  const viewShell = (
    <div
      ref={containerRef}
      className={containerClassName}
      style={
        isPip
          ? {
              height: VIEW_DIMENSIONS.DEFAULT_HEIGHT,
              maxWidth: VIEW_DIMENSIONS.PIP_MAX_WIDTH,
              zIndex: 100,
            }
          : isFullscreen
            ? { zIndex: 100 }
            : undefined
      }
    >
      {(isFullscreen || isPip) && (
        <button
          type="button"
          data-testid={
            isFullscreen
              ? "debugger-exit-fullscreen-button"
              : "debugger-exit-pip-button"
          }
          aria-label={
            isFullscreen ? "Exit fullscreen" : "Exit picture-in-picture"
          }
          className="absolute right-3 top-3 z-[110] flex size-8 items-center justify-center rounded-full border border-border bg-background/90 text-lg leading-none text-foreground shadow-sm backdrop-blur-sm hover:bg-background"
          style={{ zIndex: 110 }}
          onClick={() => void handleDisplayModeChange("inline")}
        >
          ×
        </button>
      )}
      <div
        className={
          isFullscreen || isPip
            ? "relative w-full h-full min-h-0 flex flex-1 flex-col"
            : "relative w-full flex flex-1 justify-center items-center"
        }
      >
        {showSpinner && (
          <div className="flex absolute inset-0 items-center justify-center z-10">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        )}
        {!isPip && !isFullscreen && (invoking || invoked) && (
          <div className="absolute -top-8 left-2 z-10 whitespace-nowrap pointer-events-none text-xs text-muted-foreground">
            {invoking && !toolOutput ? invoking : invoked}
          </div>
        )}
        <div
          data-testid={testId}
          data-mcp-app-tool={toolName}
          className={
            displayMode === "fullscreen"
              ? "w-full h-full overflow-hidden"
              : "w-full overflow-hidden"
          }
          style={frameStyle}
        >
          <iframe
            ref={iframeRef}
            title={`MCP App: ${toolName}`}
            className="w-full h-full border-0 bg-transparent"
            style={{
              border:
                resolved.prefersBorder && displayMode !== "fullscreen"
                  ? undefined
                  : "none",
            }}
          />
        </div>
      </div>
    </div>
  );

  return <div className={className}>{viewShell}</div>;
}

function viewRendererAreEqual(
  prev: ViewRendererProps,
  next: ViewRendererProps
): boolean {
  if (prev.viewId !== next.viewId) return false;
  if (prev.source !== next.source) return false;
  if (prev.sandboxUrl !== next.sandboxUrl) return false;
  if (prev.displayMode !== next.displayMode) return false;
  if (prev.cancelled !== next.cancelled) return false;
  if (prev.toolInput !== next.toolInput) return false;
  if (prev.toolOutput !== next.toolOutput) return false;
  if (prev.partialToolInput !== next.partialToolInput) return false;
  if (prev.customProps !== next.customProps) return false;
  if (prev.hostContext !== next.hostContext) return false;
  if (prev.hostCapabilities !== next.hostCapabilities) return false;
  if (prev.cspMode !== next.cspMode) return false;
  if (prev.className !== next.className) return false;
  if (prev.onReady !== next.onReady) return false;
  if (prev.onLifecycleChange !== next.onLifecycleChange) return false;
  return true;
}

export const ViewRenderer = memo(ViewRendererBase, viewRendererAreEqual);

export type { ViewRendererProps } from "./types.js";
export { resolveViewResource } from "./resolve-view-resource.js";
export {
  getViewResourceUri,
  isViewResource,
  isViewTool,
} from "./view-detection.js";
export { parseCustomProps } from "./parse-custom-props.js";
export { buildViewSandboxBlobUrl } from "./sandbox-blob-url.js";
export type {
  ViewConnection,
  ViewDisplayMode,
  ViewCspMode,
  ViewRendererSource,
  ResolvedViewResource,
  ViewCspViolation,
  ViewLifecycleEvent,
  ViewLifecycleStatus,
} from "./types.js";
export type {
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiResourceCsp,
  McpUiResourcePermissions,
} from "./ext-apps-bridge.js";
