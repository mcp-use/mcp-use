import type { CallToolResult } from "./result-types.js";
import type { RegisteredTools } from "./register.js";
import type { DeepPartial } from "./register.js";
import type {
  HostCapabilities,
  HostContext,
  HostInfo,
  SafeAreaInsets,
} from "./host-types.js";
import {
  useHostContextSubscription,
  useViewActions,
  useViewBridgeSnapshot,
  useViewBridgeStore,
} from "./view-bridge.js";

type DisplayMode = "inline" | "fullscreen" | "pip";

/**
 * Ambient view handle: tool-call data channels, host context, and actions.
 */
export interface ViewHandle<Name extends keyof RegisteredTools = never> {
  /** Last result's `structuredContent` — same payload the component receives as props. */
  props: (Name extends keyof RegisteredTools
    ? RegisteredTools[Name]["output"]
    : unknown) | undefined;
  /** Complete tool arguments from the host. */
  toolInput: (Name extends keyof RegisteredTools
    ? RegisteredTools[Name]["input"]
    : unknown) | undefined;
  /** Progressive argument stream (feeds the `Loading` export). */
  partialToolInput: (Name extends keyof RegisteredTools
    ? DeepPartial<RegisteredTools[Name]["input"]>
    : unknown) | undefined;
  /** Whether tool arguments are currently streaming. */
  isStreaming: boolean;
  /** Tool input received but no result yet. */
  isPending: boolean;
  /** View-only result `_meta` — never model-visible. */
  meta: Record<string, unknown> | undefined;
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
  /** Untyped server-tool call — prefer {@link useCallTool}. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  /** Send a follow-up message that triggers a model turn (`ui/message`). */
  sendFollowUpMessage: (args: { prompt: string }) => Promise<void>;
  /** Open an external URL in the host browser. */
  openExternal: (args: { url: string }) => void;
  /** Request a display mode change from the host. */
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<void>;
}

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

/**
 * Ambient hook for the current tool call, host context, and bridge actions.
 *
 * @example
 * ```tsx
 * function MyView() {
 *   const { theme, sendFollowUpMessage, meta } = useView();
 *   return <div data-theme={theme}>{meta ? "has meta" : "no meta"}</div>;
 * }
 * ```
 */
export function useView<
  Name extends keyof RegisteredTools = never,
>(): ViewHandle<Name> {
  const snap = useViewBridgeSnapshot();
  const hostContext = snap.hostContext;
  const actions = useViewActions();
  const store = useViewBridgeStore();
  const app = store.getApp();

  const theme: "light" | "dark" =
    hostContext?.theme === "dark" ? "dark" : "light";
  const displayMode: DisplayMode =
    hostContext?.displayMode === "fullscreen" ||
    hostContext?.displayMode === "pip"
      ? hostContext.displayMode
      : "inline";

  return {
    props: snap.props as ViewHandle<Name>["props"],
    toolInput: snap.toolInput as ViewHandle<Name>["toolInput"],
    partialToolInput: snap.partialToolInput as ViewHandle<Name>["partialToolInput"],
    isStreaming: snap.isStreaming,
    isPending: snap.isPending,
    meta: snap.meta,
    theme,
    locale: typeof hostContext?.locale === "string" ? hostContext.locale : "en-US",
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
    displayMode,
    safeArea: hostContext?.safeAreaInsets ?? DEFAULT_SAFE_AREA,
    maxHeight: readMaxHeight(hostContext),
    maxWidth: readMaxWidth(hostContext),
    hostInfo: app?.getHostVersion(),
    hostCapabilities: app?.getHostCapabilities(),
    hostContext,
    isAvailable: snap.isConnected,
    ...actions,
  };
}

/**
 * Dedicated host-theme subscription without re-rendering on other `useView` channels.
 *
 * @example
 * ```tsx
 * const theme = useViewTheme();
 * ```
 */
export function useViewTheme(): "light" | "dark" {
  const hostContext = useHostContextSubscription();
  return hostContext?.theme === "dark" ? "dark" : "light";
}
