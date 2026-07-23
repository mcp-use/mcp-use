import { useSyncExternalStore } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type {
  DisplayMode,
  HostCapabilities,
  HostContext,
  HostInfo,
  SafeAreaInsets,
} from "../types/host-types.js";

const DEFAULT_SAFE_AREA: SafeAreaInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

function readMaxHeight(
  hostContext: HostContext | undefined
): number | undefined {
  const dims = hostContext?.containerDimensions;
  if (!dims) return undefined;
  if ("height" in dims && typeof dims.height === "number") return dims.height;
  if ("maxHeight" in dims && typeof dims.maxHeight === "number") {
    return dims.maxHeight;
  }
  return undefined;
}

function readMaxWidth(
  hostContext: HostContext | undefined
): number | undefined {
  const dims = hostContext?.containerDimensions;
  if (!dims) return undefined;
  if ("width" in dims && typeof dims.width === "number") return dims.width;
  if ("maxWidth" in dims && typeof dims.maxWidth === "number") {
    return dims.maxWidth;
  }
  return undefined;
}

function resolveDisplayMode(hostContext: HostContext | undefined): DisplayMode {
  return hostContext?.displayMode === "fullscreen" ||
    hostContext?.displayMode === "pip"
    ? hostContext.displayMode
    : "inline";
}

function resolvePlatform(
  hostContext: HostContext | undefined
): "web" | "mobile" {
  return hostContext?.platform === "mobile" ? "mobile" : "web";
}

/**
 * Host environment and bridge availability for the current view.
 */
export interface HostContextHandle {
  /** Host color theme. `"light"` until the host reports a theme. */
  theme: "light" | "dark";
  /** User locale (BCP 47). Falls back to `"en-US"` when the host does not report one. */
  locale: string;
  /** User timezone (IANA). Falls back to the browser's timezone, then `"UTC"`. */
  timeZone: string;
  /** Host application user-agent string. Falls back to the browser's own user agent. */
  userAgent: string;
  /**
   * Host-reported platform. `"mobile"` on mobile hosts; otherwise `"web"`.
   * Inspector maps Desktop → `"web"` and Mobile → `"mobile"`.
   */
  platform: "web" | "mobile";
  /** How the host is currently displaying the view. `"inline"` until the host reports otherwise. */
  displayMode: DisplayMode;
  /** Mobile safe area insets in pixels. All zeros when the host reports none. */
  safeArea: SafeAreaInsets;
  /**
   * Vertical layout budget in pixels: the most height the view can occupy.
   *
   * Derived from the host's container dimensions. When the host fixes the
   * container to an exact height, that height is reported; otherwise the
   * host's stated maximum is. `undefined` when the host reports no layout
   * constraint — treat that as unbounded. The raw dimensions remain available
   * on `hostContext.containerDimensions`.
   */
  maxHeight: number | undefined;
  /**
   * Horizontal layout budget in pixels: the most width the view can occupy.
   *
   * Same derivation as `maxHeight`: an exact container width when the host
   * fixes one, otherwise the host's stated maximum, otherwise `undefined`
   * (unbounded).
   */
  maxWidth: number | undefined;
  /** Host identity (name and version). `undefined` until the bridge has connected. */
  hostInfo: HostInfo | undefined;
  /** Host capabilities negotiated at initialization. `undefined` until the bridge has connected. */
  hostCapabilities: HostCapabilities | undefined;
  /**
   * The host context object exactly as the host reported it, with none of the
   * fallbacks the fields above apply. Use it to read host-specific fields this
   * handle does not surface. `undefined` until the host first reports context.
   */
  hostContext: HostContext | undefined;
  /** Whether the MCP Apps bridge is connected. While `false`, every field holds its documented fallback. */
  isAvailable: boolean;
}

/**
 * Subscribe to host environment context (theme, locale, display mode, layout).
 *
 * Re-renders only when host context or bridge connection status changes — not
 * on tool-input / result / cancel snapshot updates.
 *
 * @example
 * ```tsx
 * function Layout() {
 *   const { theme, locale, maxHeight } = useHostContext();
 *   return (
 *     <div data-theme={theme} lang={locale} style={{ maxHeight }}>
 *       …
 *     </div>
 *   );
 * }
 * ```
 */
export function useHostContext(): HostContextHandle {
  const runtime = useViewRuntime("useHostContext");
  const { hostContext, isConnected } = useSyncExternalStore(
    runtime.subscribeHost,
    runtime.getHostSnapshot
  );
  const app = runtime.getApp();

  return {
    theme: hostContext?.theme === "dark" ? "dark" : "light",
    locale:
      typeof hostContext?.locale === "string" ? hostContext.locale : "en-US",
    timeZone:
      typeof hostContext?.timeZone === "string"
        ? hostContext.timeZone
        : typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : "UTC",
    userAgent:
      typeof hostContext?.userAgent === "string"
        ? hostContext.userAgent
        : typeof navigator !== "undefined"
          ? navigator.userAgent
          : "",
    platform: resolvePlatform(hostContext),
    displayMode: resolveDisplayMode(hostContext),
    safeArea: hostContext?.safeAreaInsets ?? DEFAULT_SAFE_AREA,
    maxHeight: readMaxHeight(hostContext),
    maxWidth: readMaxWidth(hostContext),
    hostInfo: app?.getHostVersion(),
    hostCapabilities: app?.getHostCapabilities(),
    hostContext,
    isAvailable: isConnected,
  };
}
