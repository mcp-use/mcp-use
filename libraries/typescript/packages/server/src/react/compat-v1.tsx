/**
 * Deprecated browser adapters for unchanged mcp-use v1 widgets.
 *
 * The adapters are deliberately composed from the native v2 runtime and
 * hooks. They do not recreate the v1 bridge or its global event machinery.
 */

import type {
  CallToolResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import React, {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ThemeProvider } from "./components/theme-provider.js";
import { ViewControls } from "./components/view-controls.js";
import { useDisplayMode } from "./hooks/use-display-mode.js";
import { useHostContext } from "./hooks/use-host-context.js";
import { useToolContext } from "./hooks/use-tool-context.js";
import { useViewRuntime } from "./runtime/view-runtime-context.js";
import type { DisplayMode, SafeAreaInsets } from "./types/host-types.js";

/** @deprecated Use native v2 registered result types. Removed in mcp-use v3. */
export type UnknownObject = Record<string, unknown>;

/** @deprecated Use native v2 host types. Removed in mcp-use v3. */
export type Theme = "light" | "dark";

/**
 * Metadata accepted by `resources/<name>/widget.tsx` during v1 compatibility
 * discovery.
 *
 * @deprecated Export native v2 `viewConfig` from `views/<name>/view.tsx` and
 * bind resource facts on the server tool. Removed in mcp-use v3.
 */
export interface WidgetMetadata {
  /** Widget title. */
  title?: string;
  /** Widget description. */
  description?: string;
  /** Widget props/input schema. */
  props?: StandardSchemaWithJSON | unknown[];
  /** Deprecated alias for props. */
  inputs?: StandardSchemaWithJSON | unknown[];
  /** Deprecated alias for props. */
  schema?: StandardSchemaWithJSON | unknown[];
  /** Model-facing output for an auto-registered widget tool. */
  toolOutput?:
    | CallToolResult
    | ((params: UnknownObject) => CallToolResult | Promise<CallToolResult>);
  /** Whether CLI discovery auto-registers a same-named tool. */
  exposeAsTool?: boolean;
  /** Tool/resource annotations used by the compatibility registration. */
  annotations?: UnknownObject;
  /** Extension metadata. */
  _meta?: UnknownObject;
  /** Unified legacy widget metadata. */
  metadata?: {
    /** Resource description. */
    description?: string;
    /** MCP Apps CSP. */
    csp?: UnknownObject;
    /** Host border preference. */
    prefersBorder?: boolean;
    /** Dedicated view domain. */
    domain?: string;
    /** Human-readable Apps SDK widget summary. */
    widgetDescription?: string;
    /** Whether the v2 bootstrap automatically reports size changes. */
    autoResize?: boolean;
    /** Invocation status text. */
    invoking?: string;
    /** Completion status text. */
    invoked?: string;
  };
  /** Legacy OpenAI Apps SDK resource metadata. */
  appsSdkMetadata?: UnknownObject;
}

/**
 * v1 provider props translated onto native v2 theme and control components.
 *
 * @deprecated Compose native v2 view components directly. Removed in mcp-use
 * v3.
 */
export interface McpUseProviderProps {
  /** Widget children. */
  children: ReactNode;
  /** Show the debug overlay. */
  debugger?: boolean;
  /** Show display-mode controls. */
  viewControls?: boolean | "pip" | "fullscreen";
  /** Retained for source compatibility; sizing is owned by viewConfig/bootstrap. */
  autoSize?: boolean;
  /** Apply the active theme as the document color scheme. */
  colorScheme?: boolean;
}

/**
 * v1 widget provider composed over the native v2 view runtime.
 *
 * @deprecated Use native v2 hooks/components from `mcp-use/react`. Removed in
 * mcp-use v3.
 */
export function McpUseProvider({
  children,
  debugger: enableDebugger = false,
  viewControls = false,
  colorScheme = true,
}: McpUseProviderProps): React.ReactElement {
  let content = children;
  if (enableDebugger || viewControls) {
    content = (
      <ViewControls debugger={enableDebugger} viewControls={viewControls}>
        {content}
      </ViewControls>
    );
  }
  return (
    <StrictMode>
      <ThemeProvider colorScheme={colorScheme}>{content}</ThemeProvider>
    </StrictMode>
  );
}

/** @deprecated Use native v2 `CallToolResult`. Removed in mcp-use v3. */
export interface CallToolResponse extends CallToolResult {
  /** Joined text content convenience field. */
  result: string;
}

/** @deprecated Use native v2 `SafeAreaInsets`. Removed in mcp-use v3. */
export interface SafeArea {
  /** Host safe-area insets. */
  insets: SafeAreaInsets;
}

/** @deprecated Use native v2 host context. Removed in mcp-use v3. */
export interface UserAgent {
  /** Coarse device category. */
  device: { type: "mobile" | "tablet" | "desktop" | "unknown" };
  /** Input capabilities. */
  capabilities: { hover: boolean; touch: boolean };
}

/**
 * Common v1 `useWidget()` return surface.
 *
 * @deprecated Use focused native v2 hooks such as `useToolContext`,
 * `useHostContext`, and `useCallTool`. Removed in mcp-use v3.
 */
interface UseWidgetResultBase<
  TState = UnknownObject,
  TOutput = UnknownObject,
  TMetadata = UnknownObject,
  TToolInput = UnknownObject,
> {
  /** Complete or partial tool input. */
  toolInput: TToolInput;
  /** Structured tool output, or null while pending/error. */
  output: TOutput | null;
  /** Tool result metadata. */
  metadata: TMetadata | null;
  /** Locally cached model-visible widget state. */
  state: TState | null;
  /** Update model-visible widget state. */
  setState(
    state: TState | ((previous: TState | null) => TState)
  ): Promise<void>;
  /** Active host theme. */
  theme: Theme;
  /** Current display mode. */
  displayMode: DisplayMode;
  /** Host safe-area wrapper. */
  safeArea: SafeArea;
  /** Maximum host height, or zero when unbounded. */
  maxHeight: number;
  /** Maximum host width. */
  maxWidth?: number;
  /** v1 device summary. */
  userAgent: UserAgent;
  /** Host locale. */
  locale: string;
  /** Host timezone. */
  timeZone: string;
  /** Public MCP origin exposed inside the sandbox. */
  mcp_url: string;
  /** Call any server tool through the native MCP Apps bridge. */
  callTool(name: string, args: UnknownObject): Promise<CallToolResponse>;
  /** Send a follow-up user message. */
  sendFollowUpMessage(
    content: string | Array<{ type: string; [key: string]: unknown }>
  ): Promise<void>;
  /** Ask the host to open an external URL. */
  openExternal(href: string): void;
  /** Request a host display mode. */
  requestDisplayMode(mode: DisplayMode): Promise<{ mode: DisplayMode }>;
  /** Whether the native MCP Apps bridge is connected. */
  isAvailable: boolean;
  /** Best-effort partial input while pending. */
  partialToolInput: Partial<TToolInput> | null;
  /** Whether partial input is currently available. */
  isStreaming: boolean;
  /** Connected host identity. */
  hostInfo?: { name: string; version: string };
  /** Connected host capabilities. */
  hostCapabilities?: UnknownObject;
  /** Raw native host context. */
  hostContext?: UnknownObject;
}

/**
 * Common v1 `useWidget()` return surface. `isPending` narrows `props` exactly
 * as it did in v1, so unchanged widgets can safely render required props.
 *
 * @deprecated Use focused native v2 hooks. Removed in mcp-use v3.
 */
export type UseWidgetResult<
  TProps = UnknownObject,
  TState = UnknownObject,
  TOutput = UnknownObject,
  TMetadata = UnknownObject,
  TToolInput = UnknownObject,
> = UseWidgetResultBase<TState, TOutput, TMetadata, TToolInput> &
  (
    | { isPending: true; props: Partial<TProps> }
    | { isPending: false; props: TProps }
  );

/**
 * v1 all-in-one widget hook implemented from the native v2 runtime channels.
 *
 * @deprecated Use focused native v2 hooks from `mcp-use/react`. Removed in
 * mcp-use v3.
 */
export function useWidget<
  TProps = UnknownObject,
  TState = UnknownObject,
  TOutput = UnknownObject,
  TMetadata = UnknownObject,
  TToolInput = UnknownObject,
>(
  defaultProps?: TProps
): UseWidgetResult<TProps, TState, TOutput, TMetadata, TToolInput> {
  const runtime = useViewRuntime();
  const tool = useToolContext();
  const host = useHostContext();
  const display = useDisplayMode();
  const [state, setLocalState] = useState<TState | null>(null);

  const structured =
    tool.status === "ready" && isRecord(tool.toolOutput)
      ? tool.toolOutput
      : undefined;
  const input = isRecord(tool.toolInput) ? tool.toolInput : {};
  const props = useMemo(
    () => ({
      ...(isRecord(defaultProps) ? (defaultProps as UnknownObject) : {}),
      ...input,
      ...(structured ?? {}),
    }),
    [defaultProps, input, structured]
  ) as TProps | Partial<TProps>;

  const callTool = useCallback(
    async (name: string, args: UnknownObject): Promise<CallToolResponse> => {
      const result = await runtime.callServerTool({ name, arguments: args });
      return {
        ...result,
        result: result.content
          .flatMap((block) =>
            block.type === "text" && "text" in block ? [block.text] : []
          )
          .join("\n"),
      };
    },
    [runtime]
  );

  const setState = useCallback(
    async (next: TState | ((previous: TState | null) => TState)) => {
      const resolved =
        typeof next === "function"
          ? (next as (previous: TState | null) => TState)(state)
          : next;
      setLocalState(resolved);
      const app = await runtime.connect();
      if (app.getHostCapabilities()?.updateModelContext !== undefined) {
        await app.updateModelContext({
          content: [{ type: "text", text: JSON.stringify(resolved) }],
          structuredContent: resolved as UnknownObject,
        });
      }
    },
    [runtime, state]
  );

  const sendFollowUpMessage = useCallback(
    async (
      content: string | Array<{ type: string; [key: string]: unknown }>
    ) => {
      await runtime.sendMessage({
        role: "user",
        content:
          typeof content === "string"
            ? [{ type: "text", text: content }]
            : (content as Parameters<typeof runtime.sendMessage>[0]["content"]),
      });
    },
    [runtime]
  );

  const openExternal = useCallback(
    (href: string) => {
      void runtime.openLink({ url: href });
    },
    [runtime]
  );

  const requestDisplayMode = useCallback(
    async (mode: DisplayMode) => {
      await display.requestDisplayMode({ mode });
      return { mode };
    },
    [display]
  );

  const pendingInput =
    tool.status === "pending" && Object.keys(input).length > 0;
  const browserPlatform = host.platform === "mobile" ? "mobile" : "desktop";
  const publicUrl =
    typeof window === "undefined"
      ? ""
      : ((window as unknown as { __mcpPublicUrl?: string }).__mcpPublicUrl ??
        "");

  return {
    props,
    isPending: tool.status === "pending",
    toolInput: input as TToolInput,
    output: (structured as TOutput | undefined) ?? null,
    metadata:
      tool.status === "ready" || tool.status === "error"
        ? ((tool.meta as TMetadata | undefined) ?? null)
        : null,
    state,
    setState,
    theme: host.theme,
    displayMode: host.displayMode,
    safeArea: { insets: host.safeArea },
    maxHeight: host.maxHeight ?? 0,
    ...(host.maxWidth !== undefined && { maxWidth: host.maxWidth }),
    userAgent: {
      device: { type: browserPlatform },
      capabilities: {
        hover:
          typeof window !== "undefined" &&
          window.matchMedia("(hover: hover)").matches,
        touch: typeof navigator !== "undefined" && navigator.maxTouchPoints > 0,
      },
    },
    locale: host.locale,
    timeZone: host.timeZone,
    mcp_url: publicUrl,
    callTool,
    sendFollowUpMessage,
    openExternal,
    requestDisplayMode,
    isAvailable: host.isAvailable,
    partialToolInput: pendingInput ? (input as Partial<TToolInput>) : null,
    isStreaming: pendingInput,
    ...(host.hostInfo !== undefined && { hostInfo: host.hostInfo }),
    ...(host.hostCapabilities !== undefined && {
      hostCapabilities: host.hostCapabilities as UnknownObject,
    }),
    ...(host.hostContext !== undefined && {
      hostContext: host.hostContext as UnknownObject,
    }),
  } as UseWidgetResult<TProps, TState, TOutput, TMetadata, TToolInput>;
}

/**
 * Read v1 widget props.
 *
 * @deprecated Use native v2 `useToolContext`. Removed in mcp-use v3.
 */
export function useWidgetProps<TProps = UnknownObject>(
  defaultProps?: TProps
): Partial<TProps> {
  return useWidget<TProps>(defaultProps).props as Partial<TProps>;
}

/**
 * Read the v1 widget theme.
 *
 * @deprecated Use native v2 `useViewTheme`. Removed in mcp-use v3.
 */
export function useWidgetTheme(): Theme {
  return useWidget().theme;
}

/**
 * Read and update v1 widget state.
 *
 * @deprecated Use native v2 model-context APIs. Removed in mcp-use v3.
 */
export function useWidgetState<TState>(
  defaultState?: TState
): readonly [
  TState | null,
  (state: TState | ((previous: TState | null) => TState)) => Promise<void>,
] {
  const widget = useWidget<UnknownObject, TState>();
  useEffect(() => {
    if (
      widget.state === null &&
      defaultState !== undefined &&
      widget.isAvailable
    ) {
      void widget.setState(defaultState);
    }
  }, [defaultState, widget]);
  return [widget.state, widget.setState] as const;
}

/**
 * v1 name for native v2 `ViewControls`.
 *
 * @deprecated Use `ViewControls`. Removed in mcp-use v3.
 */
export const WidgetControls = ViewControls;

function isRecord(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
