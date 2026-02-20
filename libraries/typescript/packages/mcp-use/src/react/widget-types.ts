/**
 * Type definitions for OpenAI Apps SDK window.openai API
 * Based on: https://developers.openai.com/apps-sdk/build/custom-ux
 */

/* global CustomEvent */

export type UnknownObject = Record<string, unknown>;

/**
 * Registry for tool type definitions. This interface is automatically augmented
 * by the dev server when you use `mcp-use dev`. Type definitions are generated
 * from your tool schemas and written to `.mcp-use/tool-registry.d.ts`.
 *
 * You can also manually augment this interface for custom typing:
 *
 * @example
 * ```typescript
 * // Automatically augmented by mcp-use dev (preferred)
 * // No action needed - just run `mcp-use dev`
 *
 * // Or manually augment for custom typing:
 * declare module "mcp-use/react" {
 *   interface ToolRegistry {
 *     "my-tool": {
 *       input: { query: string };
 *       output: { results: string[] };
 *     };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ToolRegistry {}

export type Theme = "light" | "dark";

export type DisplayMode = "pip" | "inline" | "fullscreen";

export type DeviceType = "mobile" | "tablet" | "desktop" | "unknown";

export type SafeAreaInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type SafeArea = {
  insets: SafeAreaInsets;
};

export type UserAgent = {
  device: { type: DeviceType };
  capabilities: {
    hover: boolean;
    touch: boolean;
  };
};

export type CallToolResponse = {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  result: string; // text content joined as convenience
  _meta?: Record<string, unknown>;
};

export interface OpenAiGlobals<
  ToolInput extends UnknownObject = UnknownObject,
  ToolOutput extends UnknownObject = UnknownObject,
  ToolResponseMetadata extends UnknownObject = UnknownObject,
  WidgetState extends UnknownObject = UnknownObject,
> {
  theme: Theme;
  userAgent: UserAgent;
  locale: string;

  // layout
  maxHeight: number;
  displayMode: DisplayMode;
  safeArea: SafeArea;

  // state
  toolInput: ToolInput;
  toolOutput: ToolOutput | null;
  toolResponseMetadata: ToolResponseMetadata | null;
  widgetState: WidgetState | null;
}

export interface API<WidgetState extends UnknownObject = UnknownObject> {
  /** Calls a tool on your MCP. Returns the full response. */
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<CallToolResponse>;

  /** Triggers a followup turn in the ChatGPT conversation */
  sendFollowUpMessage: (args: { prompt: string }) => Promise<void>;

  /** Opens an external link, redirects web page or mobile app */
  openExternal(payload: { href: string }): void;

  /** For transitioning an app from inline to fullscreen or pip */
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<{
    /**
     * The granted display mode. The host may reject the request.
     * For mobile, PiP is always coerced to fullscreen.
     */
    mode: DisplayMode;
  }>;

  /** Persist widget state that will be shown to the model */
  setWidgetState: (state: WidgetState) => Promise<void>;

  /** Notify OpenAI about intrinsic height changes for auto-sizing */
  notifyIntrinsicHeight: (height: number) => Promise<void>;
}

// Event types
export const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";

export class SetGlobalsEvent extends CustomEvent<{
  globals: Partial<OpenAiGlobals>;
}> {
  readonly type = SET_GLOBALS_EVENT_TYPE;
}

declare global {
  interface Window {
    openai?: API<any> & OpenAiGlobals<any, any, any, any>;
    __getFile?: (filename: string) => string;
    __mcpPublicUrl?: string;
    __mcpPublicAssetsUrl?: string;
  }

  interface WindowEventMap {
    [SET_GLOBALS_EVENT_TYPE]: SetGlobalsEvent;
  }
}

/**
 * Shared fields for the useWidget hook result (everything except props and isPending)
 */
interface UseWidgetResultBase<
  TState = UnknownObject,
  TOutput = UnknownObject,
  TMetadata = UnknownObject,
  TToolInput = UnknownObject,
