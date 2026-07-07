import type {
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

/**
 * Mobile safe area boundaries in pixels (vendored from the MCP Apps spec).
 */
export type SafeAreaInsets = NonNullable<
  McpUiHostContext["safeAreaInsets"]
>;

/**
 * Host application identity from the initialization handshake.
 */
export type HostInfo = {
  name: string;
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
