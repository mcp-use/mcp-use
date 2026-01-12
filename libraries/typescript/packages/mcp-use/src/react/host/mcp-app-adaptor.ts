/**
 * MCP App Adaptor
 *
 * Adaptor for MCP Apps standard (SEP-1865) host environment.
 * Uses @modelcontextprotocol/ext-apps for communication via PostMessage.
 *
 * Communication Pattern:
 * 1. Widget loads and creates App instance
 * 2. App connects to window.parent via PostMessageTransport
 * 3. Host sends notifications (tool-input, tool-result, host-context-changed)
 * 4. Adaptor updates internal state and notifies subscribers
 * 5. Widget calls app methods for actions
 *
 * Key Differences from Apps SDK:
 * - Explicit connection management (vs auto-injected window.openai)
 * - Notification handlers (vs openai:set_globals events)
 * - Different method signatures (e.g., callServerTool vs callTool)
 */

import type {
  CallToolResponse,
  DisplayMode,
  SafeArea,
  Theme,
  UserAgent,
} from "../widget-types.js";
import type { WidgetHostAdaptor, HostType } from "./types.js";

// Types from @modelcontextprotocol/ext-apps
// We define these locally to avoid hard dependency at compile time
// The actual App class is loaded dynamically when needed
interface McpAppToolInputParams {
  name?: string;
  arguments?: Record<string, unknown>;
}

interface McpAppToolResultParams {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

interface McpAppHostContext {
  theme?: "light" | "dark";
  locale?: string;
  displayMode?: "inline" | "fullscreen" | "picture-in-picture";
  viewport?: {
    maxHeight?: number;
    maxWidth?: number;
  };
  safeAreaInsets?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  platform?: string;
  deviceCapabilities?: {
    hover?: boolean;
    touch?: boolean;
  };
}

interface McpApp {
  connect(): Promise<void>;
  close(): void;
  callServerTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    structuredContent?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
    isError?: boolean;
  }>;
  sendMessage(params: {
    content: Array<{ type: string; text?: string }>;
    role: "user";
  }): Promise<{ isError?: boolean }>;
  openLink(params: { url: string }): Promise<{ isError?: boolean }>;
  sendLog(params: {
    level: string;
    data: unknown;
    logger?: string;
  }): Promise<void>;
  requestDisplayMode(params: {
    mode: "inline" | "fullscreen" | "picture-in-picture";
  }): Promise<{ mode: string }>;
  sendSizeChanged(params: { width?: number; height?: number }): Promise<void>;
  getHostContext(): McpAppHostContext | undefined;
  ontoolinput: ((params: McpAppToolInputParams) => void) | undefined;
  ontoolresult: ((params: McpAppToolResultParams) => void) | undefined;
  onhostcontextchanged: ((params: McpAppHostContext) => void) | undefined;
}

/**
 * Internal state managed by the MCP App adaptor
 */
interface McpAppState {
  toolInput: Record<string, unknown> | null;
  toolResult: McpAppToolResultParams | null;
  hostContext: McpAppHostContext;
  widgetState: unknown | null;
  isConnected: boolean;
}

export class McpAppAdaptor implements WidgetHostAdaptor {
  readonly hostType: HostType = "mcp-app";

