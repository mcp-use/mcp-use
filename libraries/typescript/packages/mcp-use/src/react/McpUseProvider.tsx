import React, { StrictMode, useCallback, useEffect, useRef } from "react";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { ThemeProvider } from "./ThemeProvider.js";
import { WidgetControls } from "./WidgetControls.js";

// Dynamically import react-router-dom (template dependency)
let BrowserRouter: any = null;
let routerError: Error | null = null;

// Attempt to load react-router-dom on module initialization
(async () => {
  try {
    const routerModule = await import("react-router-dom");
    BrowserRouter = routerModule.BrowserRouter;
  } catch (error) {
    routerError = new Error(
      "❌ react-router-dom not installed!\n\n" +
        "To use MCP widgets with McpUseProvider, you need to install:\n\n" +
        "  npm install react-router-dom\n" +
        "  # or\n" +
        "  pnpm add react-router-dom\n\n" +
        "This dependency is automatically included in projects created with 'create-mcp-use-app'."
    );
  }
})();

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
   * Automatically notify OpenAI about container height changes for auto-sizing
   * Uses ResizeObserver to monitor the children container and calls window.openai.notifyIntrinsicHeight()
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastHeightRef = useRef<number>(0);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const notificationInProgressRef = useRef<boolean>(false);

  // Notify OpenAI about height changes
  const notifyHeight = useCallback((height: number) => {
    if (typeof window !== "undefined" && window.openai?.notifyIntrinsicHeight) {
      notificationInProgressRef.current = true;
      window.openai
        .notifyIntrinsicHeight(height)
        .then(() => {
          notificationInProgressRef.current = false;
        })
        .catch((error) => {
          notificationInProgressRef.current = false;
          console.error(
            "[McpUseProvider] Failed to notify intrinsic height:",
            error
          );
        });
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
      return;
    }

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      // Skip if notification is in progress to prevent feedback loop
      if (notificationInProgressRef.current) {
        return;
      }

      for (const entry of entries) {
        const height = entry.contentRect.height;
        // Use scrollHeight as fallback for more accurate intrinsic height
        const scrollHeight = entry.target.scrollHeight;
        const intrinsicHeight = Math.max(height, scrollHeight);
        debouncedNotifyHeight(intrinsicHeight);
      }
    });

    observer.observe(container);

    // Initial measurement
    const initialHeight = Math.max(
      container.offsetHeight,
      container.scrollHeight
    );
    if (initialHeight > 0) {
      debouncedNotifyHeight(initialHeight);
    }

    return () => {
      observer.disconnect();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
      // Reset notification flag
      notificationInProgressRef.current = false;
    };
  }, [autoSize, debouncedNotifyHeight]);

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

  // BrowserRouter wraps everything (check if available)
  if (routerError) {
    throw routerError;
  }
  if (!BrowserRouter) {
    throw new Error("react-router-dom is still loading, please try again.");
  }
  content = <BrowserRouter basename={basename}>{content}</BrowserRouter>;

  // ThemeProvider wraps BrowserRouter
  content = <ThemeProvider>{content}</ThemeProvider>;

  // Wrap in container div for auto-sizing if enabled
  if (autoSize) {
    const containerStyle: React.CSSProperties = {
      width: "100%",
      minHeight: 0,
    };
    content = (
      <div ref={containerRef} style={containerStyle}>
        {content}
      </div>
    );
  }

  // StrictMode is the outermost wrapper
  return <StrictMode>{content}</StrictMode>;
}
