import { cn } from "@/client/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useMcpContext } from "../context/McpContext";
import { Spinner } from "./ui/spinner";
import { injectConsoleInterceptor } from "../utils/iframeConsoleInterceptor";
import { IframeConsole } from "./IframeConsole";

interface OpenAIComponentRendererProps {
  componentUrl: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: any;
  serverId: string;
  readResource: (uri: string) => Promise<any>;
  className?: string;
  noWrapper?: boolean;
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
export function OpenAIComponentRenderer({
  componentUrl,
  toolName,
  toolArgs,
  toolResult,
  serverId,
  readResource,
  className,
  noWrapper = false,
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
  const [centerVertically, setCenterVertically] = useState<boolean>(false);
  const [isSameOrigin, setIsSameOrigin] = useState<boolean>(false);

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

  console.log(componentUrl, toolResult);

  // Store widget data and set up iframe URL
  useEffect(() => {
    const storeAndSetUrl = async () => {
      try {
        console.log("[OpenAIComponentRenderer] Starting storeAndSetUrl:", {
          toolName,
          toolArgs,
          toolResult: JSON.stringify(toolResult).substring(0, 200),
          toolResultKeys: toolResult ? Object.keys(toolResult) : [],
          hasToolResultMeta: !!toolResult?._meta,
          hasToolResultContents: !!toolResult?.contents,
        });

        // Extract structured content from tool result (the actual tool parameters)
        const structuredContent = toolResult?.structuredContent || null;

        console.log(
          "[OpenAIComponentRenderer] Extracted structuredContent:",
          structuredContent
        );

        // Fetch the HTML resource client-side (where the connection exists)
        const resourceData = await readResource(componentUrl);

        console.log("[OpenAIComponentRenderer] Resource data:", {
          hasContents: !!resourceData?.contents,
          firstContentKeys: resourceData?.contents?.[0]
            ? Object.keys(resourceData.contents[0])
            : [],
          hasMeta: !!resourceData?.contents?.[0]?._meta,
          metaKeys: resourceData?.contents?.[0]?._meta
            ? Object.keys(resourceData.contents[0]._meta)
            : [],
        });

        // For Apps SDK widgets, use structuredContent as toolInput (the actual tool parameters)
        // toolArgs might be empty or from the initial invocation, structuredContent has the real data
        const widgetToolInput = structuredContent || toolArgs;

        console.log("[OpenAIComponentRenderer] Widget inputs:", {
          toolArgs,
          structuredContent,
          widgetToolInput,
        });

        // Extract CSP metadata from tool result
        // Check both toolResult._meta (for tool calls) and toolResult.contents?.[0]?._meta (for resources)
        let widgetCSP = null;
        const metaSource =
          toolResult?._meta || toolResult?.contents?.[0]?._meta;
        if (metaSource?.["openai/widgetCSP"]) {
          widgetCSP = metaSource["openai/widgetCSP"];
        }

        console.log("[OpenAIComponentRenderer] Widget CSP:", widgetCSP);

        // Store widget data on server (including the fetched HTML)
        const storeResponse = await fetch(
          "/inspector/api/resources/widget/store",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              serverId,
              uri: componentUrl,
              toolInput: widgetToolInput,
              toolOutput: structuredContent,
              resourceData, // Pass the fetched HTML
              toolId,
              widgetCSP, // Pass the CSP metadata
            }),
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

        console.log("[OpenAIComponentRenderer] Checking for dev mode widget:", {
          hasMeta: !!metaForWidget,
          metaKeys: metaForWidget ? Object.keys(metaForWidget) : [],
          hasWidgetMeta: !!metaForWidget?.["mcp-use/widget"],
          widgetMeta: metaForWidget?.["mcp-use/widget"],
          checkedFromToolResultMeta: !!toolResult?._meta,
          checkedFromContentsMeta: !!toolResult?.contents?.[0]?._meta,
          serverBaseUrl,
        });

        // Use dev mode if metadata says so
        const useDevMode =
          metaForWidget?.["mcp-use/widget"]?.html &&
          metaForWidget?.["mcp-use/widget"]?.dev;

        const widgetName = metaForWidget?.["mcp-use/widget"]?.name;

        if (useDevMode && widgetName && serverBaseUrl) {
          const devUrl = `${new URL(serverBaseUrl).origin}/mcp-use/widgets/${widgetName}?${urlParams.toString()}`;
          console.log("[OpenAIComponentRenderer] Using DEV mode URL:", devUrl);
          setWidgetUrl(devUrl);
          // Check if dev URL is same-origin
          try {
            const devUrlObj = new URL(devUrl);
            setIsSameOrigin(devUrlObj.origin === window.location.origin);
          } catch {
            setIsSameOrigin(false);
          }
        } else {
          const prodUrl = `/inspector/api/resources/widget/${toolId}?${urlParams.toString()}`;
          console.log(
            "[OpenAIComponentRenderer] Using PROD mode URL:",
            prodUrl
          );
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
  ]);

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

      // Let console log messages pass through (handled by useIframeConsole hook)
      if (event.data?.type === "iframe-console-log") {
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
          // For now, just respond with error - in a full implementation this would call the tool
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "openai:callTool:response",
              requestId: event.data.requestId,
              error:
                "Tool calls from widgets not yet supported in this inspector",
            },
            "*"
          );
          break;

        case "openai:sendFollowup":
          // Followup messages not yet supported
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
    };

    const handleError = () => {
      setError("Failed to load component");
    };

    const iframe = iframeRef.current;
    iframe?.addEventListener("load", handleLoad);
    iframe?.addEventListener("error", handleError as any);

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
      iframe?.removeEventListener("error", handleError as any);
    };
  }, [widgetUrl, isSameOrigin]);

  // Dynamically resize iframe height to its content, capped at 100vh
  useEffect(() => {
    if (!widgetUrl) return;

    const measure = () => {
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

      <div
        ref={containerRef}
        className={cn(
          "w-full h-full flex flex-col justify-center items-center relative",
          centerVertically && "items-center"
        )}
      >
        {isSameOrigin && (
          <div className="absolute top-2 right-2 z-10">
            <IframeConsole iframeId={toolId} enabled={true} />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={widgetUrl}
          className={cn("w-full max-w-[768px]  rounded-3xl")}
          style={{ height: `${iframeHeight}px` }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          title={`OpenAI Component: ${toolName}`}
          allow="web-share"
        />
      </div>
    </Wrapper>
  );
}
