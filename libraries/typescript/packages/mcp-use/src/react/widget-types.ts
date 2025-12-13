/**
 * Type definitions for OpenAI Apps SDK window.openai API
 * Based on: https://developers.openai.com/apps-sdk/build/custom-ux
 */

/* global CustomEvent */

export type UnknownObject = Record<string, unknown>;

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
  isError?: boolean;
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
 * Result type for the useWidget hook
 */
export interface UseWidgetResult<
  TProps extends UnknownObject = UnknownObject,
  TOutput extends UnknownObject = UnknownObject,
  TMetadata extends UnknownObject = UnknownObject,
  TState extends UnknownObject = UnknownObject,
  TToolInput extends UnknownObject = UnknownObject,
> {
  // Props and state
  /** Widget props from _meta["mcp-use/props"] (widget-only data, hidden from model) */
  props: TProps;
  /** Original tool input arguments */
  toolInput: TToolInput;
  /** Tool output from the last execution */
  output: TOutput | null;
  /** Response metadata from the tool */
  metadata: TMetadata | null;
  /** Persisted widget state */
  state: TState | null;
  /** Update widget state (persisted and shown to model) */
  setState: (
    state: TState | ((prevState: TState | null) => TState)
  ) => Promise<void>;

  // Layout and theme
  /** Current theme (light/dark) */
  theme: Theme;
  /** Current display mode */
  displayMode: DisplayMode;
  /** Safe area insets for layout */
  safeArea: SafeArea;
  /** Maximum height available */
  maxHeight: number;
  /** User agent information */
  userAgent: UserAgent;
  /** Current locale */
  locale: string;
  /** MCP server base URL for making API requests */
  mcp_url: string;

  // Actions
  /** Call a tool on the MCP server */
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<CallToolResponse>;
  /** Send a follow-up message to the conversation */
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  /** Open an external URL */
  openExternal: (href: string) => void;
  /** Request a different display mode */
  requestDisplayMode: (mode: DisplayMode) => Promise<{ mode: DisplayMode }>;

  /** Whether the widget API is available */
  isAvailable: boolean;
  /** Whether the tool is currently executing (metadata is null) */
  isPending: boolean;
}
