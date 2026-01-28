import React, {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { getMcpAppsBridge } from "./mcp-apps-bridge.js";
import { ThemeProvider } from "./ThemeProvider.js";
import { WidgetControls } from "./WidgetControls.js";

/**
 * Calculate basename for proper routing in both dev proxy and production
 */
function getBasename(): string {
  if (typeof window === "undefined") return "/";
  const path = window.location.pathname;
  // Check for inspector dev widget proxy pattern
  const match = path.match(/^(\/inspector\/api\/dev-widget\/[^/]+)/);
  if (match) {
    return match[1];
  }
  return "/";
}

// Constants for height management
const HEIGHT_DEBOUNCE_MS = 150; // Debounce duration to wait for animations to settle
const MIN_HEIGHT_CHANGE_PX = 5; // Minimum height change to trigger notification

interface McpUseProviderProps {
  children: React.ReactNode;
  /**
   * Enable debug button in WidgetControls component
   * @default false
   */
  debugger?: boolean;
  /**
   * Enable view controls (fullscreen/pip) in WidgetControls component
   * - `true` = show both pip and fullscreen buttons
   * - `"pip"` = show only pip button
   * - `"fullscreen"` = show only fullscreen button
   * @default false
   */
  viewControls?: boolean | "pip" | "fullscreen";
  /**
   * Automatically notify host about container height changes for auto-sizing
   * Supports both ChatGPT Apps SDK (window.openai) and MCP Apps (postMessage bridge)
   * Uses ResizeObserver to monitor the children container
   * @default false
   */
  autoSize?: boolean;
}

/**
 * Unified provider component that combines all common React setup for mcp-use widgets.
 *
 * Includes:
 * - StrictMode (always)
 * - ThemeProvider (always)
 * - BrowserRouter with automatic basename calculation (always)
 * - WidgetControls (if debugger={true} or viewControls is set)
 * - ErrorBoundary (always)
 * - Auto-sizing (if autoSize={true})
 *
 * @example
 * ```tsx
 * <McpUseProvider debugger viewControls autoSize>
 *   <AppsSDKUIProvider linkComponent={Link}>
 *     <div>My widget content</div>
 *   </AppsSDKUIProvider>
 * </McpUseProvider>
 * ```
 */
export function McpUseProvider({
  children,
  debugger: enableDebugger = false,
  viewControls = false,
  autoSize = false,
}: McpUseProviderProps) {
  const basename = getBasename();
  const [containerElement, setContainerElement] =
    useState<HTMLDivElement | null>(null);
  const lastHeightRef = useRef<number>(0);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const notificationInProgressRef = useRef<boolean>(false);

  // State for dynamic router loading
  const [BrowserRouter, setBrowserRouter] = useState<any>(null);
  const [routerError, setRouterError] = useState<Error | null>(null);
  const [isRouterLoading, setIsRouterLoading] = useState(true);

  // Load react-router dynamically on mount
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const routerModule = await import("react-router");
        if (mounted) {
          setBrowserRouter(() => routerModule.BrowserRouter);
          setIsRouterLoading(false);
        }
      } catch (error) {
        if (mounted) {
          setRouterError(
            new Error(
              "❌ react-router not installed!\n\n" +
                "To use MCP widgets with McpUseProvider, you need to install:\n\n" +
                "  npm install react-router\n" +
                "  # or\n" +
                "  pnpm add react-router\n\n" +
                "This dependency is automatically included in projects created with 'create-mcp-use-app'."
            )
          );
          setIsRouterLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Notify host about height changes (dual-protocol support)
  const notifyHeight = useCallback((height: number) => {
    if (typeof window === "undefined") return;

    notificationInProgressRef.current = true;

    // Try ChatGPT Apps SDK first
    if (window.openai?.notifyIntrinsicHeight) {
      window.openai
        .notifyIntrinsicHeight(height)
        .then(() => {
          notificationInProgressRef.current = false;
        })
        .catch((error) => {
          notificationInProgressRef.current = false;
          console.error(
            "[McpUseProvider] Failed to notify intrinsic height (ChatGPT):",
            error
          );
        });
      return;
    }

    // Fall back to MCP Apps bridge
    // Always try to send - the bridge will handle if not connected yet
    try {
      const bridge = getMcpAppsBridge();
      bridge.sendSizeChanged({ height });
      console.log("[McpUseProvider] Sent size-changed notification:", height);
      notificationInProgressRef.current = false;
    } catch (error) {
      notificationInProgressRef.current = false;
      console.error(
        "[McpUseProvider] Failed to notify size change (MCP Apps):",
        error
      );
    }
  }, []);

  // Debounced height notification with threshold to prevent feedback loops
  // Uses longer debounce to wait for animations to settle
  const debouncedNotifyHeight = useCallback(
    (height: number) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        // Only notify if height changed by more than threshold and is positive
        const heightDiff = Math.abs(height - lastHeightRef.current);
        if (heightDiff >= MIN_HEIGHT_CHANGE_PX && height > 0) {
          lastHeightRef.current = height;
          notifyHeight(height);
        }
      }, HEIGHT_DEBOUNCE_MS);
    },
    [notifyHeight]
  );

  // Set up ResizeObserver for auto-sizing
  useEffect(() => {
    if (!autoSize) {
      console.log("[McpUseProvider] autoSize is disabled");
      return;
    }

    if (!containerElement) {
      console.log("[McpUseProvider] No container element found for autoSize");
      return;
    }

    if (typeof ResizeObserver === "undefined") {
      console.log("[McpUseProvider] ResizeObserver not available");
      return;
    }

    console.log("[McpUseProvider] Setting up ResizeObserver for autoSize");

    const observer = new ResizeObserver((entries) => {
      // Skip if notification is in progress to prevent feedback loop
      if (notificationInProgressRef.current) {
        console.log(
          "[McpUseProvider] Skipping resize - notification in progress"
        );
        return;
      }

      for (const entry of entries) {
        const height = entry.contentRect.height;
        // Use scrollHeight as fallback for more accurate intrinsic height
        const scrollHeight = entry.target.scrollHeight;
        const intrinsicHeight = Math.max(height, scrollHeight);
        console.log("[McpUseProvider] ResizeObserver fired:", {
          height,
          scrollHeight,
          intrinsicHeight,
        });
        debouncedNotifyHeight(intrinsicHeight);
      }
    });

    observer.observe(containerElement);

    // Initial measurement
    const initialHeight = Math.max(
      containerElement.offsetHeight,
      containerElement.scrollHeight
    );
    console.log("[McpUseProvider] Initial height measurement:", initialHeight);
    if (initialHeight > 0) {
      debouncedNotifyHeight(initialHeight);
    }

    return () => {
      console.log("[McpUseProvider] Cleaning up ResizeObserver");
      observer.disconnect();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
      // Reset notification flag
      notificationInProgressRef.current = false;
    };
  }, [autoSize, containerElement, debouncedNotifyHeight]);

  // Show loading state while router is being loaded
  if (isRouterLoading) {
    return (
      <StrictMode>
        <ThemeProvider>
          <div style={{ padding: "20px", textAlign: "center" }}>Loading...</div>
        </ThemeProvider>
      </StrictMode>
    );
  }

  // Throw error if router failed to load
  if (routerError) {
    throw routerError;
  }

  // Build the component tree with conditional wrappers
  let content: React.ReactNode = children;

  // ErrorBoundary is always the innermost wrapper
  content = <ErrorBoundary>{content}</ErrorBoundary>;

  // WidgetControls wraps ErrorBoundary if debugger is enabled or viewControls is set
  // It combines both debug and view control functionality with shared hover logic
  if (enableDebugger || viewControls) {
    content = (
      <WidgetControls debugger={enableDebugger} viewControls={viewControls}>
        {content}
      </WidgetControls>
    );
  }

  // BrowserRouter wraps everything (should be loaded by now)
  if (BrowserRouter) {
    content = <BrowserRouter basename={basename}>{content}</BrowserRouter>;
  }

  // ThemeProvider wraps BrowserRouter
  content = <ThemeProvider>{content}</ThemeProvider>;

  // Wrap in container div for auto-sizing if enabled
  if (autoSize) {
    const containerStyle: React.CSSProperties = {
      width: "100%",
      minHeight: 0,
    };
    content = (
      <div ref={setContainerElement} style={containerStyle}>
        {content}
      </div>
    );
  }

  // StrictMode is the outermost wrapper
  return <StrictMode>{content}</StrictMode>;
}
