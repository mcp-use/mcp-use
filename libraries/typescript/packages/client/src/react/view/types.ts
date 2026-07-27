import type {
  McpUiDownloadFileRequest,
  McpUiDownloadFileResult,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiResourceCsp,
  McpUiResourcePermissions,
  McpUiSupportedContentBlockModalities,
} from "./ext-apps-bridge.js";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  CreateMessageResultWithTools,
  Tool,
} from "@modelcontextprotocol/client";

export type {
  McpUiDownloadFileRequest,
  McpUiDownloadFileResult,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiResourceCsp,
  McpUiResourcePermissions,
  McpUiSupportedContentBlockModalities,
};
import type { Transport } from "@modelcontextprotocol/client";
import type { ReactNode } from "react";

/** Display mode requested by an MCP App. */
export type ViewDisplayMode = "inline" | "pip" | "fullscreen";

/** Policy used to enforce an MCP App's declared content security policy. */
export type ViewCspMode = "permissive" | "widget-declared";

/** Host operations and server metadata available to a live MCP App. */
export interface ViewConnection {
  /** Calls an MCP server tool. */
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    options?: { timeout?: number; resetTimeoutOnProgress?: boolean }
  ) => Promise<unknown>;
  /** Reads an MCP resource by URI. */
  readResource: (uri: string) => Promise<unknown>;
  /** Tools available to the host, including app visibility metadata. */
  tools?: readonly {
    /** Tool name. */
    name: string;
    /** Optional tool metadata. */
    _meta?: {
      /** MCP App-specific tool metadata. */
      ui?: {
        /** Surfaces allowed to invoke or receive the tool. */
        visibility?: readonly ("model" | "app")[];
      };
    };
  }[];
  /** Resources available to the host. */
  resources?: readonly {
    /** Resource URI. */
    uri: string;
    /** Optional resource metadata. */
    _meta?: {
      /** MCP App-specific resource metadata. */
      ui?: unknown;
    };
  }[];
}

/** Live or preloaded content used to initialize a {@link ViewRenderer}. */
export type ViewRendererSource =
  | {
      /** Selects live resource resolution. */
      kind: "live";
      /** MCP connection used to read the resource and call tools. */
      connection: ViewConnection;
      /** URI of the MCP App resource to load. */
      resourceUri: string;
    }
  | {
      /** Selects preloaded HTML rendering. */
      kind: "preloaded";
      /** Complete HTML document to render. */
      html: string;
      /** CSP declared for the preloaded document. */
      csp?: McpUiResourceCsp;
      /** Browser permissions requested by the preloaded document. */
      permissions?: McpUiResourcePermissions;
      /** Whether the preloaded app prefers visible host borders. */
      prefersBorder?: boolean;
    };

/** Normalized HTML, CSP, permissions, and MIME metadata for a rendered view. */
export type ResolvedViewResource = {
  /** HTML document rendered in the sandbox. */
  html: string;
  /** CSP declared by the resource before host policy is applied. */
  declaredCsp: McpUiResourceCsp | undefined;
  /** CSP enforced by the host, if any. */
  csp: McpUiResourceCsp | undefined;
  /** Browser permissions requested by the resource. */
  permissions: McpUiResourcePermissions | undefined;
  /** Whether the app prefers a visible host border. */
  prefersBorder: boolean;
  /** MIME type reported by the resource. */
  mimeType: string | undefined;
  /** Whether the MIME type is the MCP App resource media type. */
  mimeTypeValid: boolean;
  /** MIME validation warning, or `null` for a valid resource. */
  mimeTypeWarning: string | null;
};

/** Browser CSP violation observed while an MCP App is running. */
export type ViewCspViolation = {
  /** CSP directive reported by the browser. */
  directive: string;
  /** Effective CSP directive reported by the browser. */
  effectiveDirective?: string;
  /** URI blocked by the policy. */
  blockedUri: string;
  /** Source file associated with the violation. */
  sourceFile?: string | null;
  /** Source line associated with the violation. */
  lineNumber?: number | null;
  /** Source column associated with the violation. */
  columnNumber?: number | null;
  /** Original policy text reported by the browser. */
  originalPolicy?: string;
  /** Unix timestamp in milliseconds when the violation occurred. */
  timestamp: number;
};

