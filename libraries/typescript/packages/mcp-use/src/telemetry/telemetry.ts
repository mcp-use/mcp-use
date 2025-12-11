/* eslint-disable @typescript-eslint/no-require-imports */
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
import { generateUUID } from "../server/utils/runtime.js";
import { logger } from "../logging.js";
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

// ============================================================================
// Runtime Environment Detection
// ============================================================================

/**
 * Detected runtime environment types
 */
export type RuntimeEnvironment =
  | "node"
  | "browser"
  | "cloudflare-workers"
  | "edge"
  | "deno"
  | "bun"
  | "unknown";

/**
 * Storage capabilities for user ID persistence
 */
type StorageCapability = "filesystem" | "localStorage" | "session-only";

const USER_ID_STORAGE_KEY = "mcp_use_user_id";

/**
 * Detect the current runtime environment
 */
function detectRuntimeEnvironment(): RuntimeEnvironment {
  try {
    // Check for Bun
    if (typeof (globalThis as any).Bun !== "undefined") {
      return "bun";
    }

    // Check for Deno
    if (typeof (globalThis as any).Deno !== "undefined") {
      return "deno";
    }

    // Check for Cloudflare Workers
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent?.includes("Cloudflare-Workers")
    ) {
      return "cloudflare-workers";
    }

    // Check for Edge runtime (Vercel Edge, etc.)
    if (typeof (globalThis as any).EdgeRuntime !== "undefined") {
      return "edge";
    }

    // Check for browser FIRST (before Node.js check)
    // In browser, window and document are defined
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      return "browser";
    }

    // Check for Node.js
    if (
      typeof process !== "undefined" &&
      typeof process.versions?.node !== "undefined"
    ) {
      return "node";
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
  switch (env) {
    case "node":
    case "bun":
      return "filesystem";
    case "browser":
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
      return "session-only";
    case "deno":
      // Deno has file system access but needs permissions
      // For now, treat as session-only to be safe
      return "session-only";
    default:
      return "session-only";
  }
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

// Simple Scarf event logger implementation
class ScarfEventLogger {
  private endpoint: string;
  private timeout: number;

  constructor(endpoint: string, timeout: number = 3000) {
    this.endpoint = endpoint;
    this.timeout = timeout;
  }

  async logEvent(properties: Record<string, any>): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(properties),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      // Silently fail - telemetry should not break the application
      logger.debug(`Failed to send Scarf event: ${error}`);
    }
  }
}

// PostHog types for both Node and Browser
type PostHogNodeClient = {
  capture: (params: {
    distinctId: string;
    event: string;
    properties?: Record<string, any>;
  }) => void;
  flush: () => void;
  shutdown: () => void;
};

type PostHogBrowserClient = {
  capture: (eventName: string, properties?: Record<string, any>) => void;
  identify: (distinctId: string, properties?: Record<string, any>) => void;
  reset: () => void;
  opt_out_capturing: () => void;
  opt_in_capturing: () => void;
};

/**
 * Unified Telemetry class that works in both Node.js and browser environments.
 *
 * Automatically detects the runtime environment and uses the appropriate
 * PostHog library (posthog-node for Node.js, posthog-js for browser).
 *
 * Usage: Tel.getInstance().trackMCPClientInit(...)
 */
export class Telemetry {
  private static instance: Telemetry | null = null;

  private readonly PROJECT_API_KEY =
    "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI";
  private readonly HOST = "https://eu.i.posthog.com";
  private readonly SCARF_GATEWAY_URL =
    "https://mcpuse.gateway.scarf.sh/events-ts";
  private readonly UNKNOWN_USER_ID = "UNKNOWN_USER_ID";

  private _currUserId: string | null = null;
  private _posthogNodeClient: PostHogNodeClient | null = null;
  private _posthogBrowserClient: PostHogBrowserClient | null = null;
  private _posthogLoading: Promise<void> | null = null;
  private _scarfClient: ScarfEventLogger | null = null;
  private _runtimeEnvironment: RuntimeEnvironment;
  private _storageCapability: StorageCapability;
  private _source: string;

