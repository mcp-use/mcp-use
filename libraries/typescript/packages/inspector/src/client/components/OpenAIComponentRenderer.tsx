import { cn } from "@/client/lib/utils";
import { TextShimmer } from "@/client/components/ui/text-shimmer";
import { X } from "lucide-react";
import { useMcpClient } from "mcp-use/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { MCP_APPS_CONFIG } from "../constants/mcp-apps";
import { IFRAME_SANDBOX_PERMISSIONS } from "../constants/iframe";
import { useTheme } from "../context/ThemeContext";
import { useWidgetDebug } from "../context/WidgetDebugContext";
import { injectConsoleInterceptor } from "../utils/iframeConsoleInterceptor";
import { FullscreenNavbar } from "./FullscreenNavbar";
import { MCPAppsDebugControls } from "./MCPAppsDebugControls";
import { Spinner } from "./ui/spinner";

interface OpenAIComponentRendererProps {
  componentUrl: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: any;
  serverId: string;
  readResource: (uri: string) => Promise<any>;
  className?: string;
  noWrapper?: boolean;
  showConsole?: boolean;
  customProps?: Record<string, string>;
  /** When provided, used directly instead of looking up via useMcpClient().
   *  This avoids the dependency on McpClientProvider context. */
  serverBaseUrl?: string;
  /** Status text shown while the tool is running (shimmer). Shown when toolResult is null. */
  invoking?: string;
  /** Status text shown after the tool completes (static muted). Shown when toolResult is present. */
  invoked?: string;
  onUpdateGlobals?: (updates: {
    displayMode?: "inline" | "pip" | "fullscreen";
    theme?: "light" | "dark";
    maxHeight?: number;
    locale?: string;
    safeArea?: {
      insets: { top: number; bottom: number; left: number; right: number };
    };
    userAgent?: any;
  }) => void;
}

type IframeGlobalUpdates = {
  displayMode?: "inline" | "pip" | "fullscreen";
  theme?: "light" | "dark";
  maxHeight?: number;
  locale?: string;
  safeArea?: {
    insets: { top: number; bottom: number; left: number; right: number };
  };
  userAgent?: any;
  toolOutput?: any;
  toolResponseMetadata?: any;
};

