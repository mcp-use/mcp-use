import { logger } from "../logging.js";
import type {
  BaseTelemetryEvent,
  ConnectorInitEventData,
  MCPAgentExecutionEventData,
  MCPClientInitEventData,
  MCPServerTelemetryInfo,
  ServerContextEventData,
  ServerInitializeEventData,
  ServerPromptCallEventData,
  ServerResourceCallEventData,
  ServerToolCallEventData,
} from "./events.js";
import {
  ClientAddServerEvent,
  ClientRemoveServerEvent,
  ConnectorInitEvent,
  createServerRunEventData,
  MCPAgentExecutionEvent,
  MCPClientInitEvent,
  ServerContextEvent,
  ServerInitializeEvent,
  ServerPromptCallEvent,
  ServerResourceCallEvent,
  ServerRunEvent,
  ServerToolCallEvent,
} from "./events.js";
import { getPackageVersion } from "../version.js";
import { capturePostHog } from "./tel-fetch.js";

/**
 * Generate a UUID-like identifier suitable for browser and similar runtimes.
 *
 * Uses cryptographic randomness when available and falls back to a non-cryptographic identifier if necessary.
 *
 * @returns A UUID-formatted string; when Web Crypto APIs are available the value is generated with cryptographic randomness, otherwise a best-effort (not cryptographically secure) fallback is returned.
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

/**
 * Generate a short random string suitable for session or user identifiers in browser environments.
 *
 * Uses the Web Crypto API when available; may return a non-cryptographically secure string as a last resort.
 *
 * @returns A short random string — a 16-character hex string when a cryptographic RNG is available, otherwise an alphanumeric string derived from Math.random().
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

type RuntimeEnvironment = "browser" | "unknown";

type StorageCapability = "localStorage" | "session-only";

const USER_ID_STORAGE_KEY = "mcp_use_user_id";

/**
 * Check if localStorage is available and functional.
 * Node.js 25+ has an experimental localStorage that exists but doesn't implement methods properly.
 */
function isLocalStorageFunctional(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    typeof localStorage.getItem === "function" &&
    typeof localStorage.setItem === "function" &&
    typeof localStorage.removeItem === "function"
  );
}

/**
 * Determine whether the current runtime is a browser environment.
 *
 * @returns The runtime environment: `"browser"` if running in a browser, `"unknown"` otherwise.
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
 * Determine whether localStorage is available and usable in the given runtime.
 *
 * @param env - The detected runtime environment
 * @returns `localStorage` if localStorage is writable and accessible, `session-only` otherwise.
 */
function getStorageCapability(env: RuntimeEnvironment): StorageCapability {
  if (env === "browser") {
    // Check if localStorage is actually available (might be disabled)
    try {
      if (isLocalStorageFunctional()) {
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

/**
 * Get the runtime environment, detecting it once and returning the cached value thereafter.
 *
 * @returns The runtime environment, either `"browser"` or `"unknown"`.
 */
function getRuntimeEnvironment(): RuntimeEnvironment {
  if (cachedEnvironment === null) {
    cachedEnvironment = detectRuntimeEnvironment();
  }
  return cachedEnvironment;
}

/**
 * Browser Telemetry class that works in browser environments only.
 *
 * Sends anonymized events to PostHog via `fetch` only (no `posthog-js` SDK),
 * uses `window.crypto` for secure random strings, and localStorage for user ID
 * persistence.
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
  private _telemetryEnabled = false;
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
      this._telemetryEnabled = false;
      logger.debug("Telemetry disabled via localStorage");
    } else if (!canSupportTelemetry) {
      this._telemetryEnabled = false;
      logger.debug(
        `Telemetry disabled - unknown environment: ${this._runtimeEnvironment}`
      );
    } else {
      logger.debug(
        "Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false in localStorage to disable."
      );

      // PostHog events are sent directly via fetch (no SDK); nothing to init.
      this._telemetryEnabled = true;
    }
  }

  private _getSourceFromLocalStorage(): string | null {
    try {
      if (isLocalStorageFunctional()) {
        return localStorage.getItem("MCP_USE_TELEMETRY_SOURCE");
      }
    } catch {
      // localStorage not available
    }
    return null;
  }

  private _checkTelemetryDisabled(): boolean {
    // Runtime flag injected by a host page (e.g. the inspector mirrors
    // MCP_USE_ANONYMIZED_TELEMETRY=false from the server here). Checked first
    // so a blocked localStorage doesn't defeat the opt-out.
    if (
      typeof window !== "undefined" &&
      (window as unknown as { __MCP_USE_ANONYMIZED_TELEMETRY__?: boolean })
        .__MCP_USE_ANONYMIZED_TELEMETRY__ === false
    ) {
      return true;
    }

    // Check localStorage (Browser)
    if (
      isLocalStorageFunctional() &&
      localStorage.getItem("MCP_USE_ANONYMIZED_TELEMETRY") === "false"
    ) {
      return true;
    }

    return false;
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
      if (isLocalStorageFunctional()) {
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
    return this._telemetryEnabled;
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
      if (!isLocalStorageFunctional()) {
        throw new Error("localStorage is not available or not functional");
      }

      // Test write access (localStorage might throw in private browsing mode)
      localStorage.setItem("__mcp_use_test__", "1");
      localStorage.removeItem("__mcp_use_test__");

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
    if (!this._telemetryEnabled) {
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

    // Send to PostHog via fetch (fire-and-forget, errors swallowed)
    await capturePostHog({
      host: this.HOST,
      apiKey: this.PROJECT_API_KEY,
      event: event.name,
      distinctId: currentUserId,
      properties,
    });
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
   * Identify the current user (useful for linking sessions). With the
   * fetch-only approach this sets the distinct_id used for subsequent events
   * and sends a PostHog `$identify` event.
   * Browser only
   */
  identify(userId: string, properties?: Record<string, any>): void {
    this._currUserId = userId;
    try {
      if (isLocalStorageFunctional()) {
        localStorage.setItem(USER_ID_STORAGE_KEY, userId);
      }
    } catch {
      // localStorage not available, ignore
    }
    if (this._telemetryEnabled) {
      void capturePostHog({
        host: this.HOST,
        apiKey: this.PROJECT_API_KEY,
        event: "$identify",
        distinctId: userId,
        properties: { $set: properties ?? {} },
      });
    }
  }

  /**
   * Reset the user identity (useful for logout)
   * Browser only
   */
  reset(): void {
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
/** @alias */
export const Tel = Telemetry;
/**
 * Set the global telemetry source used to tag telemetry events.
 *
 * @param source - Identifier to persist and include with subsequent telemetry events
 */
export function setTelemetrySource(source: string): void {
  Tel.getInstance().setSource(source);
}
