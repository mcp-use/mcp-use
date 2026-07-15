import type {
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiResourceCsp,
  McpUiResourcePermissions,
} from "./ext-apps-bridge.js";

export type {
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiResourceCsp,
  McpUiResourcePermissions,
};
import type { Transport } from "@modelcontextprotocol/client";

export type ViewDisplayMode = "inline" | "pip" | "fullscreen";

export type ViewCspMode = "permissive" | "widget-declared";

export interface ViewConnection {
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    options?: { timeout?: number; resetTimeoutOnProgress?: boolean }
  ) => Promise<unknown>;
  readResource: (uri: string) => Promise<unknown>;
  resources?: readonly { uri: string; _meta?: { ui?: unknown } }[];
}

export type ViewRendererSource =
  | {
      kind: "live";
      connection: ViewConnection;
      resourceUri: string;
    }
  | {
      kind: "preloaded";
      html: string;
      csp?: McpUiResourceCsp;
      permissions?: McpUiResourcePermissions;
      prefersBorder?: boolean;
    };

export type ResolvedViewResource = {
  html: string;
  declaredCsp: McpUiResourceCsp | undefined;
  csp: McpUiResourceCsp | undefined;
  permissions: McpUiResourcePermissions | undefined;
  prefersBorder: boolean;
  mimeType: string | undefined;
  mimeTypeValid: boolean;
  mimeTypeWarning: string | null;
};

export type ViewCspViolation = {
  directive: string;
  effectiveDirective?: string;
  blockedUri: string;
  sourceFile?: string | null;
  lineNumber?: number | null;
  columnNumber?: number | null;
  originalPolicy?: string;
  timestamp: number;
};

export interface ViewRendererProps {
  viewId: string;
  source: ViewRendererSource;
  sandboxUrl?: URL | ((resolved: ResolvedViewResource) => URL);
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  partialToolInput?: Record<string, unknown>;
  customProps?: Record<string, string>;
  cancelled?: boolean;
  hostInfo?: { name: string; version: string };
  hostContext?: McpUiHostContext;
  hostCapabilities?: Partial<McpUiHostCapabilities>;
  cspMode?: ViewCspMode;
  displayMode?: ViewDisplayMode;
  onDisplayModeChange?: (mode: ViewDisplayMode) => void;
  inlineMaxWidth?: number;
  chromeless?: boolean;
  onMessage?: (content: unknown[]) => void;
  onModelContextUpdate?: (ctx: {
    content?: unknown;
    structuredContent?: unknown;
  }) => void;
  onLog?: (entry: { level: string; data: unknown }) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  onCspViolation?: (violation: ViewCspViolation) => void;
  onResourceResolved?: (resolved: ResolvedViewResource) => void;
  wrapTransport?: (transport: Transport, viewId: string) => Transport;
  toolCallTimeout?: number;
  className?: string;
  testId?: string;
  invoking?: string;
  invoked?: string;
}
