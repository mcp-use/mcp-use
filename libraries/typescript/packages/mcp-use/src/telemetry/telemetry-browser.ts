import type {
  BaseTelemetryEvent,
  MCPAgentExecutionEventData,
  ServerInitializeEventData,
  ServerToolCallEventData,
  ServerResourceCallEventData,
  ServerPromptCallEventData,
  ServerContextEventData,
  MCPClientInitEventData,
  ConnectorInitEventData,
  MCPServerTelemetryInfo,
} from "./events.js";
import { logger } from "../logging.js";

/**
 * Browser-safe UUID generation using Web Crypto API
 * Works in browsers, Node.js 19+, Deno, Cloudflare Workers, etc.
 */
function generateUUID(): string {
  // Use globalThis.crypto.randomUUID() if available (modern browsers, Node.js 19+)
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof (globalThis.crypto as any).randomUUID === "function"
  ) {
    return (globalThis.crypto as any).randomUUID();
  }
  // Fallback for older environments - use crypto.getRandomValues if available
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof (globalThis.crypto as any).getRandomValues === "function"
  ) {
    const array = new Uint8Array(16);
    (globalThis.crypto as any).getRandomValues(array);
    // Convert to hex string
    const hex = Array.from(array, (v) => v.toString(16).padStart(2, "0")).join(
      ""
    );
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
  }
  // Last resort fallback - not cryptographically secure but better than nothing
  // This should rarely be reached in modern browsers
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
}
import {
  MCPAgentExecutionEvent,
  ServerRunEvent,
  ServerInitializeEvent,
  ServerToolCallEvent,
  ServerResourceCallEvent,
  ServerPromptCallEvent,
  ServerContextEvent,
  MCPClientInitEvent,
  ConnectorInitEvent,
  ClientAddServerEvent,
  ClientRemoveServerEvent,
  createServerRunEventData,
} from "./events.js";
import { getPackageVersion } from "./utils.js";

/**
 * Generate a cryptographically secure random string for session/user IDs (browser only).
 */
function secureRandomString(): string {
  // Browser - use window.crypto
  if (
    typeof window !== "undefined" &&
    window.crypto &&
    typeof window.crypto.getRandomValues === "function"
  ) {
    // 8 random bytes, 16 hex characters
    const array = new Uint8Array(8);
    window.crypto.getRandomValues(array);
    return Array.from(array, (v) => v.toString(16).padStart(2, "0")).join("");
  }
  // Fallback to crypto.getRandomValues if available
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof (globalThis.crypto as any).getRandomValues === "function"
  ) {
    const array = new Uint8Array(8);
    (globalThis.crypto as any).getRandomValues(array);
    return Array.from(array, (v) => v.toString(16).padStart(2, "0")).join("");
  }
  // Last resort fallback - not cryptographically secure (should not happen in browser)
  return Math.random().toString(36).substring(2, 15);
}

export type RuntimeEnvironment = "browser" | "unknown";

type StorageCapability = "localStorage" | "session-only";

const USER_ID_STORAGE_KEY = "mcp_use_user_id";

/**
 * Detect the current runtime environment (browser only)
 */
function detectRuntimeEnvironment(): RuntimeEnvironment {
  try {
    // Check for browser
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      return "browser";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Determine storage capability based on runtime environment
 */
function getStorageCapability(env: RuntimeEnvironment): StorageCapability {
  if (env === "browser") {
    // Check if localStorage is actually available (might be disabled)
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("__mcp_use_test__", "1");
        localStorage.removeItem("__mcp_use_test__");
        return "localStorage";
      }
    } catch {
      // localStorage might be disabled (private browsing, etc.)
    }
  }
  return "session-only";
}

// Cache the detected environment
let cachedEnvironment: RuntimeEnvironment | null = null;

function getRuntimeEnvironment(): RuntimeEnvironment {
  if (cachedEnvironment === null) {
    cachedEnvironment = detectRuntimeEnvironment();
  }
  return cachedEnvironment;
}

/**
 * Check if we're in a browser environment
 */
export function isBrowserEnvironment(): boolean {
  return getRuntimeEnvironment() === "browser";
}

// PostHog types for Browser
type PostHogBrowserClient = {
  capture: (eventName: string, properties?: Record<string, any>) => void;
  identify: (distinctId: string, properties?: Record<string, any>) => void;
  reset: () => void;
  opt_out_capturing: () => void;
  opt_in_capturing: () => void;
};

