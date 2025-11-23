import React, { StrictMode } from "react";
import { BrowserRouter } from "react-router";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { ThemeProvider } from "./ThemeProvider.js";
import { WidgetDebugger } from "./WidgetDebugger.js";
import { WidgetFullscreenWrapper } from "./WidgetFullscreenWrapper.js";

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
   * Enable WidgetDebugger component
   * @default false
   */
  debugger?: boolean;
  /**
   * Enable WidgetFullscreenWrapper component
   * - `true` = show both pip and fullscreen buttons
   * - `"pip"` = show only pip button
   * - `"fullscreen"` = show only fullscreen button
   * @default false
   */
  viewControls?: boolean | "pip" | "fullscreen";
}

/**
 * Unified provider component that combines all common React setup for mcp-use widgets.
 * 
 * Includes:
 * - StrictMode (always)
 * - ThemeProvider (always)
 * - BrowserRouter with automatic basename calculation (always)
 * - WidgetDebugger (if debugger={true})
 * - WidgetFullscreenWrapper (if viewControls is set)
 * - ErrorBoundary (always)
 * 
 * @example
 * ```tsx
 * <McpUseProvider debugger viewControls>
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
}: McpUseProviderProps) {
  const basename = getBasename();

  // Build the component tree with conditional wrappers
  let content: React.ReactNode = children;

  // ErrorBoundary is always the innermost wrapper
  content = <ErrorBoundary>{content}</ErrorBoundary>;

  // WidgetFullscreenWrapper wraps ErrorBoundary if viewControls is enabled
  if (viewControls) {
    content = (
      <WidgetFullscreenWrapper viewControls={viewControls}>
        {content}
      </WidgetFullscreenWrapper>
    );
  }

  // WidgetDebugger wraps WidgetFullscreenWrapper (or ErrorBoundary) if debugger is enabled
  if (enableDebugger) {
    content = <WidgetDebugger>{content}</WidgetDebugger>;
  }

  // BrowserRouter wraps everything
  content = <BrowserRouter basename={basename}>{content}</BrowserRouter>;

  // ThemeProvider wraps BrowserRouter
  content = <ThemeProvider>{content}</ThemeProvider>;

  // StrictMode is the outermost wrapper
  return <StrictMode>{content}</StrictMode>;
}

