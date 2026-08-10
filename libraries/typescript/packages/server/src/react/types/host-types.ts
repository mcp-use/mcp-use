import type {
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

/**
 * Mobile safe area boundaries in pixels (vendored from the MCP Apps spec).
 */
export type SafeAreaInsets = NonNullable<McpUiHostContext["safeAreaInsets"]>;

/**
 * Host application identity from the initialization handshake.
 */
export type HostInfo = {
  /** Host product name. */
  name: string;
  /** Host product version. */
  version: string;
};

/**
 * Capabilities the host advertised during initialization.
 */
export type HostCapabilities = McpUiHostCapabilities;

/**
 * Rich host environment context (theme, locale, display mode, …).
 */
export type HostContext = McpUiHostContext;

/**
 * How the host surfaces the view iframe.
 */
export type DisplayMode = "inline" | "fullscreen" | "pip";