  private app: McpApp | null = null;
  private state: McpAppState = {
    toolInput: null,
    toolResult: null,
    hostContext: {},
    widgetState: null,
    isConnected: false,
  };
  private listeners = new Set<() => void>();
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Lazy initialization - actual connection happens when needed
  }

  /**
   * Initialize the MCP App connection
   * This is called lazily when the adaptor is first used
   */
  private async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Dynamically import the ext-apps package
      const { App } = await import("@modelcontextprotocol/ext-apps");

      // Create app instance
      this.app = new App(
        { name: "mcp-use-widget", version: "1.0.0" },
        {}, // capabilities
        { autoResize: true }
      ) as McpApp;

      // Set up notification handlers before connecting
      this.app.ontoolinput = (params) => {
        this.state.toolInput = params.arguments ?? null;
        this.notifyListeners();
      };

      this.app.ontoolresult = (params) => {
        this.state.toolResult = params;
        this.notifyListeners();
      };

      this.app.onhostcontextchanged = (params) => {
        this.state.hostContext = { ...this.state.hostContext, ...params };
        this.notifyListeners();
      };

      // Connect to host
      await this.app.connect();
      this.state.isConnected = true;

      // Get initial host context
      const context = this.app.getHostContext();
      if (context) {
        this.state.hostContext = context;
      }

      this.notifyListeners();
    } catch (error) {
      console.error("[McpAppAdaptor] Failed to initialize:", error);
      this.state.isConnected = false;
      throw error;
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((callback) => callback());
  }

  isAvailable(): boolean {
    // MCP App is available when we're in an iframe and window.openai is not present
    return (
      typeof window !== "undefined" &&
      window.parent !== window &&
      !window.openai
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // State Access
  // ─────────────────────────────────────────────────────────────────

  getToolInput<T>(): T | undefined {
    return this.state.toolInput as T | undefined;
  }

  getToolOutput<T>(): T | null {
    return (this.state.toolResult?.structuredContent as T | null) ?? null;
  }

  getToolResponseMetadata<T>(): T | null {
    return (this.state.toolResult?._meta as T | null) ?? null;
  }

  getWidgetState<T>(): T | null {
    return this.state.widgetState as T | null;
  }

  getTheme(): Theme {
    return this.state.hostContext.theme ?? "light";
  }

  getDisplayMode(): DisplayMode {
    const mode = this.state.hostContext.displayMode;
    if (mode === "picture-in-picture") return "pip";
    if (mode === "fullscreen") return "fullscreen";
    return "inline";
  }

  getLocale(): string {
    return this.state.hostContext.locale ?? "en";
  }

  getMaxHeight(): number {
    return this.state.hostContext.viewport?.maxHeight ?? 600;
  }

  getSafeArea(): SafeArea {
    const insets = this.state.hostContext.safeAreaInsets;
    return {
      insets: {
        top: insets?.top ?? 0,
        bottom: insets?.bottom ?? 0,
        left: insets?.left ?? 0,
        right: insets?.right ?? 0,
      },
    };
  }

  getUserAgent(): UserAgent {
    const platform = this.state.hostContext.platform;
    const caps = this.state.hostContext.deviceCapabilities;

    return {
      device: {
        type: platform === "web" ? "desktop" : ((platform as any) ?? "unknown"),
      },
      capabilities: {
        hover: caps?.hover ?? true,
        touch: caps?.touch ?? false,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResponse> {
    await this.initialize();
    if (!this.app) {
      throw new Error("MCP App not initialized");
    }

    const result = await this.app.callServerTool({ name, arguments: args });

    return {
      content: result.content,
      isError: result.isError,
    };
  }

  async sendMessage(message: string): Promise<void> {
    await this.initialize();
    if (!this.app) {
      throw new Error("MCP App not initialized");
    }

    await this.app.sendMessage({
      content: [{ type: "text", text: message }],
      role: "user",
    });
  }

  openLink(href: string): void {
    this.initialize()
      .then(() => {
        if (this.app) {
          this.app.openLink({ url: href });
        }
      })
      .catch((error) => {
        console.error("[McpAppAdaptor] Failed to open link:", error);
        // Fallback to window.open
        window.open(href, "_blank");
      });
  }

  async requestDisplayMode(mode: DisplayMode): Promise<{ mode: DisplayMode }> {
    await this.initialize();
    if (!this.app) {
      throw new Error("MCP App not initialized");
    }

    // Map mcp-use display modes to MCP Apps modes
    const mcpMode =
      mode === "pip"
        ? "picture-in-picture"
        : mode === "fullscreen"
          ? "fullscreen"
          : "inline";

    const result = await this.app.requestDisplayMode({ mode: mcpMode });

    // Map back to mcp-use display mode
    const resultMode =
      result.mode === "picture-in-picture"
        ? "pip"
        : result.mode === "fullscreen"
          ? "fullscreen"
          : "inline";

    return { mode: resultMode as DisplayMode };
  }

  async setWidgetState<T>(state: T): Promise<void> {
    // MCP Apps doesn't have a direct widget state API like Apps SDK
    // Store locally for now - this may need to be enhanced with host support
    this.state.widgetState = state;
    this.notifyListeners();
  }

  async notifyHeight(height: number): Promise<void> {
    await this.initialize();
    if (!this.app) {
      throw new Error("MCP App not initialized");
    }

    await this.app.sendSizeChanged({ height });
  }

  /**
   * Send a log message (MCP Apps specific feature)
   */
  async sendLog(
    level:
      | "error"
      | "alert"
      | "debug"
      | "info"
      | "notice"
      | "warning"
      | "critical"
      | "emergency",
    data: unknown,
    logger?: string
  ): Promise<void> {
    await this.initialize();
    if (!this.app) {
      throw new Error("MCP App not initialized");
    }

    await this.app.sendLog({ level, data, logger });
  }

  // ─────────────────────────────────────────────────────────────────
  // Subscriptions
  // ─────────────────────────────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);

    // Trigger initialization on first subscriber
    if (this.listeners.size === 1 && this.isAvailable()) {
      this.initialize().catch((error) => {
        console.error(
          "[McpAppAdaptor] Background initialization failed:",
          error
        );
      });
    }

    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Get the underlying App instance (for advanced use cases)
   */
  getApp(): McpApp | null {
    return this.app;
  }

  /**
   * Check if the connection is established
   */
  isConnected(): boolean {
    return this.state.isConnected;
  }
}
