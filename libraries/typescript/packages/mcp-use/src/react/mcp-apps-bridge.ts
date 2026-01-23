/**
 * MCP Apps Bridge - Lightweight postMessage bridge for MCP Apps protocol (SEP-1865)
 * Handles JSON-RPC communication between widget iframe and MCP Apps host
 */

import type { Theme, DisplayMode } from "./widget-types.js";

// JSON-RPC message types
interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// Host context from ui/initialize response
interface HostContext {
  theme?: Theme;
  displayMode?: DisplayMode;
  containerDimensions?: {
    width?: number;
    height?: number;
    maxWidth?: number;
    maxHeight?: number;
  };
  locale?: string;
  timeZone?: string;
  platform?: "web" | "desktop" | "mobile";
  userAgent?: string;
  deviceCapabilities?: {
    touch?: boolean;
    hover?: boolean;
  };
  safeAreaInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  styles?: {
    variables?: Record<string, string>;
    css?: {
      fonts?: string;
    };
  };
}

interface McpUiInitializeResult {
  protocolVersion: string;
  hostCapabilities?: unknown;
  hostInfo?: {
    name: string;
    version: string;
  };
  hostContext?: HostContext;
}

// Tool notification params
interface ToolInputNotification {
  arguments: Record<string, unknown>;
}

interface ToolResultNotification {
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * Singleton bridge for MCP Apps postMessage communication
 */
class McpAppsBridge {
  private connected = false;
  private requestId = 1;
  private pendingRequests = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private listeners = new Set<(event: MessageEvent) => void>();

  // State
  private toolInput: Record<string, unknown> | null = null;
  private toolOutput: Record<string, unknown> | null = null;
  private hostContext: HostContext | null = null;
  private initialized = false;

  // Event handlers
  private toolInputHandlers = new Set<
    (input: Record<string, unknown>) => void
  >();
  private toolResultHandlers = new Set<
    (result: Record<string, unknown>) => void
  >();
  private hostContextHandlers = new Set<(context: HostContext) => void>();

  constructor() {
    if (typeof window === "undefined") return;

    // Listen for postMessage from host
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as JSONRPCMessage;
      if (!message || message.jsonrpc !== "2.0") return;

      // Handle responses
      if ("result" in message || "error" in message) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          if ("error" in message && message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }

      // Handle notifications
      if ("method" in message && !("id" in message)) {
        this.handleNotification(message);
      }
    };

    window.addEventListener("message", handleMessage);
    this.listeners.add(handleMessage);

    // Intercept console methods to send logs to host
    this.interceptConsole();
  }

  /**
   * Intercept console methods and proxy to MCP Apps host
   */
  private interceptConsole(): void {
    if (typeof window === "undefined" || typeof console === "undefined") return;

    // Save original console methods
    const originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    };

    // Helper to send logging notification
    const sendLog = (
      level: "log" | "warn" | "error" | "info" | "debug",
      args: any[]
    ) => {
      // Send notification to host
      this.sendNotification("notifications/message", {
        level,
        logger: "console",
        data: args.length === 1 ? args[0] : args,
      });
    };

    // Wrap console methods
    console.log = (...args: any[]) => {
      sendLog("log", args);
      originalConsole.log(...args);
    };

    console.warn = (...args: any[]) => {
      sendLog("warn", args);
      originalConsole.warn(...args);
    };

    console.error = (...args: any[]) => {
      sendLog("error", args);
      originalConsole.error(...args);
    };

    console.info = (...args: any[]) => {
      sendLog("info", args);
      originalConsole.info(...args);
    };

