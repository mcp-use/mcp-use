/**
 * Host Adaptor Types
 *
 * Defines the interface for adapting widget communication across different
 * host environments: OpenAI Apps SDK, MCP Apps, and Standalone mode.
 */

import type {
  CallToolResponse,
  DisplayMode,
  SafeArea,
  Theme,
  UserAgent,
} from "../widget-types.js";

/**
 * Host type identifier for runtime environment detection
 *
 * - `apps-sdk`: OpenAI Apps SDK (ChatGPT native widgets)
 * - `mcp-app`: MCP Apps standard (SEP-1865 compliant hosts)
 * - `standalone`: Inspector, development, testing mode
 */
export type HostType = "apps-sdk" | "mcp-app" | "standalone";

/**
 * Global mcpUse configuration that can be injected into the widget HTML
 */
export interface McpUseGlobals {
  /** Explicit host type override (injected by server) */
  hostType?: HostType;
  /** Public URL for assets */
  publicUrl?: string;
}

/**
 * Common interface for host adaptors
 *
 * Each adaptor implements this interface to provide a unified API
 * for widget communication regardless of the host environment.
 */
export interface WidgetHostAdaptor {
  /** Identifies which host environment this adaptor targets */
  readonly hostType: HostType;

  /**
   * Check if this adaptor's host environment is available
   * @returns true if the host is detected and ready
   */
  isAvailable(): boolean;

  // ─────────────────────────────────────────────────────────────────
  // State Access
  // ─────────────────────────────────────────────────────────────────

  /** Get the current tool input arguments */
  getToolInput<T>(): T | undefined;

  /** Get the tool output from the last execution */
  getToolOutput<T>(): T | null;

  /** Get response metadata from the tool (includes mcp-use/props) */
  getToolResponseMetadata<T>(): T | null;

  /** Get the persisted widget state */
  getWidgetState<T>(): T | null;

  /** Get current theme (light/dark) */
  getTheme(): Theme;

  /** Get current display mode */
  getDisplayMode(): DisplayMode;

  /** Get current locale */
  getLocale(): string;

  /** Get maximum available height */
  getMaxHeight(): number;

  /** Get safe area insets for layout */
  getSafeArea(): SafeArea;

  /** Get user agent information */
  getUserAgent(): UserAgent;

  // ─────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────

  /**
   * Call a tool on the MCP server
   * @param name - Tool name
   * @param args - Tool arguments
   */
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResponse>;

  /**
   * Send a follow-up message to the conversation
   * @param message - Message text
   */
  sendMessage(message: string): Promise<void>;

  /**
   * Open an external URL
   * @param href - URL to open
   */
  openLink(href: string): void;

  /**
   * Request a different display mode
   * @param mode - Target display mode
   */
  requestDisplayMode(mode: DisplayMode): Promise<{ mode: DisplayMode }>;

  /**
   * Update persisted widget state
   * @param state - New state to persist
   */
  setWidgetState<T>(state: T): Promise<void>;

  /**
   * Notify host about intrinsic height for auto-sizing
   * @param height - Content height in pixels
   */
  notifyHeight(height: number): Promise<void>;

  // ─────────────────────────────────────────────────────────────────
  // Subscriptions
  // ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to host state changes
   * @param callback - Called when any state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: () => void): () => void;
}

// Extend Window interface to include mcpUse globals
declare global {
  interface Window {
    mcpUse?: McpUseGlobals;
  }
}
