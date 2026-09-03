import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiDownloadFileRequest,
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
  Tool,
  Transport,
} from "@modelcontextprotocol/client";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { parseCustomProps } from "./parse-custom-props.js";
import { injectOpenAiFileApis } from "./inject-openai-file-apis.js";
import { installInitializedSync } from "./initialized-sync.js";
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
import {
  assertAppCanCallTool,
  buildDefaultHostCapabilities,
  dispatchUiMessage,
  resolveRequestedDisplayMode,
} from "./view-host-policy.js";

const DEFAULT_HOST_INFO = { name: "mcp-use-client", version: "2.0.0" } as const;
const DEFAULT_TOOL_CALL_TIMEOUT = 600_000;
const SANDBOX_PROXY_READY = "ui/notifications/sandbox-proxy-ready";

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function waitForSandboxProxyReady(
  iframe: HTMLIFrameElement,
  options?: { signal?: AbortSignal }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", listener);
      options?.signal?.removeEventListener("abort", onAbort);
    };

    const listener = (event: MessageEvent) => {
      if (
        event.source === iframe.contentWindow &&
        event.data?.method === SANDBOX_PROXY_READY
      ) {
        cleanup();
        resolve();
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new Error("View sandbox initialization was aborted"));
    };

    if (options?.signal?.aborted) {
      onAbort();
      return;
    }
    options?.signal?.addEventListener("abort", onAbort, { once: true });

    window.addEventListener("message", listener);
  });
}