function Wrapper({
  children,
  className,
  noWrapper,
}: {
  children: React.ReactNode;
  className?: string;
  noWrapper?: boolean;
}) {
  if (noWrapper) {
    return children;
  }
  return (
    <div
      className={cn(
        "bg-zinc-100 dark:bg-zinc-900 bg-[radial-gradient(circle,_rgba(0,0,0,0.2)_1px,_transparent_1px)] dark:bg-[radial-gradient(circle,_rgba(255,255,255,0.2)_1px,_transparent_1px)] bg-[length:32px_32px]",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Render an OpenAI Apps SDK component inside an iframe and provide a host ↔ iframe OpenAI API bridge.
 *
 * Manages widget lifecycle, resource storage, sizing and centering, theme syncing, display modes (inline / pip / fullscreen),
 * postMessage handling for tool calls and followups, and optional console/inspector controls.
 *
 * @param componentUrl - URI of the widget/resource to load into the iframe
 * @param serverId - MCP server identifier used to resolve server connection and dev proxy URLs
 * @param readResource - Function to fetch resource data (HTML) for the provided `componentUrl`
 * @param noWrapper - When true, do not render the default background wrapper around the iframe
 * @param showConsole - When true and same-origin, show the iframe console and inspector controls
 * @returns The rendered React element tree that embeds and manages the OpenAI App widget
 */
function OpenAIComponentRendererBase({
  componentUrl,
  toolName,
  toolArgs,
  toolResult,
  serverId,
  readResource,
  className,
  noWrapper = false,
  showConsole = true,
  customProps,
  serverBaseUrl: serverBaseUrlProp,
  invoking,
  invoked,
  onUpdateGlobals,
}: OpenAIComponentRendererProps) {
  const iframeRef = useRef<InstanceType<
    typeof window.HTMLIFrameElement
  > | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const hasLoadedOnceRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);

  const [iframeHeight, setIframeHeight] = useState<number>(400);
  const lastMeasuredHeightRef = useRef<number>(0);
  const lastNotifiedHeightRef = useRef<number>(0);
  const useNotifiedHeightRef = useRef<boolean>(false); // Flag to prefer notified height over automatic measurement
  const [centerVertically, setCenterVertically] = useState<boolean>(false);
  const [displayMode, setDisplayMode] = useState<
    "inline" | "pip" | "fullscreen"
  >("inline");
  const [isSameOrigin, setIsSameOrigin] = useState<boolean>(false);
  const [isPipHovered, setIsPipHovered] = useState<boolean>(false);
  const [useDevMode, setUseDevMode] = useState<boolean>(false);
  const [widgetToolInput, setWidgetToolInput] = useState<any>(null);
  const [_widgetToolOutput, setWidgetToolOutput] = useState<any>(null);
  const pendingGlobalUpdatesRef = useRef<IframeGlobalUpdates | null>(null);
  const flushGlobalsRafRef = useRef<number | null>(null);
  const batchedGlobalsRef = useRef<IframeGlobalUpdates | null>(null);
  const batchScheduledRef = useRef<boolean>(false);
  const lastSentToolOutputKeyRef = useRef<string | null>(null);

  // Generate unique tool ID
  const toolIdRef = useRef(
    `tool-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );
  const toolId = toolIdRef.current;
  const hasSetWidgetUrlRef = useRef(false);

  // Always call useMcpClient() to satisfy React's hooks-rules-of-order.
  // Prefer the explicit serverBaseUrl prop when provided (e.g. when embedded
  // outside the inspector's own McpClientProvider).
  const { servers } = useMcpClient();
  const server = servers.find((connection) => connection.id === serverId);
  const serverBaseUrl = serverBaseUrlProp ?? server?.url;
  const { resolvedTheme } = useTheme();
  const { playground, addWidget, addCspViolation } = useWidgetDebug();

  // Refs to hold latest values without triggering effect re-runs
  // This prevents infinite loops caused by object/function reference changes
  const toolArgsRef = useRef(toolArgs);
  const toolResultRef = useRef(toolResult);
  const readResourceRef = useRef(readResource);
  const serverBaseUrlRef = useRef(serverBaseUrl);
  const resolvedThemeRef = useRef(resolvedTheme);
  const customPropsRef = useRef(customProps);

  // Keep refs updated with latest values
  useEffect(() => {
    toolArgsRef.current = toolArgs;
    toolResultRef.current = toolResult;
    readResourceRef.current = readResource;
    serverBaseUrlRef.current = serverBaseUrl;
    resolvedThemeRef.current = resolvedTheme;
    customPropsRef.current = customProps;
  });

  // Store widget data and set up iframe URL
  useEffect(() => {
    let cancelled = false;

    const storeAndSetUrl = async () => {
      // Access latest values from refs to avoid stale closures
      const currentToolResult = toolResultRef.current;
      const currentReadResource = readResourceRef.current;
      const currentResolvedTheme = resolvedThemeRef.current;
      // Capture playground from closure at effect run time
      const currentPlayground = playground;

      console.log(
        "[OpenAIComponentRenderer] Storing widget data with playground:",
        {
          locale: currentPlayground.locale,
          deviceType: currentPlayground.deviceType,
        }
      );

      try {
        // Extract structured content from tool result (the actual tool parameters).
        // Default to {} (not null) so window.openai.toolOutput is non-null in the
        // iframe HTML — this prevents useWidget isPending from staying true when the
        // tool result arrives after the iframe loads.
        const structuredContent = currentToolResult
          ? (currentToolResult.structuredContent ?? {})
          : null;

        // Fetch the HTML resource client-side (where the connection exists)
        const resourceData = await currentReadResource(componentUrl);
        if (cancelled) return;

        // Extract CSP metadata - check tool result first, then resource (where appsSdkMetadata lives)
        // The CSP is typically in the resource's _meta (set via appsSdkMetadata), not the tool result's _meta
        let widgetCSP = null;
        if (currentToolResult?._meta?.["openai/widgetCSP"]) {
          widgetCSP = currentToolResult._meta["openai/widgetCSP"];
        } else if (resourceData?.contents?.[0]?._meta?.["openai/widgetCSP"]) {
          widgetCSP = resourceData.contents[0]._meta["openai/widgetCSP"];
        }

        // Re-read refs right before building finalToolInput so we use the latest
        // values (avoids race where toolArgs was empty at effect start but
        // populated by the time we reach here, e.g. when toolResult arrives).
        const latestToolArgs = toolArgsRef.current;
        const latestCustomProps = customPropsRef.current;
        const finalToolInput = {
          ...(latestToolArgs || {}),
          ...(latestCustomProps || {}),
        };

        // Prepare widget data for storage
        const widgetDataToStore: any = {
          serverId,
          uri: componentUrl,
          toolInput: finalToolInput,
          toolOutput: structuredContent,
          toolResponseMetadata: null,
          resourceData,
          toolId,
          widgetCSP,
          theme: currentResolvedTheme,
          playground: {
            locale: currentPlayground.locale,
            deviceType: currentPlayground.deviceType,
            capabilities: currentPlayground.capabilities,
            safeAreaInsets: currentPlayground.safeAreaInsets,
          },
        };

        // Inspector API routes (/inspector/api/*) are always served by the same
        // origin that hosts the inspector UI.  Use relative URLs so fetch targets
        // window.location.origin (the inspector) instead of the MCP server.
        // The previous logic mistakenly derived the base from the MCP server URL
        // (serverBaseUrl), which broke when the server ran on a different port.
        const inspectorApiBase = "";

        // Store widget data on server (including the fetched HTML and dev URLs if applicable)
        const storeResponse = await fetch(
          `${inspectorApiBase}/inspector/api/resources/widget/store`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(widgetDataToStore),
          }
        );

        if (!storeResponse.ok) {
          const errorData = await storeResponse
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(
            `Failed to store widget data: ${errorData.error || storeResponse.statusText}`
          );
        }

        if (cancelled) return;

        // Determine if the widget iframe will be same-origin with the inspector page.
        // When inspectorApiBase matches window.location.origin (e.g. both http://localhost:3000),
        // the iframe is same-origin and we can access its DOM for console interception & debug controls.
        const computedIsSameOrigin = inspectorApiBase
          ? typeof window !== "undefined" &&
            inspectorApiBase === window.location.origin
          : true;

        // Batch all state updates in one synchronous block so React 18 batches a single re-render.
        // Avoids double application from StrictMode (cancelled guard above) and multiple
        // setState across await boundaries.
        setWidgetToolInput(finalToolInput);
        setWidgetToolOutput(structuredContent);
        setUseDevMode(false);
        // Only set widget URL on first run; subsequent runs (e.g. toolResult arrives) just update
        // the store so that iframe fetch gets latest data. Changing URL would reload the iframe.
        if (!hasSetWidgetUrlRef.current) {
          hasSetWidgetUrlRef.current = true;
          const widgetUrl = `${inspectorApiBase}/inspector/api/resources/widget-content/${toolId}?t=${Date.now()}`;
          setWidgetUrl(widgetUrl);
          // Register widget in debug context so CSP violations can be stored
          addWidget(toolId, { toolName, protocol: "chatgpt-app" });
        }
        setIsSameOrigin(computedIsSameOrigin);
      } catch (error) {
        if (cancelled) return;
        console.error("Error storing widget data:", error);
        setError(
          error instanceof Error ? error.message : "Failed to prepare widget"
        );
      }
    };

    storeAndSetUrl();
    return () => {
      cancelled = true;
    };
  }, [
    componentUrl,
    serverId,
    toolId,
    customProps,
    // Re-run when toolArgs materially change (e.g., from empty to populated when streaming).
    JSON.stringify(toolArgs),
    // Re-run when toolResult arrives so store has latest data before iframe fetches.
    // For fast tools, result may arrive before iframe loads — storing early avoids race.
    // toolResult._meta is updated via updateIframeGlobals() without re-storing.
    toolResult,
  ]);

  // Helper to update window.openai globals inside iframe.
  // Batches multiple synchronous calls (e.g. tool result + theme effects) into
  // one apply + one event dispatch to avoid double renders.
  const updateIframeGlobals = useCallback(
    (updates: IframeGlobalUpdates) => {
      batchedGlobalsRef.current = {
        ...(batchedGlobalsRef.current || {}),
        ...updates,
      };

      if (!iframeRef.current?.contentWindow) {
        if (onUpdateGlobals) onUpdateGlobals(updates);
        return;
      }

      if (batchScheduledRef.current) return;
      batchScheduledRef.current = true;

      queueMicrotask(() => {
        batchScheduledRef.current = false;
        const merged = batchedGlobalsRef.current;
        batchedGlobalsRef.current = null;
        if (!merged) return;

        const scheduleFlushWhenOpenAiAvailable = () => {
          if (flushGlobalsRafRef.current !== null) return;
          let attempts = 0;
          const tryFlush = () => {
            const iframeWindow = iframeRef.current?.contentWindow;
            const pending = pendingGlobalUpdatesRef.current;
            if (!iframeWindow || !pending) {
              flushGlobalsRafRef.current = null;
              return;
            }
            if (iframeWindow.openai) {
              pendingGlobalUpdatesRef.current = null;
              flushGlobalsRafRef.current = null;
              updateIframeGlobals(pending);
              return;
            }
            attempts += 1;
            if (attempts >= 60) {
              flushGlobalsRafRef.current = null;
              return;
            }
            flushGlobalsRafRef.current = window.requestAnimationFrame(tryFlush);
          };
          flushGlobalsRafRef.current = window.requestAnimationFrame(tryFlush);
        };

        try {
          const iframeWindow = iframeRef.current?.contentWindow;
          const iframeDocument = iframeRef.current?.contentDocument;
          if (!iframeWindow) return;

          if (merged.theme !== undefined && iframeDocument) {
            const htmlElement = iframeDocument.documentElement;
            htmlElement.setAttribute("data-theme", merged.theme);
            htmlElement.style.colorScheme = merged.theme;
            htmlElement.classList.remove("light", "dark");
            htmlElement.classList.add(merged.theme);
          }

          if (iframeWindow.openai) {
            // Skip redundant dispatch only when updates are exclusively theme/displayMode
            // and those already match. Must NOT skip when locale, userAgent, safeArea,
            // maxHeight, or toolOutput need to be applied (debug toggles, etc.).
            const hasHostContextUpdates =
              merged.locale !== undefined ||
              merged.safeArea !== undefined ||
              merged.userAgent !== undefined ||
              merged.maxHeight !== undefined ||
              merged.toolOutput !== undefined ||
              merged.toolResponseMetadata !== undefined;

            if (!hasHostContextUpdates) {
              const themeMatch =
                merged.theme === undefined ||
                iframeWindow.openai.theme === merged.theme;
              const displayModeMatch =
                merged.displayMode === undefined ||
                iframeWindow.openai.displayMode === merged.displayMode;
              if (themeMatch && displayModeMatch) return;
            }
            if (merged.displayMode !== undefined)
              iframeWindow.openai.displayMode = merged.displayMode;
            if (merged.theme !== undefined)
              iframeWindow.openai.theme = merged.theme;
            if (merged.maxHeight !== undefined)
              iframeWindow.openai.maxHeight = merged.maxHeight;
            if (merged.locale !== undefined)
              iframeWindow.openai.locale = merged.locale;
            if (merged.safeArea !== undefined)
              iframeWindow.openai.safeArea = merged.safeArea;
            if (merged.userAgent !== undefined)
              iframeWindow.openai.userAgent = merged.userAgent;
            if (merged.toolOutput !== undefined)
              iframeWindow.openai.toolOutput = merged.toolOutput;
            if (merged.toolResponseMetadata !== undefined)
              iframeWindow.openai.toolResponseMetadata =
                merged.toolResponseMetadata;

            try {
              const ev = new (iframeWindow as any).CustomEvent(
                "openai:set_globals",
                { detail: { globals: { ...iframeWindow.openai } } }
              );
              iframeWindow.dispatchEvent(ev);
            } catch {
              iframeWindow.postMessage(
                { type: "openai:globalsChanged", updates: merged },
                "*"
              );
            }
          } else {
            pendingGlobalUpdatesRef.current = {
              ...(pendingGlobalUpdatesRef.current || {}),
              ...merged,
            };
            scheduleFlushWhenOpenAiAvailable();
          }

          if (onUpdateGlobals) onUpdateGlobals(merged);
        } catch {
          const cw = iframeRef.current?.contentWindow;
          if (cw) {
            cw.postMessage(
              { type: "openai:globalsChanged", updates: merged },
              "*"
            );
          }
          if (onUpdateGlobals) onUpdateGlobals(merged);
        }
      });
    },
    [onUpdateGlobals]
  );

  useEffect(() => {
    return () => {
      if (flushGlobalsRafRef.current !== null) {
        window.cancelAnimationFrame(flushGlobalsRafRef.current);
        flushGlobalsRafRef.current = null;
      }
    };
  }, []);

  // Update widget when tool result changes (Issue #930 fix)
  // This allows widgets to transition from isPending=true to isPending=false
  useEffect(() => {
    if (!toolResult || !isReady || !iframeRef.current?.contentWindow) return;

    const structuredContent = toolResult?.structuredContent || toolResult;
    const metadata = toolResult?._meta || null;
    const contentKey = JSON.stringify(structuredContent);

    // Skip if we already sent this exact toolOutput (parent may re-render with new ref, same data)
    if (lastSentToolOutputKeyRef.current === contentKey) return;
    lastSentToolOutputKeyRef.current = contentKey;

    updateIframeGlobals({
      toolOutput: structuredContent,
      toolResponseMetadata: metadata,
    });
  }, [toolResult, isReady, updateIframeGlobals]);

  // Handle display mode changes with native Fullscreen API
  const handleDisplayModeChange = useCallback(
    async (mode: "inline" | "pip" | "fullscreen") => {
      try {
        if (mode === "fullscreen") {
          // Enter fullscreen
          if (document.fullscreenElement) {
            // Already in fullscreen, just update state
            setDisplayMode(mode);
            updateIframeGlobals({ displayMode: mode });
            return;
          }

          if (containerRef.current) {
            await containerRef.current.requestFullscreen();
            setDisplayMode(mode);
            updateIframeGlobals({ displayMode: mode });
            console.log("[OpenAIComponentRenderer] Entered fullscreen");
          }
        } else {
          // Exit fullscreen
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          }
          setDisplayMode(mode);
          updateIframeGlobals({ displayMode: mode });
          console.log("[OpenAIComponentRenderer] Exited fullscreen");
        }
      } catch (err) {
        console.error("[OpenAIComponentRenderer] Fullscreen error:", err);
        // Fallback to CSS-based fullscreen if native API fails
        setDisplayMode(mode);
        updateIframeGlobals({ displayMode: mode });
      }
    },
    [updateIframeGlobals]
  );

  // Handle postMessage communication with iframe
  useEffect(() => {
    if (!widgetUrl) return;

    // Reset readiness whenever we load a new widget URL.
    // Only show skeleton on first load, not on prop updates
    setIsReady(false);
    if (!hasLoadedOnceRef.current) {
      setShowSkeleton(true);
    }
    setError(null);

    let hasHandledLoad = false;

    const handleMessage = async (event: any) => {
      // Only accept messages from our iframe
      if (
        !iframeRef.current ||
        event.source !== iframeRef.current.contentWindow
      ) {
        return;
      }

      // Messages are handled silently unless there's an error

      // Let console log messages pass through (handled by useIframeConsole hook)
      if (event.data?.type === "iframe-console-log") {
        const isErrorLevel = event.data.level === "error";
        if (isErrorLevel) {
          const args = Array.isArray(event.data.args) ? event.data.args : [];
          const first = args[0];
          const extractedMessage =
            typeof first === "string"
              ? first
              : typeof first?.message === "string"
                ? first.message
                : "Widget runtime error";
          const extractedStack =
            typeof first?.error?.stack === "string"
              ? first.error.stack
              : typeof first?.stack === "string"
                ? first.stack
                : undefined;
          if (typeof window !== "undefined" && window.parent !== window) {
            window.parent.postMessage(
              {
                type: "mcp-inspector:widget:error",
                source: "iframe-console:error",
                message: extractedMessage,
                stack: extractedStack,
                timestamp: Date.now(),
                url:
                  typeof event.data.url === "string"
                    ? event.data.url
                    : undefined,
                toolId,
              },
              "*"
            );
          }
        }
        return;
      }

      // Handle widget state requests from inspector
      if (event.data?.type === "mcp-inspector:getWidgetState") {
        try {
          const iframeWindow = iframeRef.current?.contentWindow;
          if (iframeWindow?.openai?.widgetState !== undefined) {
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "mcp-inspector:widgetStateResponse",
                toolId: event.data.toolId,
                state: iframeWindow.openai.widgetState,
              },
              "*"
            );
          }
        } catch (e) {
          // Cross-origin or not accessible
        }
        return;
      }

      switch (event.data.type) {
        case "openai:csp-violation":
          addCspViolation(toolId, {
            directive: event.data.directive,
            effectiveDirective: event.data.effectiveDirective,
            blockedUri: event.data.blockedUri,
            sourceFile: event.data.sourceFile,
            lineNumber: event.data.lineNumber,
            columnNumber: event.data.columnNumber,
            timestamp: event.data.timestamp || Date.now(),
          });
          break;

        case "openai:setWidgetState":
          try {
            // Widget state is already handled by the server-injected script
            // This is just for parent-level awareness if needed
          } catch (err) {
            console.error(
              "[OpenAIComponentRenderer] Failed to handle widget state:",
              err
            );
          }
          break;

        case "openai:callTool":
          try {
            if (!server) {
              throw new Error("Server connection not available");
            }

            const { toolName, params, requestId } = event.data;

            // Call the tool via the MCP connection
            // Use a 10 minute timeout for tool calls, as tools may trigger sampling
            const result = await server.callTool(toolName, params || {}, {
              timeout: 600000, // 10 minutes
              resetTimeoutOnProgress: true,
            });

            // Format the result to match OpenAI's expected format
            // MCP tools return { contents: [...] }, we need to convert to OpenAI format
            let formattedResult: any;
            if (result && typeof result === "object") {
              if (Array.isArray(result.contents)) {
                formattedResult = {
                  content: result.contents.map((content: any) => {
                    if (typeof content === "string") {
                      return { type: "text", text: content };
                    }
                    if (content.type === "text" && content.text) {
                      return { type: "text", text: content.text };
                    }
                    if (content.type === "image" && content.data) {
                      return {
                        type: "image",
                        image_url: { url: content.data },
                      };
                    }
                    return { type: "text", text: JSON.stringify(content) };
                  }),
                };
              } else {
                // If it's already in the right format or a simple object
                formattedResult = {
                  content: [
                    {
                      type: "text",
                      text:
                        typeof result === "string"
                          ? result
                          : JSON.stringify(result),
                    },
                  ],
                };
              }
            } else {
              formattedResult = {
                content: [
                  {
                    type: "text",
                    text: String(result),
                  },
                ],
              };
            }

            // Send success response back to iframe
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "openai:callTool:response",
                requestId,
                result: formattedResult,
              },
              "*"
            );
          } catch (err: any) {
            console.error("[OpenAIComponentRenderer] Tool call error:", err);
            // Send error response back to iframe
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "openai:callTool:response",
                requestId: event.data.requestId,
                error: err instanceof Error ? err.message : String(err),
              },
              "*"
            );
          }
          break;

        case "openai:sendFollowup":
          try {
            const { message } = event.data;
            const prompt =
              typeof message === "string"
                ? message
                : message?.prompt || message;

            if (!prompt) {
              console.warn(
                "[OpenAIComponentRenderer] No prompt in followup message"
              );
              return;
            }

            // Dispatch a custom event that the chat component can listen to
            const followUpEvent = new window.CustomEvent(
              "mcp-inspector:widget-followup",
              {
                detail: { prompt, serverId },
              }
            );
            window.dispatchEvent(followUpEvent);

            // Also try to store in localStorage as a fallback
            // The chat component can check for this
            try {
              const followUpMessages = JSON.parse(
                localStorage.getItem("mcp-inspector-pending-followups") || "[]"
              );
              followUpMessages.push({
                prompt,
                serverId,
                timestamp: Date.now(),
              });
              localStorage.setItem(
                "mcp-inspector-pending-followups",
                JSON.stringify(followUpMessages.slice(-10)) // Keep last 10
              );
            } catch (e) {
              // Ignore localStorage errors
            }
          } catch (err) {
            console.error(
              "[OpenAIComponentRenderer] Failed to send followup:",
              err
            );
          }
          break;

        case "openai:requestDisplayMode":
          try {
            const { mode } = event.data;
            if (mode && ["inline", "pip", "fullscreen"].includes(mode)) {
              await handleDisplayModeChange(mode);
            }
          } catch (err) {
            console.error(
              "[OpenAIComponentRenderer] Failed to change display mode:",
              err
            );
          }
          break;

        case "openai:notifyIntrinsicHeight":
          try {
            const { height } = event.data;
            if (typeof height === "number" && height > 0) {
              // For inline mode, respect the requested height (allow scrolling if needed)
              // For fullscreen/pip modes, cap at viewport
              let newHeight = height;
              if (displayMode === "fullscreen" || displayMode === "pip") {
                const maxHeight =
                  typeof window !== "undefined" ? window.innerHeight : height;
                newHeight = Math.min(height, maxHeight);
              }
              // Always update if the requested height is different from what we last applied
              // This ensures we update even if we cap it (so widget knows the actual applied height)
              if (
                height !== lastNotifiedHeightRef.current ||
                newHeight !== iframeHeight
              ) {
                lastNotifiedHeightRef.current = height; // Track requested height from notifyIntrinsicHeight
                lastMeasuredHeightRef.current = newHeight; // Track applied height
                useNotifiedHeightRef.current = true; // Use notified height instead of automatic measurement
                setIframeHeight(newHeight);
              }
            }
          } catch (err) {
            console.error(
              "[OpenAIComponentRenderer] Failed to handle intrinsic height notification:",
              err
            );
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    const handleLoad = () => {
      if (hasHandledLoad) {
        return;
      }
      hasHandledLoad = true;
      setIsReady(true);
      setError(null);
      // Inject console interceptor after iframe loads (only for same-origin)
      if (iframeRef.current) {
        // Double-check same-origin by trying to access contentDocument
        try {
          const canAccess = !!iframeRef.current.contentDocument;
          if (canAccess && isSameOrigin) {
            injectConsoleInterceptor(iframeRef.current);
          } else if (!canAccess) {
            // Cross-origin iframe detected - update state
            setIsSameOrigin(false);
          }
        } catch (e) {
          // Cross-origin iframe - cannot access
          setIsSameOrigin(false);
        }
      }
      // Update theme when iframe loads to ensure correct initial theme
      // Use a small delay to ensure window.openai is fully initialized
      if (resolvedTheme) {
        setTimeout(() => {
          updateIframeGlobals({ theme: resolvedTheme });
        }, 50);
      }
    };

    const handleError = () => {
      setError("Failed to load component");
    };

    const iframe = iframeRef.current;
    iframe?.addEventListener("load", handleLoad);
    iframe?.addEventListener("error", handleError);

    // Handle the race where the iframe finishes loading before listeners are attached.
    // In that case, "load" won't fire again and the widget can stay pending forever.
    // Guard: only treat as loaded if the document has actual content (scripts).
    // A stale about:blank or empty document should not trigger handleLoad.
    if (
      iframe &&
      (iframe.contentDocument?.readyState === "complete" ||
        iframe.contentDocument?.readyState === "interactive") &&
      (iframe.contentDocument?.querySelectorAll("script").length ?? 0) > 0
    ) {
      handleLoad();
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      iframe?.removeEventListener("load", handleLoad);
      iframe?.removeEventListener("error", handleError);
    };
  }, [
    widgetUrl,
    isSameOrigin,
    handleDisplayModeChange,
    server,
    serverId,
    resolvedTheme,
    updateIframeGlobals,
    useDevMode,
  ]);

  // Sync theme changes to iframe's color-scheme for light-dark() CSS function
  // OpenAI Apps SDK UI uses [data-theme] attribute to set color-scheme via CSS
  // This ensures design tokens adapt to dark mode
  useEffect(() => {
    if (!isReady) return;
    // For cross-origin iframes, use postMessage only (no direct DOM access)
    if (!isSameOrigin) {
      updateIframeGlobals({ theme: resolvedTheme });
      return;
    }
    try {
      if (!iframeRef.current?.contentDocument) return;
      const iframeDoc = iframeRef.current.contentDocument;
      const htmlElement = iframeDoc.documentElement;
      // Set data-theme attribute (used by OpenAI Apps SDK UI CSS)
      htmlElement.setAttribute("data-theme", resolvedTheme);
      // Also set inline style as fallback
      htmlElement.style.colorScheme = resolvedTheme;
      // Add theme as a class for Tailwind dark mode (class-based strategy)
      htmlElement.classList.remove("light", "dark");
      htmlElement.classList.add(resolvedTheme);
    } catch {
      // Cross-origin access denied — fall through to postMessage
    }
    updateIframeGlobals({ theme: resolvedTheme });
  }, [resolvedTheme, isReady, isSameOrigin, updateIframeGlobals]);

  // Hide skeleton once the iframe has loaded real content.
  // The readyState guard in the load handler already ensures we only set
  // isReady when the iframe has actual scripts (not a stale blank document),
  // so no additional delay is needed.
  useEffect(() => {
    if (!isReady || !showSkeleton) {
      return;
    }
    setShowSkeleton(false);
    hasLoadedOnceRef.current = true;
  }, [isReady, showSkeleton]);

  // Dynamically resize iframe height to its content, capped at 100vh
  // Only works for same-origin iframes; cross-origin iframes rely on
  // notifyIntrinsicHeight() postMessage from the widget.
  useEffect(() => {
    if (!widgetUrl || !isSameOrigin) return;

    const measure = () => {
      // Skip automatic measurement if widget is using notifyIntrinsicHeight
      if (useNotifiedHeightRef.current) {
        return;
      }

      const iframe = iframeRef.current;
      try {
        const contentDoc = iframe?.contentWindow?.document;
        const body = contentDoc?.body;
        if (!iframe || !body) return;

        const contentHeight = body.scrollHeight || 0;
        const maxHeight =
          typeof window !== "undefined" ? window.innerHeight : contentHeight;
        const newHeight = Math.min(contentHeight, maxHeight);
        if (newHeight > 0 && newHeight !== lastMeasuredHeightRef.current) {
          lastMeasuredHeightRef.current = newHeight;
          setIframeHeight(newHeight);
        }
      } catch {
        // Cross-origin access denied — skip measurement
      }
    };

    let rafId: number;
    const tick = () => {
      measure();
      rafId = window.requestAnimationFrame(tick);
    };
    tick();

    window.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", measure);
    };
  }, [widgetUrl, isSameOrigin]);

  // Determine if we should vertically center (only when container height > iframe height)
  useEffect(() => {
    const evaluateCentering = () => {
      const container = containerRef.current;
      if (!container) return;
      const containerHeight = container.clientHeight;
      setCenterVertically(containerHeight > iframeHeight);
    };

    evaluateCentering();
    window.addEventListener("resize", evaluateCentering);
    return () => {
      window.removeEventListener("resize", evaluateCentering);
    };
  }, [iframeHeight]);

  // Listen for fullscreen changes to sync state
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && displayMode === "fullscreen") {
        // User exited fullscreen via ESC or other means
        setDisplayMode("inline");
        updateIframeGlobals({ displayMode: "inline" });
        console.log("[OpenAIComponentRenderer] Fullscreen exited by user");
      } else if (document.fullscreenElement && displayMode !== "fullscreen") {
        // Fullscreen was entered externally
        setDisplayMode("fullscreen");
        updateIframeGlobals({ displayMode: "fullscreen" });
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("fullscreenerror", (e) => {
      console.error("[OpenAIComponentRenderer] Fullscreen error:", e);
    });

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [displayMode, updateIframeGlobals]);

  // Watch for theme changes and update iframe
  // Also update when iframe becomes ready to ensure initial theme is set correctly
  useEffect(() => {
    if (widgetUrl && resolvedTheme && isReady) {
      // Use a small delay to ensure window.openai is fully initialized
      const timeoutId = setTimeout(() => {
        updateIframeGlobals({ theme: resolvedTheme });
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [resolvedTheme, widgetUrl, isReady, updateIframeGlobals]);

  if (error) {
    return (
      <div className={className}>
        <div className="bg-red-50/30 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/50 rounded-lg p-4">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load component: {error}
          </p>
        </div>
      </div>
    );
  }

  if (!widgetUrl) {
    return (
      <Wrapper className={className} noWrapper={noWrapper}>
        <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full">
          <Spinner className="size-5" />
        </div>
      </Wrapper>
    );
  }

  return (
    <Wrapper className={className} noWrapper={noWrapper}>
      {showSkeleton && (
        <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full z-0">
          <Spinner className="size-5" />
        </div>
      )}

      {showConsole &&
        isSameOrigin &&
        displayMode !== "fullscreen" &&
        displayMode !== "pip" && (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
            <MCPAppsDebugControls
              displayMode={displayMode}
              onDisplayModeChange={handleDisplayModeChange}
              toolCallId={toolId}
              propsContext="tool"
              resourceUri={componentUrl}
              toolInput={widgetToolInput as Record<string, unknown>}
              resourceAnnotations={undefined}
              llmConfig={null}
              resource={null}
              onPropsChange={undefined}
              protocol="apps-sdk"
              onUpdateGlobals={updateIframeGlobals}
            />
          </div>
        )}
      <div
        ref={containerRef}
        className={cn(
          "w-full h-full flex flex-col justify-center items-center",
          centerVertically && "items-center",
          displayMode === "fullscreen" && "bg-background",
          displayMode === "pip" &&
            `fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-3xl w-full min-w-[300px] h-[400px] shadow-2xl border overflow-hidden`
        )}
        style={
          displayMode === "pip"
            ? { maxWidth: MCP_APPS_CONFIG.DIMENSIONS.PIP_MAX_WIDTH }
            : undefined
        }
        onMouseEnter={() => displayMode === "pip" && setIsPipHovered(true)}
        onMouseLeave={() => displayMode === "pip" && setIsPipHovered(false)}
      >
        {displayMode === "fullscreen" && document.fullscreenElement && (
          <FullscreenNavbar
            title={toolName}
            onClose={() => handleDisplayModeChange("inline")}
          />
        )}

        {displayMode === "pip" && (
          <button
            onClick={() => handleDisplayModeChange("inline")}
            className={cn(
              "absolute top-2 right-2 z-50",
              "flex items-center justify-center",
              "w-8 h-8 rounded-full",
              "bg-background/90 hover:bg-background",
              "border border-border",
              "shadow-lg",
              "transition-opacity duration-200",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              isPipHovered ? "opacity-100" : "opacity-0"
            )}
            aria-label="Exit Picture in Picture"
          >
            <X className="w-4 h-4 text-foreground" />
          </button>
        )}

        <div
          className={cn(
            "flex-1 w-full flex justify-center items-center relative z-10",
            displayMode === "fullscreen" && "pt-14",
            centerVertically && "items-center",
            displayMode === "inline" && (invoking || invoked) && "pt-8"
          )}
        >
          <div className="relative w-full max-w-[768px]">
            {/* Status label above the widget — only in inline mode, matching MCPAppsRenderer */}
            {displayMode === "inline" && (invoking || invoked) && (
              <div className="absolute -top-8 left-2 z-10 whitespace-nowrap">
                {invoking && !toolResult && (
                  <TextShimmer className="text-xs">{invoking}</TextShimmer>
                )}
                {invoked && toolResult && (
                  <span className="text-xs text-muted-foreground">
                    {invoked}
                  </span>
                )}
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={widgetUrl}
              className={cn(
                displayMode === "inline" && "w-full",
                displayMode === "fullscreen" && "w-full h-full rounded-none",
                displayMode === "pip" && "w-full h-full rounded-lg"
              )}
              style={{
                height:
                  displayMode === "fullscreen" || displayMode === "pip"
                    ? "100%"
                    : `${iframeHeight}px`,
              }}
              sandbox={IFRAME_SANDBOX_PERMISSIONS}
              title={`OpenAI Component: ${toolName}`}
              allow="web-share"
            />
          </div>
        </div>
      </div>
    </Wrapper>
  );
}

// Custom comparison to diagnose re-renders: log when props differ
function openAIComponentRendererAreEqual(
  prev: OpenAIComponentRendererProps,
  next: OpenAIComponentRendererProps
) {
  const keys = [
    "componentUrl",
    "toolName",
    "serverId",
    "toolArgs",
    "toolResult",
    "readResource",
    "className",
  ] as const;
  for (const k of keys) {
    const p = prev[k as keyof OpenAIComponentRendererProps];
    const n = next[k as keyof OpenAIComponentRendererProps];
    if (p !== n) {
      return false;
    }
  }
  if (prev.invoking !== next.invoking) return false;
  if (prev.invoked !== next.invoked) return false;
  return true;
}

// Memoize the component to prevent unnecessary re-renders when props haven't changed
export const OpenAIComponentRenderer = memo(
  OpenAIComponentRendererBase,
  openAIComponentRendererAreEqual
);