  // Node.js specific paths (lazily computed)
  private _userIdPath: string | null = null;
  private _versionDownloadPath: string | null = null;

  private constructor() {
    // Detect runtime environment
    this._runtimeEnvironment = getRuntimeEnvironment();
    this._storageCapability = getStorageCapability(this._runtimeEnvironment);

    // Set source from environment variable, or use detected runtime environment
    this._source =
      (typeof process !== "undefined" &&
        process.env?.MCP_USE_TELEMETRY_SOURCE) ||
      this._runtimeEnvironment;

    // Check if telemetry is disabled
    const telemetryDisabled = this._checkTelemetryDisabled();

    // All environments except "unknown" can support telemetry
    const canSupportTelemetry = this._runtimeEnvironment !== "unknown";

    if (telemetryDisabled) {
      this._posthogNodeClient = null;
      this._posthogBrowserClient = null;
      this._scarfClient = null;
      logger.debug("Telemetry disabled via environment/localStorage");
    } else if (!canSupportTelemetry) {
      this._posthogNodeClient = null;
      this._posthogBrowserClient = null;
      this._scarfClient = null;
      logger.debug(
        `Telemetry disabled - unknown environment: ${this._runtimeEnvironment}`
      );
    } else {
      logger.info(
        "Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false to disable."
      );

      // Initialize PostHog based on environment
      this._posthogLoading = this._initPostHog();

      // Initialize Scarf (works in all environments with fetch)
      try {
        this._scarfClient = new ScarfEventLogger(this.SCARF_GATEWAY_URL, 3000);
      } catch (e) {
        logger.warn(`Failed to initialize Scarf telemetry: ${e}`);
        this._scarfClient = null;
      }
    }
  }

  private _checkTelemetryDisabled(): boolean {
    // Check environment variable (Node.js)
    if (
      typeof process !== "undefined" &&
      process.env?.MCP_USE_ANONYMIZED_TELEMETRY?.toLowerCase() === "false"
    ) {
      return true;
    }

    // Check localStorage (Browser)
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("MCP_USE_ANONYMIZED_TELEMETRY") === "false"
    ) {
      return true;
    }