function buildToolResultPayload(
  toolOutput: unknown,
  customProps?: Record<string, string>
): Parameters<AppBridge["sendToolResult"]>[0] | null {
  const structuredContent = parseCustomProps(customProps);
  if (Object.keys(structuredContent).length > 0) {
    return {
      ...(typeof toolOutput === "object" && toolOutput !== null
        ? toolOutput
        : {}),
      structuredContent,
    } as Parameters<AppBridge["sendToolResult"]>[0];
  }
  if (toolOutput === undefined || toolOutput === null) return null;
  return toolOutput as Parameters<AppBridge["sendToolResult"]>[0];
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
  messageCapabilities,
  modelContextCapabilities,
  cspMode = "widget-declared",
  displayMode: displayModeProp,
  onDisplayModeChange,
  inlineMaxWidth = 768,
  chromeless,
  onMessage,
  onSamplingRequest,
  onDownloadFile,
  onAppToolsChanged,
  onModelContextUpdate,
  onLog,
  onReady,
  onLifecycleChange,
  onError,
  onCspViolation,
  onResourceResolved,
  wrapTransport,
  toolCallTimeout = DEFAULT_TOOL_CALL_TIMEOUT,
  mockOpenAiFileApis = false,
  onInlineHeightChange,
  fullscreenHeader,
  renderFullscreenClose,
  className,
  testId = "mcp-app-frame",
  invoking,
  invoked,
}: ViewRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingBlobRevocationsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const connectionRef = useRef(
    source.kind === "live" ? source.connection : null
  );

  const [resolved, setResolved] = useState<ResolvedViewResource | null>(null);
  const [activeSandboxUrl, setActiveSandboxUrl] = useState<URL | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initCount, setInitCount] = useState(0);
  const [inlineHeight, setInlineHeight] = useState<number>(
    VIEW_DIMENSIONS.DEFAULT_HEIGHT
  );
  const [internalDisplayMode, setInternalDisplayMode] =
    useState<ViewDisplayMode>("inline");
  const displayMode = displayModeProp ?? internalDisplayMode;
  const hasMessageHandler = onMessage !== undefined;
  const hasModelContextHandler = onModelContextUpdate !== undefined;
  const hasLogHandler = onLog !== undefined;
  const hasSamplingHandler = onSamplingRequest !== undefined;
  const hasDownloadHandler = onDownloadFile !== undefined;
  const effectiveHostCapabilities = useMemo<McpUiHostCapabilities>(
    () => ({
      ...buildDefaultHostCapabilities({
        hasConnection: source.kind === "live",
        hasMessageHandler,
        hasModelContextHandler,
        hasLogHandler,
        hasSamplingHandler,
        hasDownloadHandler,
        messageCapabilities,
        modelContextCapabilities,
      }),
      ...hostCapabilities,
    }),
    [
      hostCapabilities,
      hasLogHandler,
      hasSamplingHandler,
      hasDownloadHandler,
      hasMessageHandler,
      hasModelContextHandler,
      messageCapabilities,
      modelContextCapabilities,
      source.kind,
    ]
  );

  // Guest hostContext must track the shell's displayMode even when the parent
  // only uses ViewRenderer's internal state (e.g. inspector chat).
  const effectiveHostContext = useMemo(() => {
    if (!hostContext) return hostContext;
    if (hostContext.displayMode === displayMode) return hostContext;
    return { ...hostContext, displayMode };
  }, [hostContext, displayMode]);

  const hostContextRef = useRef(effectiveHostContext);
  hostContextRef.current = effectiveHostContext;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onSamplingRequestRef = useRef(onSamplingRequest);
  onSamplingRequestRef.current = onSamplingRequest;
  const onDownloadFileRef = useRef(onDownloadFile);
  onDownloadFileRef.current = onDownloadFile;
  const onAppToolsChangedRef = useRef(onAppToolsChanged);
  onAppToolsChangedRef.current = onAppToolsChanged;
  const toolInputRef = useRef(toolInput);
  toolInputRef.current = toolInput;
  const partialToolInputRef = useRef(partialToolInput);
  partialToolInputRef.current = partialToolInput;
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
  const onInlineHeightChangeRef = useRef(onInlineHeightChange);
  onInlineHeightChangeRef.current = onInlineHeightChange;
  const sandboxUrlRef = useRef(sandboxUrl);
  sandboxUrlRef.current = sandboxUrl;
  const cspModeRef = useRef(cspMode);
  cspModeRef.current = cspMode;
  const mockOpenAiFileApisRef = useRef(mockOpenAiFileApis);
  mockOpenAiFileApisRef.current = mockOpenAiFileApis;

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

  // Delay revocation so React StrictMode's development-only effect cleanup can
  // be cancelled by the matching setup before the iframe navigation commits.
  useEffect(() => {
    const url = activeSandboxUrl;
    if (!url || url.protocol !== "blob:") return;

    const pending = pendingBlobRevocationsRef.current.get(url.href);
    if (pending) {
      clearTimeout(pending);
      pendingBlobRevocationsRef.current.delete(url.href);
    }

    return () => {
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url.href);
        pendingBlobRevocationsRef.current.delete(url.href);
      }, 1_000);
      pendingBlobRevocationsRef.current.set(url.href, timer);
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

      if (event.data?.type === "iframe-console-log") {
        // Console records share the iframe postMessage channel with MCP Apps
        // JSON-RPC. Consume them before PostMessageTransport sees them.
        event.stopImmediatePropagation();
        onLogRef.current?.({
          level: event.data.level ?? "log",
          data: event.data.args,
        });
        return;
      }
    };

    window.addEventListener("message", handleMessage, true);
    return () => window.removeEventListener("message", handleMessage, true);
  }, [sandboxOrigin, isBlobSandbox]);

  // Bridge lifecycle: sandbox → connect → resource-ready → initialized
  useEffect(() => {
    if (!resolved || !activeSandboxUrl) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let disposed = false;
    let bridge: AppBridge | null = null;
    const abortController = new AbortController();

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

        if (activeSandboxUrl.protocol === "blob:") {
          const response = await fetch(activeSandboxUrl.href);
          const sandboxHtml = await response.text();
          if (disposed || abortController.signal.aborted) return;
          const readyPromise = waitForSandboxProxyReady(iframe, {
            signal: abortController.signal,
          });
          iframe.srcdoc = sandboxHtml;
          await readyPromise;
        } else {
          const readyPromise = waitForSandboxProxyReady(iframe, {
            signal: abortController.signal,
          });
          iframe.src = activeSandboxUrl.href;
          await readyPromise;
        }
        if (disposed || abortController.signal.aborted) return;

        const capabilities: McpUiHostCapabilities = {
          ...effectiveHostCapabilities,
          sandbox: {
            csp: cspMode === "permissive" ? undefined : resolved.csp,
            permissions: resolved.permissions,
          },
        };

        bridge = new AppBridge(null, hostInfo, capabilities, {
          hostContext: hostContextRef.current,
        });

        if (capabilities.message) {
          bridge.onmessage = async ({
            content,
          }: McpUiMessageRequest["params"]) => {
            await dispatchUiMessage(onMessageRef.current, content);
            return {};
          };
        }

        if (capabilities.sampling) {
          bridge.oncreatesamplingmessage = async (params) => {
            const handler = onSamplingRequestRef.current;
            if (!handler) {
              throw new Error("This host surface does not support sampling");
            }
            return handler(params);
          };
        }

        if (capabilities.downloadFile) {
          bridge.ondownloadfile = async (
            params: McpUiDownloadFileRequest["params"]
          ) => {
            const handler = onDownloadFileRef.current;
            if (!handler) {
              throw new Error("This host surface does not support downloads");
            }
            return handler(params);
          };
        }

        bridge.onopenlink = async ({ url }: McpUiOpenLinkRequest["params"]) => {
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          return {};
        };

        if (capabilities.serverTools) {
          bridge.oncalltool = (async ({
            name,
            arguments: args,
          }: CallToolRequest["params"]) => {
            const conn = connectionRef.current;
            if (!conn) throw new Error("Server connection not available");
            assertAppCanCallTool(conn.tools, name);
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
        }

        if (capabilities.serverResources) {
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
        }

        bridge.onrequestdisplaymode = async ({
          mode,
        }: McpUiRequestDisplayModeRequest["params"]) => {
          const requested = (mode ?? "inline") as ViewDisplayMode;
          const effective = resolveRequestedDisplayMode({
            requested,
            current: displayModeRef.current,
            hostAvailable: hostContextRef.current?.availableDisplayModes,
            appAvailable: bridge?.getAppCapabilities()?.availableDisplayModes,
          });
          await handleDisplayModeChangeRef.current(effective);
          return { mode: effective };
        };

        if (capabilities.updateModelContext) {
          bridge.onupdatemodelcontext = async ({
            content,
            structuredContent,
          }: McpUiUpdateModelContextRequest["params"]) => {
            if (!onModelContextUpdateRef.current) {
              throw new Error(
                "This host surface does not support model context updates"
              );
            }
            await onModelContextUpdateRef.current({
              content,
              structuredContent,
            });
            return {};
          };
        }

        if (capabilities.logging) {
          bridge.onloggingmessage = async ({
            level,
            data,
          }: LoggingMessageNotificationParams) => {
            onLogRef.current?.({ level, data });
            return {};
          };
        }

        bridge.onsizechange = async ({
          height,
        }: McpUiSizeChangedNotification["params"]) => {
          if (displayModeRef.current !== "inline") return;
          if (height !== undefined) {
            setInlineHeight(height);
            onInlineHeightChangeRef.current?.(height);
          }
        };

        let publishedAppToolsSignature: string | null = null;
        const publishAppTools = async () => {
          const handler = onAppToolsChangedRef.current;
          if (!bridge || !handler) return;
          const appCapabilities = bridge.getAppCapabilities();
          if (!appCapabilities?.tools) {
            handler(null);
            return;
          }
          const result = await bridge.listTools({});
          if (disposed || !bridge) return;
          const signature = JSON.stringify(result.tools);
          if (signature === publishedAppToolsSignature) return;
          publishedAppToolsSignature = signature;
          const currentBridge = bridge;
          handler({
            tools: result.tools as Tool[],
            callTool: (name, args) =>
              currentBridge.callTool({
                name,
                arguments: args ?? {},
              }),
          });
        };

        bridge.setNotificationHandler(
          "notifications/tools/list_changed",
          async () => {
            await publishAppTools();
          }
        );

        const syncGuestToolState = async () => {
          if (!bridge || disposed) return;

          const currentPartialToolInput = partialToolInputRef.current;
          const hasCompletedToolResult =
            toolOutputRef.current !== undefined &&
            toolOutputRef.current !== null;
          if (currentPartialToolInput && !hasCompletedToolResult) {
            await bridge.sendToolInputPartial({
              arguments: currentPartialToolInput,
            });
          } else {
            const mergedArgs = {
              ...toolInputRef.current,
              ...parseCustomProps(customPropsRef.current),
            };
            await bridge.sendToolInput({ arguments: mergedArgs });
          }

          const toolResultPayload = buildToolResultPayload(
            toolOutputRef.current,
            customPropsRef.current
          );
          if (toolResultPayload) {
            await bridge.sendToolResult(toolResultPayload);
          }
        };

        const initPromise = installInitializedSync(
          bridge,
          syncGuestToolState,
          (error) => {
            if (disposed) return;
            const message =
              error instanceof Error
                ? error.message
                : "Failed to synchronize view state";
            onErrorRef.current?.(message);
            onLifecycleChangeRef.current?.({
              status: "error",
              error: message,
            });
          }
        );
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
          html: mockOpenAiFileApisRef.current
            ? injectOpenAiFileApis(resolved.html)
            : resolved.html,
          csp: resolved.csp,
          permissions: resolved.permissions,
        });
        await initPromise;
        if (disposed) return;

        bridgeRef.current = bridge;
        setInitCount((c) => c + 1);
        onLifecycleChangeRef.current?.({ status: "initialized" });

        await publishAppTools();

        onLifecycleChangeRef.current?.({ status: "ready" });
      } catch (err) {
        if (!disposed && !abortController.signal.aborted) {
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
      abortController.abort();
      const toClose = bridge;
      bridgeRef.current = null;
      onAppToolsChangedRef.current?.(null);
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
    effectiveHostCapabilities,
    cspMode,
    viewId,
    wrapTransport,
    toolCallTimeout,
    mockOpenAiFileApis,
  ]);

  // Host context updates after init
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0 || !effectiveHostContext) return;
    void bridge.setHostContext(effectiveHostContext);
  }, [effectiveHostContext, initCount]);

  // Partial tool input
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (
      !bridge ||
      initCount === 0 ||
      !partialToolInput ||
      (toolOutput !== undefined && toolOutput !== null)
    ) {
      return;
    }
    void bridge.sendToolInputPartial({ arguments: partialToolInput });
  }, [initCount, partialToolInput, toolOutput]);

  // Tool input + custom props
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (
      !bridge ||
      initCount === 0 ||
      (partialToolInput && (toolOutput === undefined || toolOutput === null))
    ) {
      return;
    }
    const mergedArgs = {
      ...toolInput,
      ...parseCustomProps(customProps),
    };
    void bridge.sendToolInput({ arguments: mergedArgs });
  }, [initCount, toolInput, partialToolInput, customProps, toolOutput]);

  // Tool output
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0) return;
    const toolResultPayload = buildToolResultPayload(toolOutput, customProps);
    if (!toolResultPayload) return;
    void bridge.sendToolResult(toolResultPayload);
  }, [initCount, toolOutput, customProps]);

  // Cancellation
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || initCount === 0 || !cancelled) return;
    void bridge.sendToolCancelled({ reason: "Cancelled by user" });
  }, [cancelled, initCount]);

  const readyFiredRef = useRef(false);
  useEffect(() => {
    if (readyFiredRef.current || initCount === 0) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  }, [initCount]);

  const showHostBorder =
    resolved !== null && resolved.prefersBorder && displayMode !== "fullscreen";

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
      className={
        isFullscreen
          ? `${containerClassName} flex flex-col`
          : containerClassName
      }
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
      {isFullscreen && (
        // ponytail: inspector Tailwind may not emit client arbitrary classes
        // (h-[50px], grid-cols-[auto_1fr_auto]) — use inline layout instead.
        <header
          className="grid shrink-0 items-center border-b border-zinc-200 bg-background px-3 dark:border-zinc-700"
          style={{
            height: VIEW_DIMENSIONS.FULLSCREEN_HEADER_HEIGHT,
            gridTemplateColumns: "auto 1fr auto",
          }}
        >
          {renderFullscreenClose ? (
            renderFullscreenClose({
              onClick: () => void handleDisplayModeChange("inline"),
              "data-testid": "debugger-exit-fullscreen-button",
              "aria-label": "Exit fullscreen",
            })
          ) : (
            <button
              type="button"
              data-testid="debugger-exit-fullscreen-button"
              aria-label="Exit fullscreen"
              className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-zinc-200 bg-background text-foreground shadow-sm hover:bg-muted dark:border-zinc-700"
              onClick={() => void handleDisplayModeChange("inline")}
            >
              <CloseIcon />
            </button>
          )}
          <div className="flex min-w-0 items-center justify-center gap-2 px-2">
            {fullscreenHeader?.iconUrl ? (
              <img
                src={fullscreenHeader.iconUrl}
                alt=""
                className="size-6 shrink-0 rounded-md object-contain"
              />
            ) : null}
            <span className="truncate text-sm font-medium text-foreground">
              {fullscreenHeader?.title ?? toolName}
            </span>
          </div>
          <div className="size-8 shrink-0" aria-hidden />
        </header>
      )}
      {isPip &&
        (renderFullscreenClose ? (
          <div className="absolute right-3 top-3" style={{ zIndex: 110 }}>
            {renderFullscreenClose({
              onClick: () => void handleDisplayModeChange("inline"),
              "data-testid": "debugger-exit-pip-button",
              "aria-label": "Exit picture-in-picture",
            })}
          </div>
        ) : (
          <button
            type="button"
            data-testid="debugger-exit-pip-button"
            aria-label="Exit picture-in-picture"
            className="absolute right-3 top-3 z-[110] flex size-8 cursor-pointer items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-background"
            style={{ zIndex: 110 }}
            onClick={() => void handleDisplayModeChange("inline")}
          >
            <CloseIcon />
          </button>
        ))}
      <div
        className={
          isFullscreen
            ? "relative flex min-h-0 w-full flex-1 flex-col"
            : isPip
              ? "relative w-full h-full min-h-0 flex flex-1 flex-col"
              : "relative w-full flex flex-1 justify-center items-center"
        }
      >
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
            className={
              showHostBorder
                ? "w-full h-full bg-transparent border border-border rounded-xl"
                : "w-full h-full bg-transparent border-0"
            }
          />
        </div>
      </div>
    </div>
  );

  // ponytail: do not portal — moving the shell remounts the iframe and wipes
  // the guest. Chat history chrome hides via data-mcp-widget-fullscreen instead.
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
  if (prev.messageCapabilities !== next.messageCapabilities) return false;
  if (prev.modelContextCapabilities !== next.modelContextCapabilities)
    return false;
  if (prev.onMessage !== next.onMessage) return false;
  if (prev.onSamplingRequest !== next.onSamplingRequest) return false;
  if (prev.onDownloadFile !== next.onDownloadFile) return false;
  if (prev.onAppToolsChanged !== next.onAppToolsChanged) return false;
  if (prev.onModelContextUpdate !== next.onModelContextUpdate) return false;
  if (prev.cspMode !== next.cspMode) return false;
  if (prev.mockOpenAiFileApis !== next.mockOpenAiFileApis) return false;
  if (prev.onInlineHeightChange !== next.onInlineHeightChange) return false;
  if (prev.fullscreenHeader !== next.fullscreenHeader) return false;
  if (prev.renderFullscreenClose !== next.renderFullscreenClose) return false;
  if (prev.className !== next.className) return false;
  if (prev.onReady !== next.onReady) return false;
  if (prev.onLifecycleChange !== next.onLifecycleChange) return false;
  return true;
}

