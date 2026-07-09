import React, { StrictMode, useRef } from "react";

import { setViewBridgeAppOptions } from "../bridge/view-bridge-store.js";
import { ErrorBoundary } from "./error-boundary.js";
import { ThemeProvider } from "./theme-provider.js";
import { ViewControls } from "./view-controls.js";

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
  /**
   * Whether the ext-apps guest `App` auto-measures the document (under
   * `height: max-content`) and notifies the host on size changes.
   *
   * Disable when the view's height derives from its width (for example a
   * fixed aspect-ratio container): auto-resize then measures ~0 and the host
   * collapses the iframe. Report size manually with
   * {@link useSendSizeChanged}.
   *
   * Must be set on the provider present at first render — it configures the
   * bridge `App` before connect and cannot change afterwards.
   *
   * @defaultValue true
   */
  autoSize?: boolean;
}

/**
 * Opt-in wrapper bundling theme application, error-boundary customization,
 * and per-view auto-resize configuration.
 *
 * The generated iframe entry still owns bridge connection, mount, and the
 * error boundary. Auto-resize defaults to on without this provider; pass
 * `autoSize={false}` here to opt out and report size via
 * {@link useSendSizeChanged}.
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
  autoSize = true,
}: McpUseProviderProps) {
  const autoSizeApplied = useRef(false);
  if (!autoSizeApplied.current) {
    autoSizeApplied.current = true;
    setViewBridgeAppOptions({ autoResize: autoSize });
  }

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
