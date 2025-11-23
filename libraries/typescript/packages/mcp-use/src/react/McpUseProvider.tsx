import React, { StrictMode, useCallback, useEffect, useRef } from "react";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary.js";
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

  // Notify OpenAI about height changes
  const notifyHeight = useCallback((height: number) => {
    if (typeof window !== "undefined" && window.openai?.notifyIntrinsicHeight) {
      window.openai.notifyIntrinsicHeight(height).catch((error) => {
        console.error("Failed to notify intrinsic height:", error);
      });
    }
  }, []);

  // Debounced height notification
  const debouncedNotifyHeight = useCallback(
    (height: number) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        if (height !== lastHeightRef.current && height > 0) {
          lastHeightRef.current = height;
          notifyHeight(height);
        }
      }, 150); // 150ms debounce
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
      }
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

  // BrowserRouter wraps everything
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
