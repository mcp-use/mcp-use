import { cn } from "@/client/lib/utils";
import { X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useMcpContext } from "../context/McpContext";
import { useTheme } from "../context/ThemeContext";
import { injectConsoleInterceptor } from "../utils/iframeConsoleInterceptor";
import { FullscreenNavbar } from "./FullscreenNavbar";
import { IframeConsole } from "./IframeConsole";
import { Spinner } from "./ui/spinner";
import { WidgetInspectorControls } from "./WidgetInspectorControls";

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
}

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
 * OpenAIComponentRenderer renders OpenAI Apps SDK components
 * Provides window.openai API bridge for component interaction via iframe
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
}: OpenAIComponentRendererProps) {
  const iframeRef = useRef<InstanceType<
    typeof window.HTMLIFrameElement
  > | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
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
  const [widgetToolOutput, setWidgetToolOutput] = useState<any>(null);

  // Generate unique tool ID
  const toolIdRef = useRef(
    `tool-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );
  const toolId = toolIdRef.current;

  const servers = useMcpContext();
  const server = servers.connections.find(
    (connection) => connection.id === serverId
  );
  const serverBaseUrl = server?.url;
  const { resolvedTheme } = useTheme();

  // Store widget data and set up iframe URL
  useEffect(() => {
    const storeAndSetUrl = async () => {
      try {
        // Extract structured content from tool result (the actual tool parameters)
        const structuredContent = toolResult?.structuredContent || null;

        // Fetch the HTML resource client-side (where the connection exists)
        const resourceData = await readResource(componentUrl);

        // For Apps SDK widgets, use structuredContent as toolInput (the actual tool parameters)
        // toolArgs might be empty or from the initial invocation, structuredContent has the real data
        const computedToolInput = structuredContent || toolArgs;
        setWidgetToolInput(computedToolInput);
        setWidgetToolOutput(structuredContent);

        // Extract CSP metadata from tool result
        // Check both toolResult._meta (for tool calls) and toolResult.contents?.[0]?._meta (for resources)
        let widgetCSP = null;
        const metaSource =
          toolResult?._meta || toolResult?.contents?.[0]?._meta;
        if (metaSource?.["openai/widgetCSP"]) {
          widgetCSP = metaSource["openai/widgetCSP"];
        }

        // pass props as url params (toolInput, toolOutput)
        const urlParams = new URLSearchParams();
        const params = {
          toolInput: widgetToolInput,
          toolOutput: structuredContent,
          toolId,
        };
        urlParams.set("mcpUseParams", JSON.stringify(params));

        // Check for dev mode widget - check both _meta locations
        const metaForWidget =
          toolResult?._meta || toolResult?.contents?.[0]?._meta;

        // Use dev mode if metadata says so
        const computedUseDevMode =
          metaForWidget?.["mcp-use/widget"]?.html &&
          metaForWidget?.["mcp-use/widget"]?.dev;
        setUseDevMode(computedUseDevMode || false);

        const widgetName = metaForWidget?.["mcp-use/widget"]?.name;

        // Prepare widget data with optional dev URLs
        const widgetDataToStore: any = {
          serverId,
          uri: componentUrl,
          toolInput: computedToolInput,
          toolOutput: structuredContent,
          resourceData, // Pass the fetched HTML
          toolId,
          widgetCSP, // Pass the CSP metadata
          theme: resolvedTheme, // Pass the current theme to prevent flash
        };

        if (computedUseDevMode && widgetName && serverBaseUrl) {
          const devServerBaseUrl = new URL(serverBaseUrl).origin;
          const devWidgetUrl = `${devServerBaseUrl}/mcp-use/widgets/${widgetName}?${urlParams.toString()}`;
          widgetDataToStore.devWidgetUrl = devWidgetUrl;
          widgetDataToStore.devServerBaseUrl = devServerBaseUrl;
        }

        // Store widget data on server (including the fetched HTML and dev URLs if applicable)
        const storeResponse = await fetch(
          "/inspector/api/resources/widget/store",
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

        if (computedUseDevMode && widgetName && serverBaseUrl) {
          // Use proxy URL for dev widgets (same-origin, supports HMR)
          const proxyUrl = `/inspector/api/dev-widget/${toolId}?${urlParams.toString()}`;
          setWidgetUrl(proxyUrl);
          setIsSameOrigin(true); // Proxy makes it same-origin
        } else {
          const prodUrl = `/inspector/api/resources/widget/${toolId}?${urlParams.toString()}`;
          setWidgetUrl(prodUrl);
          // Relative URLs are always same-origin
          setIsSameOrigin(true);
        }
      } catch (error) {
        console.error("Error storing widget data:", error);
        setError(
          error instanceof Error ? error.message : "Failed to prepare widget"
        );
      }
    };

    storeAndSetUrl();
  }, [
    componentUrl,
    serverId,
    toolArgs,
    toolResult,
    toolId,
    readResource,
    serverBaseUrl,
    resolvedTheme, // Include theme so widget data is updated when theme changes
  ]);

  // Helper to update window.openai globals inside iframe
  const updateIframeGlobals = useCallback(
    (updates: {
      displayMode?: "inline" | "pip" | "fullscreen";
      theme?: "light" | "dark";
      maxHeight?: number;
      locale?: string;
      safeArea?: {
        insets: { top: number; bottom: number; left: number; right: number };
      };
      userAgent?: any;
    }) => {
      if (iframeRef.current?.contentWindow) {
        try {
          const iframeWindow = iframeRef.current.contentWindow;
          if (iframeWindow.openai) {
            // Update all provided properties
            if (updates.displayMode !== undefined) {
              iframeWindow.openai.displayMode = updates.displayMode;
            }
            if (updates.theme !== undefined) {
              iframeWindow.openai.theme = updates.theme;
            }
            if (updates.maxHeight !== undefined) {
              iframeWindow.openai.maxHeight = updates.maxHeight;
            }
            if (updates.locale !== undefined) {
              iframeWindow.openai.locale = updates.locale;
            }
            if (updates.safeArea !== undefined) {
              iframeWindow.openai.safeArea = updates.safeArea;
            }
            if (updates.userAgent !== undefined) {
              iframeWindow.openai.userAgent = updates.userAgent;
            }

            // Dispatch the set_globals event to notify React components
            try {
              const CustomEventConstructor = iframeWindow.CustomEvent as typeof CustomEvent;
              const globalsEvent = new CustomEventConstructor(
                "openai:set_globals",
                {
                  detail: {
                    globals: {
                      ...iframeWindow.openai,
                    },
                  },
                }
              );
              iframeWindow.dispatchEvent(globalsEvent);
            } catch (eventError) {
              // If CustomEvent fails, use postMessage fallback
              iframeWindow.postMessage(
                {
                  type: "openai:globalsChanged",
                  updates,
                },
                "*"
              );
            }
          }
        } catch (e) {
          // Cross-origin or other error, use postMessage instead
          iframeRef.current.contentWindow.postMessage(
            {
              type: "openai:globalsChanged",
              updates,
            },
            "*"
          );
        }
      }
    },
    []
  );

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
            const result = await server.callTool(toolName, params || {});

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

    const handleError: OnErrorEventHandler = () => {
      setError("Failed to load component");
    };

    const iframe = iframeRef.current;
    iframe?.addEventListener("load", handleLoad);
    iframe?.addEventListener("error", handleError);

    // Also try to inject immediately if iframe is already loaded (only for same-origin)
    if (
      iframe &&
      isSameOrigin &&
      iframe.contentDocument?.readyState === "complete"
    ) {
      injectConsoleInterceptor(iframe);
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

  // Dynamically resize iframe height to its content, capped at 100vh
  useEffect(() => {
    if (!widgetUrl) return;

    const measure = () => {
      // Skip automatic measurement if widget is using notifyIntrinsicHeight
      if (useNotifiedHeightRef.current) {
        return;
      }

      const iframe = iframeRef.current;
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
  }, [widgetUrl]);

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
      {!isReady && (
        <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full">
          <Spinner className="size-5" />
        </div>
      )}

      {showConsole &&
        isSameOrigin &&
        displayMode !== "fullscreen" &&
        displayMode !== "pip" && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
            <IframeConsole iframeId={toolId} enabled={true} />
            {useDevMode && (
              <WidgetInspectorControls
                displayMode={displayMode}
                onDisplayModeChange={handleDisplayModeChange}
                toolInput={widgetToolInput}
                toolOutput={widgetToolOutput}
                toolResult={toolResult}
                iframeRef={iframeRef}
                toolId={toolId}
              />
            )}
          </div>
        )}
      <div
        ref={containerRef}
        className={cn(
          "w-full h-full flex flex-col justify-center items-center",
          centerVertically && "items-center",
          displayMode === "fullscreen" && "bg-background",
          displayMode === "pip" &&
            "fixed bottom-6 right-6 z-50 rounded-3xl w-[768px] h-96 shadow-2xl border overflow-hidden"
        )}
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
            "flex-1 w-full flex justify-center items-center",
            displayMode === "fullscreen" && "pt-14",
            centerVertically && "items-center"
          )}
        >
          <iframe
            ref={iframeRef}
            src={widgetUrl}
            className={cn(
              displayMode === "inline" && " w-full max-w-[768px]",
              displayMode === "fullscreen" && "w-full h-full rounded-none",
              displayMode === "pip" && "w-full h-full rounded-lg"
            )}
            style={{
              height:
                displayMode === "fullscreen" || displayMode === "pip"
                  ? "100%"
                  : `${iframeHeight}px`,
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            title={`OpenAI Component: ${toolName}`}
            allow="web-share"
          />
        </div>
      </div>
    </Wrapper>
  );
}

// Memoize the component to prevent unnecessary re-renders when props haven't changed
export const OpenAIComponentRenderer = memo(OpenAIComponentRendererBase);