/**
 * Renders an MCP App inside an isolated iframe and bridges host capabilities.
 *
 * The renderer resolves live MCP resources or accepts preloaded HTML, applies
 * the selected CSP policy, and forwards tool state and host callbacks through
 * the MCP Apps bridge.
 */
export const ViewRenderer = memo(ViewRendererBase, viewRendererAreEqual);

export type { ViewRendererProps } from "./types.js";
export { resolveViewResource } from "./resolve-view-resource.js";
export {
  getViewResourceUri,
  isViewResource,
  isViewTool,
} from "./view-detection.js";
export { isToolVisibleToModel } from "./view-host-policy.js";
export { parseCustomProps } from "./parse-custom-props.js";
export {
  buildSandboxProxyBlobHtml,
  buildViewSandboxBlobUrl,
  buildViewSandboxUrl,
} from "./sandbox-blob-url.js";
export type {
  ViewConnection,
  ViewDisplayMode,
  ViewCspMode,
  ViewRendererSource,
  ResolvedViewResource,
  ViewCspViolation,
  ViewLifecycleEvent,
  ViewLifecycleStatus,
  ViewAppToolConnection,
} from "./types.js";
export type {
  McpUiDownloadFileRequest,
  McpUiDownloadFileResult,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiResourceCsp,
  McpUiResourcePermissions,
  McpUiSupportedContentBlockModalities,
} from "./ext-apps-bridge.js";
