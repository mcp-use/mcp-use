/**
 * Standalone Adaptor
 *
 * Adaptor for standalone mode (Inspector, development, testing).
 * Parses props from URL query parameters and makes direct HTTP calls.
 *
 * Communication Pattern:
 * 1. Widget loads with mcpUseParams in URL
 * 2. Props parsed from URL query string
 * 3. No real-time updates (static props)
 * 4. Tool calls go directly to MCP server via HTTP
 *
 * This mode is primarily used for:
 * - mcp-use Inspector debugging
 * - Local development without a host
 * - Testing widgets in isolation
 */

import type {
  CallToolResponse,
  DisplayMode,
  SafeArea,
  Theme,
  UserAgent,
} from "../widget-types.js";
import type { WidgetHostAdaptor, HostType } from "./types.js";

/**
 * URL params structure passed via mcpUseParams query parameter
 */
interface StandaloneUrlParams {
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  toolId?: string;
  props?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Local storage key for widget state persistence
 */
const WIDGET_STATE_KEY = "mcp-use-widget-state";

export class StandaloneAdaptor implements WidgetHostAdaptor {
  readonly hostType: HostType = "standalone";

  private parsedParams: StandaloneUrlParams | null = null;
  private widgetState: unknown | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    this.parseUrlParams();
    this.loadPersistedState();
  }

  /**
   * Parse mcpUseParams from URL query string
   */
  private parseUrlParams(): void {
    if (typeof window === "undefined") return;

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const mcpUseParams = urlParams.get("mcpUseParams");

      if (mcpUseParams) {
        this.parsedParams = JSON.parse(mcpUseParams);
      }
    } catch (error) {
      console.warn("[StandaloneAdaptor] Failed to parse mcpUseParams:", error);
    }
  }

  /**
   * Load persisted widget state from localStorage
   */
  private loadPersistedState(): void {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem(WIDGET_STATE_KEY);
      if (stored) {
        this.widgetState = JSON.parse(stored);
      }
    } catch (error) {
      console.warn(
        "[StandaloneAdaptor] Failed to load persisted state:",
        error
      );
    }
  }

  /**
   * Persist widget state to localStorage
   */
  private persistState(): void {
    if (typeof window === "undefined") return;

    try {
      if (this.widgetState !== null) {
        localStorage.setItem(
          WIDGET_STATE_KEY,
          JSON.stringify(this.widgetState)
        );
      } else {
        localStorage.removeItem(WIDGET_STATE_KEY);
      }
    } catch (error) {
      console.warn("[StandaloneAdaptor] Failed to persist state:", error);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((callback) => callback());
  }

  /**
   * Get the MCP server base URL from injected globals
   */
  private getServerBaseUrl(): string {
    if (typeof window !== "undefined" && window.__mcpPublicUrl) {
      // Remove the /mcp-use/public suffix to get the base server URL
      return window.__mcpPublicUrl.replace(/\/mcp-use\/public$/, "");
    }
    return "";
  }

  isAvailable(): boolean {
    // Standalone is available when not in iframe and no window.openai
    return (
      typeof window !== "undefined" &&
      window.parent === window &&
      !window.openai
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // State Access
  // ─────────────────────────────────────────────────────────────────

  getToolInput<T>(): T | undefined {
    return this.parsedParams?.toolInput as T | undefined;
  }

  getToolOutput<T>(): T | null {
    return (this.parsedParams?.toolOutput as T | null) ?? null;
  }

  getToolResponseMetadata<T>(): T | null {
    // In standalone mode, metadata might be in the props or passed directly
    const metadata = this.parsedParams?.metadata;
    if (metadata) {
      return metadata as T;
    }

    // Build metadata from props if available
    const props = this.parsedParams?.props;
    if (props) {
      return { "mcp-use/props": props } as T;
    }

    return null;
  }

  getWidgetState<T>(): T | null {
    return this.widgetState as T | null;
  }

  getTheme(): Theme {
    // Check for theme preference in system
    if (typeof window !== "undefined") {
      const prefersDark = window.matchMedia?.(
        "(prefers-color-scheme: dark)"
      ).matches;
      return prefersDark ? "dark" : "light";
    }
    return "light";
  }

  getDisplayMode(): DisplayMode {
    return "inline";
  }

  getLocale(): string {
    if (typeof navigator !== "undefined") {
      return navigator.language || "en";
    }
    return "en";
  }

  getMaxHeight(): number {
    if (typeof window !== "undefined") {
      return window.innerHeight;
    }
    return 600;
  }

  getSafeArea(): SafeArea {
    return {
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    };
  }

  getUserAgent(): UserAgent {
    return {
      device: { type: "desktop" },
      capabilities: { hover: true, touch: false },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResponse> {
    const baseUrl = this.getServerBaseUrl();

    if (!baseUrl) {
      console.warn(
        "[StandaloneAdaptor] No server base URL available for tool call"
      );
      return {
        content: [
          {
            type: "text",
            text: `Tool call "${name}" not available in standalone mode without server connection`,
          },
        ],
        isError: true,
      };
    }

    try {
      const response = await fetch(`${baseUrl}/mcp/tools/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("[StandaloneAdaptor] Tool call failed:", error);
      return {
        content: [
          {
            type: "text",
            text: `Tool call failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  async sendMessage(message: string): Promise<void> {
    console.warn(
      "[StandaloneAdaptor] sendMessage not available in standalone mode. Message:",
      message
    );
  }

  openLink(href: string): void {
    if (typeof window !== "undefined") {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }

  async requestDisplayMode(
    mode: DisplayMode
  ): Promise<{ mode: DisplayMode }> {
    console.warn(
      "[StandaloneAdaptor] requestDisplayMode not available in standalone mode"
    );
    return { mode: "inline" };
  }

  async setWidgetState<T>(state: T): Promise<void> {
    this.widgetState = state;
    this.persistState();
    this.notifyListeners();
  }

  async notifyHeight(_height: number): Promise<void> {
    // No-op in standalone mode - no host to notify
  }

  // ─────────────────────────────────────────────────────────────────
  // Subscriptions
  // ─────────────────────────────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Manually update tool input (useful for testing)
   */
  setToolInput(input: Record<string, unknown>): void {
    if (!this.parsedParams) {
      this.parsedParams = {};
    }
    this.parsedParams.toolInput = input;
    this.notifyListeners();
  }

  /**
   * Manually update props (useful for testing)
   */
  setProps(props: Record<string, unknown>): void {
    if (!this.parsedParams) {
      this.parsedParams = {};
    }
    this.parsedParams.props = props;
    this.notifyListeners();
  }
}