> {
  /**
   * The arguments the model passed when calling the tool.
   *
   * Delivered via `ui/notifications/tool-input` (SEP-1865) once after the
   * `ui/initialize` handshake completes, or via `window.openai.toolInput` in
   * the ChatGPT Apps SDK. This reflects exactly what the LLM decided to send —
   * useful for displaying a "requested" summary alongside the rendered result.
   */
  toolInput: TToolInput;

  /**
   * The `structuredContent` field from the tool result.
   *
   * This is widget-only data: the LLM only sees the plain-text `content` array
   * from the tool response, not `structuredContent`. Use `output` (i.e. `props`)
   * to pass rich, structured data to the widget without polluting the model context.
   *
   * Delivered via `ui/notifications/tool-result` (SEP-1865) /
   * `window.openai.toolOutput` (Apps SDK). `null` while the tool is still
   * executing (`isPending === true`).
   */
  output: TOutput | null;

  /**
   * The `_meta` object from the tool result.
   *
   * Intended for auxiliary information such as timestamps, cache headers, or
   * API version identifiers. Not included in the model's context window.
   * `null` while the tool is still executing.
   */
  metadata: TMetadata | null;

  /**
   * Persisted widget state that the model can read on future turns.
   *
   * On MCP Apps, calling `setState` sends a `ui/update-model-context` request
   * (SEP-1865) so the updated state is available to the LLM in the next
   * conversation turn. On ChatGPT, it calls `window.openai.setWidgetState`.
   * Use this to keep the model informed about user interactions (selected items,
   * filters, current view, etc.) without requiring an explicit tool call.
   */
  state: TState | null;

  /**
   * Update the persisted widget state.
   *
   * Accepts either a new state value or a functional updater `(prev) => next`.
   * On MCP Apps, sends `ui/update-model-context` (SEP-1865) with the new state
   * so the LLM can reason about it on future turns. On ChatGPT Apps SDK, calls
   * `window.openai.setWidgetState`. Multiple rapid updates before the next user
   * message are deduplicated by the host — only the last value is sent to the
   * model.
   */
  setState: (
    state: TState | ((prevState: TState | null) => TState)
  ) => Promise<void>;

  // Layout and theme

  /**
   * The host's current color-scheme preference.
   *
   * `"light"` or `"dark"`. Changes are notified via
   * `ui/notifications/host-context-changed` (SEP-1865) / `openai:set_globals`
   * (Apps SDK). Use the standardized `--color-*` CSS variables provided by the
   * host for automatic theming, or branch on this value to apply your own
   * styles.
   *
   * @example
   * ```tsx
   * const { theme } = useWidget();
   * return <div data-theme={theme}>…</div>;
   * ```
   */
  theme: Theme;

  /**
   * The current rendering context of the widget.
   *
   * - `"inline"` — default; widget is embedded in the host's content flow.
   * - `"fullscreen"` — widget occupies the full screen or window.
   * - `"pip"` — floating picture-in-picture overlay. On mobile, PiP requests
   *   are coerced to `"fullscreen"` by the host.
   *
   * Changes when the host responds to a `requestDisplayMode` call or when the
   * host initiates a layout change. Updated via
   * `ui/notifications/host-context-changed` (SEP-1865) / `openai:set_globals`
   * (Apps SDK).
   *
   * @see requestDisplayMode
   */
  displayMode: DisplayMode;

  /**
   * Host-provided safe area inset boundaries in pixels.
   *
   * Insets describe the space consumed by OS chrome (notch, home indicator,
   * rounded corners, system bars) on all four sides. Apply these as padding or
   * margin so interactive elements are not hidden behind the OS chrome.
   * From `HostContext.safeAreaInsets` per SEP-1865.
   *
   * @example
   * ```tsx
   * const { safeArea } = useWidget();
   * const style = { paddingBottom: safeArea.insets.bottom };
   * ```
   */
  safeArea: SafeArea;

  /**
   * Maximum height the widget container can grow to, in pixels.
   *
   * When provided, the container is in *flexible* mode: the widget controls its
   * own height up to this ceiling. When omitted (undefined in raw host context),
   * height is unbounded. From `HostContext.containerDimensions.maxHeight`
   * (SEP-1865) / `window.openai.maxHeight` (Apps SDK).
   *
   * Use this to cap scrollable lists or lazy-rendered content so the widget
   * doesn't overflow the host's layout.
   */
  maxHeight: number;

  /**
   * Maximum width the widget container can grow to, in pixels.
   *
   * Behaves the same as `maxHeight` but for the horizontal axis. Only provided
   * by MCP Apps hosts (SEP-1865 `HostContext.containerDimensions.maxWidth`);
   * the ChatGPT Apps SDK does not expose a max-width constraint.
   * `undefined` when unbounded or unavailable.
   */
  maxWidth?: number;

  /**
   * Device type and input-capability flags reported by the host.
   *
   * Use `userAgent.device.type` (`"mobile"`, `"tablet"`, `"desktop"`) to adapt
   * layout density, and `userAgent.capabilities.hover` / `.touch` to decide
   * whether to show hover-only UI elements or touch-friendly hit targets.
   * From `HostContext.platform` and `HostContext.deviceCapabilities` (SEP-1865)
   * / `window.openai.userAgent` (Apps SDK).
   */
  userAgent: UserAgent;

  /**
   * The user's language and region preference as a BCP 47 tag (e.g. `"en-US"`,
   * `"es-ES"`, `"ja-JP"`).
   *
   * Use this to initialize `Intl` formatters, load the correct translation
   * bundle, or set the `lang` attribute on the root element. From
   * `HostContext.locale` (SEP-1865) / `window.openai.locale` (Apps SDK).
   */
  locale: string;

  /**
   * The user's timezone as an IANA identifier (e.g. `"America/New_York"`,
   * `"Europe/Paris"`).
   *
   * Pass to `Intl.DateTimeFormat` when displaying local times. On ChatGPT the
   * Apps SDK does not expose a timezone, so this falls back to the browser's
   * own `Intl.DateTimeFormat().resolvedOptions().timeZone`. From
   * `HostContext.timeZone` (SEP-1865).
   */
  timeZone: string;

  /**
   * Base URL of the MCP server running inside the sandbox.
   *
   * Derived from `window.__mcpPublicUrl`. Use this to make direct HTTP requests
   * to your server (e.g. for REST endpoints or asset URLs) without going through
   * the host's `tools/call` proxy.
   */
  mcp_url: string;

  // Actions

  /**
   * Call any tool registered on the MCP server.
   *
   * Sends a `tools/call` JSON-RPC request via the host. Works for both
   * model-visible tools and app-only tools (`visibility: ["app"]` per SEP-1865)
   * — the latter are hidden from the LLM but callable by the widget. Returns a
   * normalized `CallToolResponse` with `content`, `structuredContent`, `result`
   * (joined text convenience field), and optional `_meta`.
   *
   * @example
   * ```tsx
   * const { callTool } = useWidget();
   * const res = await callTool("refresh_data", { id: 42 });
   * console.log(res.structuredContent);
   * ```
   */
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<CallToolResponse>;

  /**
   * Add a user-role message to the conversation and trigger a new model turn.
   *
   * On MCP Apps, sends a `ui/message` request (SEP-1865) with
   * `role: "user"`. On ChatGPT Apps SDK, calls
   * `window.openai.sendFollowUpMessage`. The host may request user consent
   * before adding the message.
   *
   * Use this to let the widget drive the conversation — for example, when the
   * user selects an item and you want the model to generate a contextual
   * response.
   */
  sendFollowUpMessage: (prompt: string) => Promise<void>;

  /**
   * Ask the host to open a URL in the user's default browser or a new tab.
   *
   * On MCP Apps, sends a `ui/open-link` request (SEP-1865). On ChatGPT Apps
   * SDK, calls `window.openai.openExternal`. The host may deny the request
   * (e.g. policy violation or invalid URL) — errors are logged but not thrown.
   */
  openExternal: (href: string) => void;

  /**
   * Request the host to change the widget's display mode.
   *
   * Sends `ui/request-display-mode` (SEP-1865) /
   * `window.openai.requestDisplayMode` (Apps SDK). The host returns the
   * *actual* granted mode, which may differ from the requested one — always
   * check the response `mode` field. PiP (`"pip"`) is coerced to
   * `"fullscreen"` on mobile by the ChatGPT host.
   *
   * @example
   * ```tsx
   * const { requestDisplayMode } = useWidget();
   * const { mode } = await requestDisplayMode("fullscreen");
   * // mode may be "fullscreen" or the previous mode if rejected
   * ```
   */
  requestDisplayMode: (mode: DisplayMode) => Promise<{ mode: DisplayMode }>;

  /**
   * Whether the widget runtime is connected and ready.
   *
   * `true` when either `window.openai` (ChatGPT Apps SDK) or the MCP Apps
   * `postMessage` bridge (SEP-1865) has successfully initialized. `false` while
   * still connecting, or when the widget is rendered outside a supported host
   * (e.g. during local development via URL params).
   */
  isAvailable: boolean;

  /**
   * Partial tool arguments streamed in real-time while the LLM is still
   * generating them.
   *
   * Delivered via `ui/notifications/tool-input-partial` (SEP-1865). The object
   * is a best-effort parse of the incomplete JSON output: unclosed
   * brackets/braces are automatically closed, so the shape is valid JSON but
   * fields may be missing, incomplete strings, or change in subsequent updates.
   * `null` when the LLM has finished generating arguments or when the host does
   * not support partial streaming.
   *
   * Only available on MCP Apps hosts; always `null` on ChatGPT Apps SDK and URL
   * params fallback.
   *
   * @see isStreaming
   */
  partialToolInput: Partial<TToolInput> | null;

  /**
   * Whether the LLM is currently streaming tool arguments.
   *
   * `true` while `partialToolInput` is non-null and the complete `toolInput`
   * has not yet arrived. Useful for rendering a skeleton or progress indicator
   * before all arguments are known.
   *
   * Becomes `false` once `ui/notifications/tool-input` (the complete arguments)
   * is received. Only `true` on MCP Apps hosts that send
   * `ui/notifications/tool-input-partial`; always `false` on ChatGPT Apps SDK.
   *
   * @see partialToolInput
   */
  isStreaming: boolean;
}

