import React, { StrictMode } from "react";

import { ErrorBoundary } from "./ErrorBoundary.js";
import { ThemeProvider } from "./ThemeProvider.js";
import { ViewControls } from "./ViewControls.js";

interface McpUseProviderProps {
  children: React.ReactNode;
  /** Show the debug overlay in {@link ViewControls}. */
  debugger?: boolean;
  /**
   * Show display-mode controls in {@link ViewControls}.
   *
   * @defaultValue `false`
   */
  viewControls?: boolean | "pip" | "fullscreen";
  /** Set `color-scheme` on the document root. */
  colorScheme?: boolean;
  /** Custom error-boundary fallback. */
  fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
}

/**
 * Opt-in wrapper bundling theme application and error-boundary customization.
 *
 * The generated iframe entry covers bridge connection, mount, and auto-resize
 * without this provider.
 *
 * @example
 * ```tsx
 * <McpUseProvider debugger viewControls>
 *   <MyView />
 * </McpUseProvider>
 * ```
 */
export function McpUseProvider({
  children,
  debugger: enableDebugger = false,
  viewControls = false,
  colorScheme = true,
  fallback,
}: McpUseProviderProps) {
  let content: React.ReactNode = children;

  content = (
    <ErrorBoundary {...(fallback !== undefined && { fallback })}>
      {content}
    </ErrorBoundary>
  );

  if (enableDebugger || viewControls) {
    content = (
      <ViewControls debugger={enableDebugger} viewControls={viewControls}>
        {content}
      </ViewControls>
    );
  }

  content = (
    <ThemeProvider colorScheme={colorScheme}>{content}</ThemeProvider>
  );

  return <StrictMode>{content}</StrictMode>;
}
