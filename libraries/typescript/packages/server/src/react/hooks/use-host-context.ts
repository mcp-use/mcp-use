import {
  useHostContextSubscription,
  useViewBridgeSnapshot,
  useViewBridgeStore,
} from "../bridge/view-bridge.js";
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

function readMaxWidth(hostContext: HostContext | undefined): number | undefined {
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

/**
 * Host environment and bridge availability for the current view.
 */
export interface HostContextHandle {
  /** Host color theme. */
  theme: "light" | "dark";
  /** User locale (BCP 47). */
  locale: string;
  /** User timezone (IANA). */
  timeZone: string;
  /** Host application user-agent string. */
  userAgent: string;
  /** How the view is currently displayed. */
  displayMode: DisplayMode;
  /** Mobile safe area insets in pixels. */
  safeArea: SafeAreaInsets;
  /** Maximum container height in pixels, when provided by the host. */
  maxHeight: number | undefined;
  /** Maximum container width in pixels, when provided by the host. */
  maxWidth: number | undefined;
  /** Host identity from {@link App.getHostVersion}. */
  hostInfo: HostInfo | undefined;
  /** Host capabilities from initialization. */
  hostCapabilities: HostCapabilities | undefined;
  /** Raw host context object. */
  hostContext: HostContext | undefined;
  /** Whether the MCP Apps bridge is connected. */
  isAvailable: boolean;
}

/**
 * Subscribe to host environment context (theme, locale, display mode, layout).
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
  const hostContext = useHostContextSubscription();
  const snap = useViewBridgeSnapshot();
  const store = useViewBridgeStore();
  const app = store.getApp();

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
    displayMode: resolveDisplayMode(hostContext),
    safeArea: hostContext?.safeAreaInsets ?? DEFAULT_SAFE_AREA,
    maxHeight: readMaxHeight(hostContext),
    maxWidth: readMaxWidth(hostContext),
    hostInfo: app?.getHostVersion(),
    hostCapabilities: app?.getHostCapabilities(),
    hostContext,
    isAvailable: snap.isConnected,
  };
}