    return false;
  }

  private async _initPostHog(): Promise<void> {
    const isBrowser = this._runtimeEnvironment === "browser";

    if (isBrowser) {
      await this._initPostHogBrowser();
    } else {
      await this._initPostHogNode();
    }
  }

  private async _initPostHogBrowser(): Promise<void> {
    try {
      // Dynamic import of posthog-js
      const posthogModule = await import("posthog-js");
      const posthog = (posthogModule as any).default || posthogModule.posthog;

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

  private async _initPostHogNode(): Promise<void> {
    try {
      // Dynamic import of posthog-node
      const { PostHog } = await import("posthog-node");

      // Serverless/edge environments need immediate flushing
      const isServerlessEnvironment = [
        "cloudflare-workers",
        "edge",
        "deno",
      ].includes(this._runtimeEnvironment);

      const posthogOptions: {
        host: string;
        disableGeoip: boolean;
        flushAt?: number;
        flushInterval?: number;
      } = {
        host: this.HOST,
        disableGeoip: false,
      };

      if (isServerlessEnvironment) {
        posthogOptions.flushAt = 1; // Send events immediately
        posthogOptions.flushInterval = 0; // Don't wait for interval
      }

      this._posthogNodeClient = new PostHog(
        this.PROJECT_API_KEY,
        posthogOptions
      );

      logger.debug("PostHog Node.js client initialized");
    } catch (e) {
      logger.warn(`Failed to initialize PostHog Node.js telemetry: ${e}`);
      this._posthogNodeClient = null;
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
    return (
      this._posthogNodeClient !== null ||
      this._posthogBrowserClient !== null ||
      this._scarfClient !== null
    );
  }

  get userId(): string {
    if (this._currUserId) {
      return this._currUserId;
    }

    try {
      switch (this._storageCapability) {
        case "filesystem":
          this._currUserId = this._getUserIdFromFilesystem();
          break;
        case "localStorage":
          this._currUserId = this._getUserIdFromLocalStorage();
          break;
        case "session-only":
        default:
          // Generate a session-based ID (prefixed to identify it's not persistent)
          this._currUserId = `session-${generateUUID()}`;
          logger.debug(
            `Using session-based user ID (${this._runtimeEnvironment} environment)`
          );
          break;
      }

      // Track package download for persistent storage types
      if (this._storageCapability === "filesystem" && this._currUserId) {
        this._trackPackageDownloadInternal(this._currUserId, {
          triggered_by: "user_id_property",
        }).catch((e) => logger.debug(`Failed to track package download: ${e}`));
      }
    } catch (e) {
      logger.debug(`Failed to get/create user ID: ${e}`);
      this._currUserId = this.UNKNOWN_USER_ID;
    }

    return this._currUserId;
  }

  /**
   * Get or create user ID from filesystem (Node.js/Bun)
   */
  private _getUserIdFromFilesystem(): string {
    // Lazy import of Node.js modules
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    if (!this._userIdPath) {
      this._userIdPath = path.join(
        this._getCacheHome(os, path),
        "mcp_use_3",
        "telemetry_user_id"
      );
    }

    const isFirstTime = !fs.existsSync(this._userIdPath);

    if (isFirstTime) {
      logger.debug(`Creating user ID path: ${this._userIdPath}`);
      fs.mkdirSync(path.dirname(this._userIdPath), { recursive: true });
      const newUserId = generateUUID();
      fs.writeFileSync(this._userIdPath, newUserId);
      logger.debug(`User ID path created: ${this._userIdPath}`);
      return newUserId;
    }

    return fs.readFileSync(this._userIdPath, "utf-8").trim();
  }

  /**
   * Get or create user ID from localStorage (Browser)
   */
  private _getUserIdFromLocalStorage(): string {
    try {
      let userId = localStorage.getItem(USER_ID_STORAGE_KEY);

      if (!userId) {
        userId = generateUUID();
        localStorage.setItem(USER_ID_STORAGE_KEY, userId);
        logger.debug(`Created new browser user ID`);
      }

      return userId;
    } catch (e) {
      logger.debug(`localStorage access failed: ${e}`);
      // Fallback to session-based
      return `session-${generateUUID()}`;
    }
  }

  private _getCacheHome(os: any, path: any): string {
    // XDG_CACHE_HOME for Linux and manually set envs
    const envVar = process.env.XDG_CACHE_HOME;
    if (envVar && path.isAbsolute(envVar)) {
      return envVar;
    }

    const platform = process.platform;
    const homeDir = os.homedir();

    if (platform === "win32") {
      const appdata = process.env.LOCALAPPDATA || process.env.APPDATA;
      if (appdata) {
        return appdata;
      }
      return path.join(homeDir, "AppData", "Local");
    } else if (platform === "darwin") {
      // macOS
      return path.join(homeDir, "Library", "Caches");
    } else {
      // Linux or other Unix
      return path.join(homeDir, ".cache");
    }
  }

  async capture(event: BaseTelemetryEvent): Promise<void> {
    // Wait for PostHog to load if it's still initializing
    if (this._posthogLoading) {
      await this._posthogLoading;
    }

    if (
      !this._posthogNodeClient &&
      !this._posthogBrowserClient &&
      !this._scarfClient
    ) {
      return;
    }

    // Add metadata to all events
    const properties = { ...event.properties };
    properties.mcp_use_version = getPackageVersion();
    properties.language = "typescript";
    properties.source = this._source;
    properties.runtime = this._runtimeEnvironment;

    // Send to PostHog (Node.js)
    if (this._posthogNodeClient) {
      try {
        logger.debug(`CAPTURE: PostHog Node Event ${event.name}`);
        this._posthogNodeClient.capture({
          distinctId: this.userId,
          event: event.name,
          properties,
        });
      } catch (e) {
        logger.debug(`Failed to track PostHog Node event ${event.name}: ${e}`);
      }
    }

    // Send to PostHog (Browser)
    if (this._posthogBrowserClient) {
      try {
        logger.debug(`CAPTURE: PostHog Browser Event ${event.name}`);
        this._posthogBrowserClient.capture(event.name, {
          ...properties,
          distinct_id: this.userId,
        });
      } catch (e) {
        logger.debug(
          `Failed to track PostHog Browser event ${event.name}: ${e}`
        );
      }
    }

    // Send to Scarf
    if (this._scarfClient) {
      try {
        const scarfProperties: Record<string, any> = {
          ...properties,
          user_id: this.userId,
          event: event.name,
        };
        await this._scarfClient.logEvent(scarfProperties);
      } catch (e) {
        logger.debug(`Failed to track Scarf event ${event.name}: ${e}`);
      }
    }
  }

  // ============================================================================
  // Package Download Tracking (Node.js only)
  // ============================================================================

  /**
   * Track package download event.
   * This is a public wrapper that safely accesses userId.
   */
  async trackPackageDownload(properties?: Record<string, any>): Promise<void> {
    return this._trackPackageDownloadInternal(this.userId, properties);
  }

  /**
   * Internal method to track package download with explicit userId.
   */
  private async _trackPackageDownloadInternal(
    userId: string,
    properties?: Record<string, any>
  ): Promise<void> {
    if (!this._scarfClient) {
      return;
    }

    // Only track downloads in filesystem environments (can persist version)
    if (this._storageCapability !== "filesystem") {
      return;
    }

    try {
      const fs = require("node:fs");
      const path = require("node:path");
      const os = require("node:os");

      if (!this._versionDownloadPath) {
        this._versionDownloadPath = path.join(
          this._getCacheHome(os, path),
          "mcp_use",
          "download_version"
        );
      }

      const currentVersion = getPackageVersion();
      let shouldTrack = false;
      let firstDownload = false;

      // Check if version file exists
      if (!fs.existsSync(this._versionDownloadPath)) {
        // First download
        shouldTrack = true;
        firstDownload = true;

        // Create directory and save version
        fs.mkdirSync(path.dirname(this._versionDownloadPath), {
          recursive: true,
        });
        fs.writeFileSync(this._versionDownloadPath, currentVersion);
      } else {
        // Read saved version
        const savedVersion = fs
          .readFileSync(this._versionDownloadPath, "utf-8")
          .trim();

        // Compare versions
        if (currentVersion > savedVersion) {
          shouldTrack = true;
          firstDownload = false;

          // Update saved version
          fs.writeFileSync(this._versionDownloadPath, currentVersion);
        }
      }

      if (shouldTrack) {
        logger.debug(
          `Tracking package download event with properties: ${JSON.stringify(properties)}`
        );
        const eventProperties = { ...(properties || {}) };
        eventProperties.mcp_use_version = currentVersion;
        eventProperties.user_id = userId;
        eventProperties.event = "package_download";
        eventProperties.first_download = firstDownload;
        eventProperties.language = "typescript";
        eventProperties.source = this._source;
        eventProperties.runtime = this._runtimeEnvironment;

        await this._scarfClient.logEvent(eventProperties);
      }
    } catch (e) {
      logger.debug(`Failed to track Scarf package_download event: ${e}`);
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
   * Browser only - no-op in Node.js
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
   * Browser only - no-op in Node.js
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
  // Node.js-specific Methods
  // ============================================================================

  /**
   * Flush the telemetry queue (Node.js only)
   */
  flush(): void {
    if (this._posthogNodeClient) {
      try {
        this._posthogNodeClient.flush();
        logger.debug("PostHog client telemetry queue flushed");
      } catch (e) {
        logger.debug(`Failed to flush PostHog client: ${e}`);
      }
    }
  }

  /**
   * Shutdown the telemetry client (Node.js only)
   */
  shutdown(): void {
    if (this._posthogNodeClient) {
      try {
        this._posthogNodeClient.shutdown();
        logger.debug("PostHog client shutdown successfully");
      } catch (e) {
        logger.debug(`Error shutting down PostHog client: ${e}`);
      }
    }
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