/**
 * Result type for the useWidget hook.
 *
 * Uses a discriminated union on `isPending`:
 * - When `isPending` is `true`, `props` is `Partial<TProps>` (fields may be undefined).
 * - When `isPending` is `false`, `props` is `TProps` (all fields are present).
 *
 * This allows TypeScript to narrow the type after an `if (isPending)` guard:
 * ```tsx
 * const { props, isPending } = useWidget<{ city: string }>();
 * if (isPending) return <Loading />;
 * // props.city is `string` here, not `string | undefined`
 * ```
 */
export type UseWidgetResult<
  TProps = UnknownObject,
  TState = UnknownObject,
  TOutput = UnknownObject,
  TMetadata = UnknownObject,
  TToolInput = UnknownObject,
> = UseWidgetResultBase<TState, TOutput, TMetadata, TToolInput> &
  (
    | {
        /**
         * `true` while the tool is still executing.
         *
         * On MCP Apps, becomes `false` once `ui/notifications/tool-result` is
         * received (SEP-1865). On ChatGPT Apps SDK, becomes `false` once
         * `toolResponseMetadata` is non-null. While `true`, `props` is typed as
         * `Partial<TProps>` — guard on this value before accessing required fields.
         */
        isPending: true;
        /**
         * Widget props — partial while the tool is still executing.
         *
         * Populated from `structuredContent` in the tool result (delivered via
         * `ui/notifications/tool-result` / `window.openai.toolOutput`). Fields
         * may be `undefined` until the tool completes. Guard on `isPending` to
         * narrow the type to the full `TProps` shape.
         */
        props: Partial<TProps>;
      }
    | {
        /**
         * `false` once the tool result has been received and props are fully
         * populated.
         *
         * After this point, `props` is guaranteed to be `TProps` (not partial),
         * so field access is safe without optional chaining.
         */
        isPending: false;
        /**
         * Fully populated widget props from `structuredContent` in the tool result.
         *
         * Widget-only data: the LLM only sees the plain-text `content` array and
         * never `structuredContent`. All required fields of `TProps` are present
         * when `isPending` is `false`.
         */
        props: TProps;
      }
  );
