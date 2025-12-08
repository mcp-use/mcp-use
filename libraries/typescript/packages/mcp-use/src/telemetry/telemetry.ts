import type {
  BaseTelemetryEvent,
  MCPAgentExecutionEventData,
  ServerRunEventData,
  ServerInitializeEventData,
  ServerToolCallEventData,
  ServerResourceCallEventData,
  ServerPromptCallEventData,
  ServerContextEventData,
  MCPClientInitEventData,
  ConnectorInitEventData,
  MCPServerTelemetryInfo,
} from "./events.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PostHog } from "posthog-node";
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

    // Check for Node.js
    if (
      typeof process !== "undefined" &&
      typeof process.versions?.node !== "undefined" &&
      typeof fs !== "undefined" &&
      typeof fs.existsSync === "function"
    ) {
      return "node";
    }

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
 * Check if we're in a Node.js environment (for backwards compatibility)
 */
function isNodeJSEnvironment(): boolean {
  const env = getRuntimeEnvironment();
  return env === "node" || env === "bun";
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

function getCacheHome(): string {
  // Return a safe fallback for non-Node.js environments
  if (!isNodeJSEnvironment()) {
    return "/tmp/mcp_use_cache";
  }

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

export class Telemetry {
  private static instance: Telemetry | null = null;

  private readonly USER_ID_PATH = path.join(
    getCacheHome(),
    "mcp_use_3",
    "telemetry_user_id"
  );
  private readonly VERSION_DOWNLOAD_PATH = path.join(
    getCacheHome(),
    "mcp_use",
    "download_version"
  );
  private readonly PROJECT_API_KEY =
    "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI";
  private readonly HOST = "https://eu.i.posthog.com";
  private readonly SCARF_GATEWAY_URL =
    "https://mcpuse.gateway.scarf.sh/events-ts";
  private readonly UNKNOWN_USER_ID = "UNKNOWN_USER_ID";

  private _currUserId: string | null = null;
  private _posthogClient: PostHog | null = null;
  private _scarfClient: ScarfEventLogger | null = null;
  private _runtimeEnvironment: RuntimeEnvironment;
  private _storageCapability: StorageCapability;
  private _source: string;

  private constructor() {
    // Detect runtime environment
    this._runtimeEnvironment = getRuntimeEnvironment();
    this._storageCapability = getStorageCapability(this._runtimeEnvironment);

    // Set source from environment variable, or use detected runtime environment
    this._source =
      (typeof process !== "undefined" &&
        process.env?.MCP_USE_TELEMETRY_SOURCE) ||
      this._runtimeEnvironment;

    // Safely access environment variables
    const telemetryDisabled =
      (typeof process !== "undefined" &&
        process.env?.MCP_USE_ANONYMIZED_TELEMETRY?.toLowerCase() === "false") ||
      false;

    // All environments except "unknown" can support telemetry
    // posthog-node works in Node.js, Bun, Cloudflare Workers, Edge, Deno, etc.
    // See: https://posthog.com/docs/libraries/cloudflare-workers
    const canSupportTelemetry = this._runtimeEnvironment !== "unknown";

    // Serverless/edge environments need immediate flushing
    const isServerlessEnvironment = [
      "cloudflare-workers",
      "edge",
      "deno",
    ].includes(this._runtimeEnvironment);

    if (telemetryDisabled) {
      this._posthogClient = null;
      this._scarfClient = null;
      logger.debug("Telemetry disabled via environment variable");
    } else if (!canSupportTelemetry) {
      this._posthogClient = null;
      this._scarfClient = null;
      logger.debug(
        `Telemetry disabled - unknown environment: ${this._runtimeEnvironment}`
      );
    } else {
      logger.info(
        "Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false to disable."
      );

      // Initialize PostHog
      // posthog-node works in Node.js, Bun, Cloudflare Workers, Edge, and other serverless environments
      // Browser requires posthog-js which is a different package
      if (this._runtimeEnvironment !== "browser") {
        try {
          // For serverless environments, flush immediately to prevent data loss
          // See: https://posthog.com/docs/libraries/node#short-lived-processes-like-serverless-environments
          const posthogOptions: { host: string; disableGeoip: boolean; flushAt?: number; flushInterval?: number } = {
            host: this.HOST,
            disableGeoip: false,
          };

          if (isServerlessEnvironment) {
            posthogOptions.flushAt = 1; // Send events immediately
            posthogOptions.flushInterval = 0; // Don't wait for interval
          }

          this._posthogClient = new PostHog(this.PROJECT_API_KEY, posthogOptions);
        } catch (e) {
          logger.warn(`Failed to initialize PostHog telemetry: ${e}`);
          this._posthogClient = null;
        }
      } else {
        // Browser environment would need posthog-js (different package)
        // For now, only use Scarf in browser
        this._posthogClient = null;
      }

      // Initialize Scarf (works in all environments with fetch)
      try {
        this._scarfClient = new ScarfEventLogger(this.SCARF_GATEWAY_URL, 3000);
      } catch (e) {
        logger.warn(`Failed to initialize Scarf telemetry: ${e}`);
        this._scarfClient = null;
      }
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
   * Returns false if telemetry was disabled via environment variable or if not in Node.js environment.
   */
  get isEnabled(): boolean {
    return this._posthogClient !== null || this._scarfClient !== null;
  }

  get userId(): string {
    if (this._currUserId) {
      return this._currUserId;
    }

    try {
      switch (this._storageCapability) {
        case "filesystem":
          this._currUserId = this.getUserIdFromFilesystem();
          break;
        case "localStorage":
          this._currUserId = this.getUserIdFromLocalStorage();
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
      // Note: We pass the userId directly to avoid circular dependency
      // (trackPackageDownload accesses this.userId which would cause issues)
      if (this._storageCapability === "filesystem" && this._currUserId) {
        // Note: We can't await here since this is a getter, so we fire and forget
        this.trackPackageDownloadInternal(this._currUserId, {
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
  private getUserIdFromFilesystem(): string {
    const isFirstTime = !fs.existsSync(this.USER_ID_PATH);

    if (isFirstTime) {
      logger.debug(`Creating user ID path: ${this.USER_ID_PATH}`);
      fs.mkdirSync(path.dirname(this.USER_ID_PATH), { recursive: true });
      const newUserId = generateUUID();
      fs.writeFileSync(this.USER_ID_PATH, newUserId);
      logger.debug(`User ID path created: ${this.USER_ID_PATH}`);
      return newUserId;
    }

    return fs.readFileSync(this.USER_ID_PATH, "utf-8").trim();
  }

  /**
   * Get or create user ID from localStorage (Browser)
   */
  private getUserIdFromLocalStorage(): string {
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

  async capture(event: BaseTelemetryEvent): Promise<void> {
    logger.debug(
      `CAPTURE: posthog: ${this._posthogClient !== null}, scarf: ${this._scarfClient !== null}`
    );
    if (!this._posthogClient && !this._scarfClient) {
      return;
    }

    // Send to PostHog
    if (this._posthogClient) {
      try {
        // Add metadata to all events
        const properties = { ...event.properties };
        properties.mcp_use_version = getPackageVersion();
        properties.language = "typescript"; // SDK language (always typescript for this package)
        properties.source = this._source; // Runtime environment or custom source
        properties.runtime = this._runtimeEnvironment; // Detected runtime

        logger.debug(`CAPTURE: PostHog Event ${event.name}`);
        logger.debug(
          `CAPTURE: PostHog Properties ${JSON.stringify(properties)}`
        );

        this._posthogClient.capture({
          distinctId: this.userId,
          event: event.name,
          properties,
        });
      } catch (e) {
        logger.debug(`Failed to track PostHog event ${event.name}: ${e}`);
      }
    }

    // Send to Scarf
    if (this._scarfClient) {
      try {
        // Add metadata to all events
        const properties: Record<string, any> = {};
        properties.mcp_use_version = getPackageVersion();
        properties.user_id = this.userId;
        properties.event = event.name;
        properties.language = "typescript"; // SDK language
        properties.source = this._source; // Runtime environment or custom source
        properties.runtime = this._runtimeEnvironment; // Detected runtime

        await this._scarfClient.logEvent(properties);
      } catch (e) {
        logger.debug(`Failed to track Scarf event ${event.name}: ${e}`);
      }
    }
  }

  /**
   * Track package download event.
   * This is a public wrapper that safely accesses userId.
   */
  async trackPackageDownload(properties?: Record<string, any>): Promise<void> {
    return this.trackPackageDownloadInternal(this.userId, properties);
  }

  /**
   * Internal method to track package download with explicit userId.
   * This avoids circular dependency when called from the userId getter.
   */
  private async trackPackageDownloadInternal(
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
      const currentVersion = getPackageVersion();
      let shouldTrack = false;
      let firstDownload = false;

      // Check if version file exists
      if (!fs.existsSync(this.VERSION_DOWNLOAD_PATH)) {
        // First download
        shouldTrack = true;
        firstDownload = true;

        // Create directory and save version
        fs.mkdirSync(path.dirname(this.VERSION_DOWNLOAD_PATH), {
          recursive: true,
        });
        fs.writeFileSync(this.VERSION_DOWNLOAD_PATH, currentVersion);
      } else {
        // Read saved version
        const savedVersion = fs
          .readFileSync(this.VERSION_DOWNLOAD_PATH, "utf-8")
          .trim();

        // Compare versions (simple string comparison for now)
        if (currentVersion > savedVersion) {
          shouldTrack = true;
          firstDownload = false;

          // Update saved version
          fs.writeFileSync(this.VERSION_DOWNLOAD_PATH, currentVersion);
        }
      }

      if (shouldTrack) {
        logger.debug(
          `Tracking package download event with properties: ${JSON.stringify(properties)}`
        );
        // Add metadata to event
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
   * This extracts the necessary data from the server and creates the event.
   * @param server - The MCPServer instance (or any object conforming to MCPServerTelemetryInfo)
   * @param transport - The transport type (e.g., "http", "stdio", "supabase")
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

  flush(): void {
    // Flush PostHog
    if (this._posthogClient) {
      try {
        this._posthogClient.flush();
        logger.debug("PostHog client telemetry queue flushed");
      } catch (e) {
        logger.debug(`Failed to flush PostHog client: ${e}`);
      }
    }

    // Scarf events are sent immediately, no flush needed
    if (this._scarfClient) {
      logger.debug("Scarf telemetry events sent immediately (no flush needed)");
    }
  }

  shutdown(): void {
    // Shutdown PostHog
    if (this._posthogClient) {
      try {
        this._posthogClient.shutdown();
        logger.debug("PostHog client shutdown successfully");
      } catch (e) {
        logger.debug(`Error shutting down PostHog client: ${e}`);
      }
    }

    // Scarf doesn't require explicit shutdown
    if (this._scarfClient) {
      logger.debug("Scarf telemetry client shutdown (no action needed)");
    }
  }
}