/** App-visible tools and the function used to call them. */
export type ViewAppToolConnection = {
  /** Tools available to the app. */
  tools: Tool[];
  /** Calls an app-visible tool. */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/** Lifecycle stage reported by a rendered MCP App. */
export type ViewLifecycleStatus =
  | "resolving"
  | "sandbox-loading"
  | "connecting"
  | "initialized"
  | "ready"
  | "tearing-down"
  | "closed"
  | "error";

/** Lifecycle update emitted by {@link ViewRenderer}. */
export type ViewLifecycleEvent = {
  /** Current lifecycle stage. */
  status: ViewLifecycleStatus;
  /** Error message when `status` is `"error"`. */
  error?: string;
};

/** Props accepted by {@link ViewRenderer}. */
export interface ViewRendererProps {
  /** Stable identifier for the view instance. */
  viewId: string;
  /** Live resource or preloaded HTML to render. */
  source: ViewRendererSource;
  /** Sandbox page URL or function that derives one from the resolved resource. */
  sandboxUrl?: URL | ((resolved: ResolvedViewResource) => URL);
  /** Tool associated with the view. */
  toolName?: string;
  /** Complete tool input forwarded to the app. */
  toolInput?: Record<string, unknown>;
  /** Tool result forwarded to the app. */
  toolOutput?: unknown;
  /** Partial streaming tool input forwarded to the app. */
  partialToolInput?: Record<string, unknown>;
  /** String-valued custom properties forwarded to the app. */
  customProps?: Record<string, string>;
  /** Whether the associated tool call was cancelled. */
  cancelled?: boolean;
  /** Host identity advertised to the app. */
  hostInfo?: {
    /** Stable host name. */
    name: string;
    /** Host version. */
    version: string;
  };
  /** Initial host context sent to the app. */
  hostContext?: McpUiHostContext;
  /** Explicit host capability overrides. */
  hostCapabilities?: Partial<McpUiHostCapabilities>;
  /** Content modalities accepted by the host's message handler. */
  messageCapabilities?: McpUiSupportedContentBlockModalities;
  /** Content modalities accepted by the model-context handler. */
  modelContextCapabilities?: McpUiSupportedContentBlockModalities;
  /** CSP enforcement mode. Defaults to `"permissive"`. */
  cspMode?: ViewCspMode;
  /** Initial display mode. Defaults to `"inline"`. */
  displayMode?: ViewDisplayMode;
  /** Called when the app requests a supported display mode. */
  onDisplayModeChange?: (mode: ViewDisplayMode) => void;
  /** Maximum inline view width in pixels. */
  inlineMaxWidth?: number;
  /** Whether to hide the built-in view chrome. */
  chromeless?: boolean;
  /** Handles content the app sends to the conversation. */
  onMessage?: (content: unknown[]) => void | Promise<void>;
  /** Handles sampling requests from the app. */
  onSamplingRequest?: (
    params: CreateMessageRequest["params"]
  ) => Promise<CreateMessageResult | CreateMessageResultWithTools>;
  /** Handles file-download requests from the app. */
  onDownloadFile?: (
    params: McpUiDownloadFileRequest["params"]
  ) => Promise<McpUiDownloadFileResult>;
  /** Receives the current app-visible tool connection. */
  onAppToolsChanged?: (connection: ViewAppToolConnection | null) => void;
  /** Handles model-context updates from the app. */
  onModelContextUpdate?: (ctx: {
    content?: unknown;
    structuredContent?: unknown;
  }) => void | Promise<void>;
  /** Handles structured log entries from the app. */
  onLog?: (entry: { level: string; data: unknown }) => void;
  /** Called when the app signals that it is ready. */
  onReady?: () => void;
  /** Called for each view lifecycle transition. */
  onLifecycleChange?: (event: ViewLifecycleEvent) => void;
  /** Called when view initialization or runtime handling fails. */
  onError?: (message: string) => void;
  /** Called when the browser reports a CSP violation. */
  onCspViolation?: (violation: ViewCspViolation) => void;
  /** Called after a live or preloaded resource is normalized. */
  onResourceResolved?: (resolved: ResolvedViewResource) => void;
  /** Wraps the host transport before it is connected to the app bridge. */
  wrapTransport?: (transport: Transport, viewId: string) => Transport;
  /** Timeout in milliseconds for app-initiated tool calls. Defaults to `600000`. */
  toolCallTimeout?: number;
  /** Dev mock of ChatGPT file APIs for local hosts (inspector). Default false. */
  mockOpenAiFileApis?: boolean;
  /** Fired when the guest reports inline height via ui/notifications/size-changed. */
  onInlineHeightChange?: (height: number) => void;
  /** Inspector-only chrome shown above the iframe in fullscreen display mode. */
  fullscreenHeader?: {
    /** Header title. */
    title: string;
    /** Optional header icon URL. */
    iconUrl?: string | null;
  };
  /** Optional host close control for fullscreen (e.g. shared Button + icon). */
  renderFullscreenClose?: (props: {
    onClick: () => void;
    "data-testid": string;
    "aria-label": string;
  }) => ReactNode;
  /** Additional class name applied to the view container. */
  className?: string;
  /** Test identifier applied to the view container. */
  testId?: string;
  /** Status text shown while the associated tool is running. */
  invoking?: string;
  /** Status text shown after the associated tool completes. */
  invoked?: string;
}