/**
 * Browser Telemetry class that works in browser environments only.
 *
 * Uses posthog-js for telemetry, window.crypto for secure random strings,
 * and localStorage for user ID persistence.
 *
 * Usage: Tel.getInstance().trackMCPClientInit(...)
 */
export class Telemetry {
  private static instance: Telemetry | null = null;

  private readonly PROJECT_API_KEY =
    "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI";
  private readonly HOST = "https://eu.i.posthog.com";
  private readonly UNKNOWN_USER_ID = "UNKNOWN_USER_ID";

  private _currUserId: string | null = null;
  private _posthogBrowserClient: PostHogBrowserClient | null = null;
  private _posthogLoading: Promise<void> | null = null;
  private _runtimeEnvironment: RuntimeEnvironment;
  private _storageCapability: StorageCapability;
  private _source: string;

  private constructor() {
    // Detect runtime environment
    this._runtimeEnvironment = getRuntimeEnvironment();
    this._storageCapability = getStorageCapability(this._runtimeEnvironment);

    // Set source from localStorage or use detected runtime environment
    this._source =
      this._getSourceFromLocalStorage() || this._runtimeEnvironment;

    // Check if telemetry is disabled
    const telemetryDisabled = this._checkTelemetryDisabled();

    // All environments except "unknown" can support telemetry
    const canSupportTelemetry = this._runtimeEnvironment !== "unknown";

    if (telemetryDisabled) {
      this._posthogBrowserClient = null;
      logger.debug("Telemetry disabled via localStorage");
    } else if (!canSupportTelemetry) {
      this._posthogBrowserClient = null;
      logger.debug(
        `Telemetry disabled - unknown environment: ${this._runtimeEnvironment}`
      );
    } else {
      logger.info(
        "Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false in localStorage to disable."
      );

      // Initialize PostHog
      this._posthogLoading = this._initPostHogBrowser();
    }
  }

