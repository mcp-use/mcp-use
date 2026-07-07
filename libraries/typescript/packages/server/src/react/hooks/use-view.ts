import type { ContentBlock } from "@modelcontextprotocol/server";

import type { CallToolResult } from "../types/result-types.js";
import type { RegisteredTools } from "../types/register.js";
import type { DeepPartial } from "../types/register.js";
import {
  useHostContextSubscription,
  useViewActions,
} from "../bridge/view-bridge.js";
import type {
  DisplayMode,
  HostCapabilities,
  HostContext,
  HostInfo,
  SafeAreaInsets,
} from "../types/host-types.js";
import { useHostContext } from "./use-host-context.js";
import { useViewContext } from "./use-view-context.js";

/**
 * Ambient view handle: tool-call data channels, host context, and actions.
 */
export interface ViewHandle<Name extends keyof RegisteredTools = never> {
  /** Model-visible tool output from the last result's `structuredContent`. */
  toolOutput: (Name extends keyof RegisteredTools
    ? RegisteredTools[Name]["output"]
    : unknown) | undefined;
  /** Model-visible content blocks from the last tool result. */
  content: ContentBlock[] | undefined;
  /** Complete tool arguments from the host. */
  toolInput: (Name extends keyof RegisteredTools
    ? RegisteredTools[Name]["input"]
    : unknown) | undefined;
  /** Progressive argument stream while waiting for a result. */
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

/**
 * Migration aggregate for v1 `useWidget` callers: tool-call data, host context,
 * and bridge actions in one handle.
 *
 * New views should prefer {@link useViewContext}, {@link useHostContext}, and the
 * per-action hooks ({@link useSendFollowUp}, {@link useOpenExternal},
 * {@link useDisplayMode}, {@link useCallTool}).
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
  const contextHandle = useViewContext<Name>();
  const host = useHostContext();
  const actions = useViewActions();

  return {
    toolOutput:
      contextHandle.status === "ready" ? contextHandle.toolOutput : undefined,
    content: contextHandle.status === "ready" ? contextHandle.content : undefined,
    toolInput: contextHandle.toolInput,
    partialToolInput:
      contextHandle.status === "ready"
        ? undefined
        : contextHandle.partialToolInput,
    isStreaming: contextHandle.status === "streaming",
    isPending: contextHandle.status === "pending",
    meta: contextHandle.status === "ready" ? contextHandle.meta : undefined,
    ...host,
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