    console.debug = (...args: any[]) => {
      sendLog("debug", args);
      originalConsole.debug(...args);
    };
  }

  private handleNotification(notification: JSONRPCNotification) {
    console.log(
      "[MCP Apps Bridge] Received notification:",
      notification.method,
      notification.params
    );

    switch (notification.method) {
      case "ui/notifications/tool-input": {
        const params = notification.params as ToolInputNotification;
        console.log("[MCP Apps Bridge] Tool input received:", params.arguments);
        this.toolInput = params.arguments;
        this.toolInputHandlers.forEach((handler) => handler(params.arguments));
        break;
      }
      case "ui/notifications/tool-result": {
        const params = notification.params as ToolResultNotification;
        // Prefer structuredContent, fall back to parsing text content
        const output =
          params.structuredContent || this.parseTextContent(params);
        console.log("[MCP Apps Bridge] Tool result received:", output);
        this.toolOutput = output;
        this.toolResultHandlers.forEach((handler) => handler(output));
        break;
      }
      case "ui/notifications/host-context-changed": {
        const context = notification.params as HostContext;
        console.log("[MCP Apps Bridge] Host context changed:", context);
        // Merge partial updates with existing context
        this.hostContext = { ...this.hostContext, ...context };
        console.log("[MCP Apps Bridge] Merged hostContext:", this.hostContext);
        console.log(
          "[MCP Apps Bridge] Calling handlers:",
          this.hostContextHandlers.size
        );
        this.hostContextHandlers.forEach((handler) =>
          handler(this.hostContext!)
        );
        break;
      }
      case "ui/notifications/initialized": {
        this.initialized = true;
        break;
      }
      default:
        // Unknown notification method, ignore
        break;
    }
  }

  private parseTextContent(
    result: ToolResultNotification
  ): Record<string, unknown> {
    // Try to extract structured data from text content
    if (result.content && Array.isArray(result.content)) {
      for (const block of result.content) {
        if (block.type === "text" && block.text) {
          try {
            const parsed = JSON.parse(block.text);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            // Not JSON, continue
          }
        }
      }
    }
    return {};
  }

  private sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (typeof window === "undefined" || !window.parent) {
      return Promise.reject(new Error("Not in iframe context"));
    }

    const id = this.requestId++;
    const message: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      window.parent.postMessage(message, "*");

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (typeof window === "undefined" || !window.parent) return;

    const message: JSONRPCNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    window.parent.postMessage(message, "*");
  }

  /**
   * Initialize connection with MCP Apps host
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    // Only connect if we're in an iframe (not top window)
    if (typeof window === "undefined" || window === window.parent) {
      console.log("[MCP Apps Bridge] Not in iframe, skipping connection");
      return;
    }

    console.log("[MCP Apps Bridge] Connecting to MCP Apps host...");

    try {
      // Send ui/initialize request
      const result = (await this.sendRequest("ui/initialize", {
        appCapabilities: {},
        appInfo: {
          name: "mcp-use-widget",
          version: "1.0.0",
        },
        protocolVersion: "2025-06-18",
      })) as McpUiInitializeResult;

      console.log("[MCP Apps Bridge] Initialize result:", result);

      // Store host context
      if (result.hostContext) {
        this.hostContext = result.hostContext;
        console.log("[MCP Apps Bridge] Host context:", this.hostContext);
      }

      // Send initialized notification
      this.sendNotification("ui/notifications/initialized", {});

      this.connected = true;
      console.log("[MCP Apps Bridge] Successfully connected");
    } catch (error) {
      console.error("[MCP Apps Bridge] Failed to connect:", error);
      throw error;
    }
  }

  /**
   * Check if connected to MCP Apps host
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current tool input (props)
   */
  getToolInput(): Record<string, unknown> | null {
    return this.toolInput;
  }

  /**
   * Get current tool output
   */
  getToolOutput(): Record<string, unknown> | null {
    return this.toolOutput;
  }

  /**
   * Get host context
   */
  getHostContext(): HostContext | null {
    return this.hostContext;
  }

  /**
   * Subscribe to tool input changes
   */
  onToolInput(handler: (input: Record<string, unknown>) => void): () => void {
    this.toolInputHandlers.add(handler);
    return () => this.toolInputHandlers.delete(handler);
  }

  /**
   * Subscribe to tool result changes
   */
  onToolResult(handler: (result: Record<string, unknown>) => void): () => void {
    this.toolResultHandlers.add(handler);
    return () => this.toolResultHandlers.delete(handler);
  }

  /**
   * Subscribe to host context changes
   */
  onHostContextChange(handler: (context: HostContext) => void): () => void {
    this.hostContextHandlers.add(handler);
    return () => this.hostContextHandlers.delete(handler);
  }

  /**
   * Call a tool on the server
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return this.sendRequest("tools/call", { name, arguments: args });
  }

  /**
   * Send a message to the conversation
   */
  async sendMessage(content: { type: string; text: string }): Promise<void> {
    await this.sendRequest("ui/message", {
      role: "user",
      content,
    });
  }

  /**
   * Open an external link
   */
  async openLink(url: string): Promise<void> {
    await this.sendRequest("ui/open-link", { url });
  }

  /**
   * Request display mode change
   */
  async requestDisplayMode(mode: DisplayMode): Promise<{ mode: DisplayMode }> {
    const result = await this.sendRequest("ui/request-display-mode", { mode });
    return result as { mode: DisplayMode };
  }

  /**
   * Cleanup
   */
  disconnect(): void {
    this.listeners.forEach((listener) => {
      if (typeof window !== "undefined") {
        window.removeEventListener("message", listener);
      }
    });
    this.listeners.clear();
    this.pendingRequests.clear();
    this.toolInputHandlers.clear();
    this.toolResultHandlers.clear();
    this.hostContextHandlers.clear();
    this.connected = false;
  }
}

// Singleton instance
let bridgeInstance: McpAppsBridge | null = null;

/**
 * Get or create the MCP Apps bridge singleton
 */
export function getMcpAppsBridge(): McpAppsBridge {
  if (!bridgeInstance) {
    bridgeInstance = new McpAppsBridge();
  }
  return bridgeInstance;
}

/**
 * Type exports
 */
export type { HostContext, ToolInputNotification, ToolResultNotification };