  private _getSourceFromLocalStorage(): string | null {
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem("MCP_USE_TELEMETRY_SOURCE");
      }
    } catch {
      // localStorage not available
    }
    return null;
  }

  private _checkTelemetryDisabled(): boolean {
    // Check localStorage (Browser)
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("MCP_USE_ANONYMIZED_TELEMETRY") === "false"
    ) {
      return true;
    }

    return false;
  }

  private async _initPostHogBrowser(): Promise<void> {
    try {
      // Dynamic import of posthog-js
      const posthogModule = await import("posthog-js");
      // Type assertion for posthog module structure - use unknown to avoid type conflicts
      const posthogModuleTyped = posthogModule as unknown as {
        default?: any;
        posthog?: any;
      };
      const posthog = posthogModuleTyped.default || posthogModuleTyped.posthog;

      if (!posthog || typeof posthog.init !== "function") {
        throw new Error("posthog-js module did not export expected interface");
      }

      // Initialize PostHog for browser
      posthog.init(this.PROJECT_API_KEY, {
        api_host: this.HOST,
        persistence: "localStorage",
        autocapture: false, // We only want explicit captures
        capture_pageview: false, // We don't want automatic pageview tracking
        disable_session_recording: true, // No session recording
        loaded: () => {
          logger.debug("PostHog browser client initialized");
        },
      });

      this._posthogBrowserClient = posthog as PostHogBrowserClient;
    } catch (e) {
      logger.warn(`Failed to initialize PostHog browser telemetry: ${e}`);
      this._posthogBrowserClient = null;
    }
  }

  /**
   * Get the detected runtime environment
   */
  get runtimeEnvironment(): RuntimeEnvironment {
    return this._runtimeEnvironment;
  }

  /**
   * Get the storage capability for this environment
   */
  get storageCapability(): StorageCapability {
    return this._storageCapability;
  }

  static getInstance(): Telemetry {
    if (!Telemetry.instance) {
      Telemetry.instance = new Telemetry();
    }
    return Telemetry.instance;
  }

  /**
   * Set the source identifier for telemetry events.
   * This allows tracking usage from different applications.
   * @param source - The source identifier (e.g., "my-app", "cli", "vs-code-extension")
   */
  setSource(source: string): void {
    this._source = source;
    // Also save to localStorage for persistence
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("MCP_USE_TELEMETRY_SOURCE", source);
      }
    } catch {
      // localStorage not available, ignore
    }
    logger.debug(`Telemetry source set to: ${source}`);
  }

  /**
   * Get the current source identifier.
   */
  getSource(): string {
    return this._source;
  }

  /**
   * Check if telemetry is enabled.
   */
  get isEnabled(): boolean {
    return this._posthogBrowserClient !== null;
  }

  get userId(): string {
    if (this._currUserId) {
      return this._currUserId;
    }

    try {
      switch (this._storageCapability) {
        case "localStorage":
          this._currUserId = this._getUserIdFromLocalStorage();
          break;
        case "session-only":
        default:
          // Generate a session-based ID (prefixed to identify it's not persistent)
          try {
            this._currUserId = `session-${generateUUID()}`;
          } catch (uuidError) {
            // Fallback to timestamp-based ID if crypto API is not available
            this._currUserId = `session-${Date.now()}-${secureRandomString()}`;
          }
          break;
      }
    } catch (e) {
      this._currUserId = this.UNKNOWN_USER_ID;
    }

    return this._currUserId;
  }

  /**
   * Get or create user ID from localStorage (Browser)
   */
  private _getUserIdFromLocalStorage(): string {
    try {
      // Check if localStorage is actually available and accessible
      if (typeof localStorage === "undefined") {
        throw new Error("localStorage is not available");
      }

      // Test write access (localStorage might throw in private browsing mode)
      try {
        localStorage.setItem("__mcp_use_test__", "1");
        localStorage.removeItem("__mcp_use_test__");
      } catch (testError) {
        throw new Error(`localStorage is not writable: ${testError}`);
      }

      let userId = localStorage.getItem(USER_ID_STORAGE_KEY);

      if (!userId) {
        try {
          userId = generateUUID();
        } catch (uuidError) {
          userId = `${Date.now()}-${secureRandomString()}`;
        }
        localStorage.setItem(USER_ID_STORAGE_KEY, userId);
      }

      return userId;
    } catch (e) {
      // Log specific error for debugging (localStorage failures are common in private browsing)
      logger.debug(`Failed to access localStorage for user ID: ${e}`);
      // Fallback to session-based
      let sessionId: string;
      try {
        sessionId = `session-${generateUUID()}`;
      } catch (uuidError) {
        sessionId = `session-${Date.now()}-${secureRandomString()}`;
      }
      return sessionId;
    }
  }

  async capture(event: BaseTelemetryEvent): Promise<void> {
    // Wait for PostHog to load if it's still initializing
    if (this._posthogLoading) {
      await this._posthogLoading;
    }

    if (!this._posthogBrowserClient) {
      return;
    }

    // Get user ID (this will trigger lazy initialization if needed)
    const currentUserId = this.userId;

    // Add metadata to all events
    const properties = { ...event.properties };
    properties.mcp_use_version = getPackageVersion();
    properties.language = "typescript";
    properties.source = this._source;
    properties.runtime = this._runtimeEnvironment;

    // Send to PostHog (Browser)
    if (this._posthogBrowserClient) {
      try {
        this._posthogBrowserClient.capture(event.name, {
          ...properties,
          distinct_id: currentUserId,
        });
      } catch (e) {
        logger.debug(
          `Failed to track PostHog Browser event ${event.name}: ${e}`
        );
      }
    }
  }

  // ============================================================================
  // Agent Events
  // ============================================================================

  async trackAgentExecution(data: MCPAgentExecutionEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new MCPAgentExecutionEvent(data);
    await this.capture(event);
  }

  // ============================================================================
  // Server Events
  // ============================================================================

  /**
   * Track server run event directly from an MCPServer instance.
   */
  async trackServerRunFromServer(
    server: MCPServerTelemetryInfo,
    transport: string
  ): Promise<void> {
    if (!this.isEnabled) return;
    const data = createServerRunEventData(server, transport);
    const event = new ServerRunEvent(data);
    await this.capture(event);
  }

  async trackServerInitialize(data: ServerInitializeEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerInitializeEvent(data);
    await this.capture(event);
  }

  async trackServerToolCall(data: ServerToolCallEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerToolCallEvent(data);
    await this.capture(event);
  }

  async trackServerResourceCall(
    data: ServerResourceCallEventData
  ): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerResourceCallEvent(data);
    await this.capture(event);
  }

  async trackServerPromptCall(data: ServerPromptCallEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerPromptCallEvent(data);
    await this.capture(event);
  }

  async trackServerContext(data: ServerContextEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerContextEvent(data);
    await this.capture(event);
  }

  // ============================================================================
  // Client Events
  // ============================================================================

  async trackMCPClientInit(data: MCPClientInitEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new MCPClientInitEvent(data);
    await this.capture(event);
  }

  async trackConnectorInit(data: ConnectorInitEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ConnectorInitEvent(data);
    await this.capture(event);
  }

  async trackClientAddServer(
    serverName: string,
    serverConfig: Record<string, any>
  ): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ClientAddServerEvent({ serverName, serverConfig });
    await this.capture(event);
  }

  async trackClientRemoveServer(serverName: string): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ClientRemoveServerEvent({ serverName });
    await this.capture(event);
  }

  // ============================================================================
  // React Hook / Browser specific events
  // ============================================================================

  async trackUseMcpConnection(data: {
    url: string;
    transportType: string;
    success: boolean;
    errorType?: string | null;
    connectionTimeMs?: number | null;
    hasOAuth: boolean;
    hasSampling: boolean;
    hasElicitation: boolean;
  }): Promise<void> {
    if (!this.isEnabled) return;

    await this.capture({
      name: "usemcp_connection",
      properties: {
        url_domain: new URL(data.url).hostname, // Only domain for privacy
        transport_type: data.transportType,
        success: data.success,
        error_type: data.errorType ?? null,
        connection_time_ms: data.connectionTimeMs ?? null,
        has_oauth: data.hasOAuth,
        has_sampling: data.hasSampling,
        has_elicitation: data.hasElicitation,
      },
    });
  }

  async trackUseMcpToolCall(data: {
    toolName: string;
    success: boolean;
    errorType?: string | null;
    executionTimeMs?: number | null;
  }): Promise<void> {
    if (!this.isEnabled) return;

    await this.capture({
      name: "usemcp_tool_call",
      properties: {
        tool_name: data.toolName,
        success: data.success,
        error_type: data.errorType ?? null,
        execution_time_ms: data.executionTimeMs ?? null,
      },
    });
  }

  async trackUseMcpResourceRead(data: {
    resourceUri: string;
    success: boolean;
    errorType?: string | null;
  }): Promise<void> {
    if (!this.isEnabled) return;

    await this.capture({
      name: "usemcp_resource_read",
      properties: {
        resource_uri_scheme: data.resourceUri.split(":")[0], // Only scheme for privacy
        success: data.success,
        error_type: data.errorType ?? null,
      },
    });
  }

  // ============================================================================
  // Browser-specific Methods
  // ============================================================================

  /**
   * Identify the current user (useful for linking sessions)
   * Browser only
   */
  identify(userId: string, properties?: Record<string, any>): void {
    if (this._posthogBrowserClient) {
      try {
        this._posthogBrowserClient.identify(userId, properties);
      } catch (e) {
        logger.debug(`Failed to identify user: ${e}`);
      }
    }
  }

  /**
   * Reset the user identity (useful for logout)
   * Browser only
   */
  reset(): void {
    if (this._posthogBrowserClient) {
      try {
        this._posthogBrowserClient.reset();
      } catch (e) {
        logger.debug(`Failed to reset user: ${e}`);
      }
    }
    this._currUserId = null;
  }

  // ============================================================================
  // Node.js-specific Methods (no-ops in browser)
  // ============================================================================

  /**
   * Flush the telemetry queue (Node.js only - no-op in browser)
   */
  flush(): void {
    // No-op in browser
  }

  /**
   * Shutdown the telemetry client (Node.js only - no-op in browser)
   */
  shutdown(): void {
    // No-op in browser
  }

  /**
   * Track package download event (Node.js only - no-op in browser)
   */
  async trackPackageDownload(properties?: Record<string, any>): Promise<void> {
    // No-op in browser
  }
}

// ============================================================================
// Convenience Alias and Functions
// ============================================================================

/**
 * Alias for Telemetry - shorter name for convenience
 *
 * Usage: Tel.getInstance().trackMCPClientInit(...)
 */
export const Tel = Telemetry;

/**
 * Convenience function to set telemetry source globally
 */
export function setTelemetrySource(source: string): void {
  Tel.getInstance().setSource(source);
}
