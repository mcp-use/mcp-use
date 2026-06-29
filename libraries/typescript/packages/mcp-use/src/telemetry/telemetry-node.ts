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
  type ClientServerConfigTelemetryInput,
  ClientRemoveServerEvent,
  createServerRunEventData,
} from "./events.js";
import { getPackageVersion } from "./utils.js";
import { telFetch } from "./tel-fetch.js";

/**
 * Produce a random identifier suitable for session or user IDs.
 *
 * Falls back to a Math.random-based string if Node's crypto module is unavailable.
 *
 * @returns A 16-character hexadecimal string generated via `crypto.randomBytes(8)`; if `crypto` is unavailable, a base-36 string produced from `Math.random()`.
 */
function secureRandomString(): string {
  // Node.js - use crypto module
  // Note: Using require() here instead of dynamic import because this function
  // is called synchronously. In ESM-only environments, this will fail gracefully
  // and fall back to Math.random(). The try-catch ensures compatibility.
  try {
    const crypto = require("crypto");
    return crypto.randomBytes(8).toString("hex");
  } catch (e) {
    // Fallback to Math.random (should not happen in Node.js, but handles ESM-only environments)
    return Math.random().toString(36).substring(2, 15);
  }
}

type RuntimeEnvironment =
  | "node"
  | "cloudflare-workers"
  | "edge"
  | "deno"
  | "bun"
  | "unknown";

type StorageCapability = "filesystem" | "session-only";

type TelemetryPayload = Record<string, unknown>;
type NodeFs = typeof import("node:fs");
type NodeOs = typeof import("node:os");
type NodePath = typeof import("node:path");
type RuntimeGlobal = typeof globalThis & {
  Bun?: unknown;
  Deno?: unknown;
  EdgeRuntime?: unknown;
};

/**
 * Determine the current runtime environment: Bun, Deno, Cloudflare Workers, Edge runtime, Node.js, or `unknown`.
 *
 * @returns The detected RuntimeEnvironment: `bun`, `deno`, `cloudflare-workers`, `edge`, `node`, or `unknown`.
 */
function detectRuntimeEnvironment(): RuntimeEnvironment {
  try {
    const runtimeGlobal = globalThis as RuntimeGlobal;
    // Check for Bun
    if (typeof runtimeGlobal.Bun !== "undefined") {
      return "bun";
    }

    // Check for Deno
    if (typeof runtimeGlobal.Deno !== "undefined") {
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
    if (typeof runtimeGlobal.EdgeRuntime !== "undefined") {
      return "edge";
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
 * Map a runtime environment to its storage capability.
 *
 * @param env - Runtime environment to evaluate.
 * @returns `"filesystem"` for environments that support filesystem access (`"node"`, `"bun"`); `"session-only"` for all others (including `"deno"`).
 */
function getStorageCapability(env: RuntimeEnvironment): StorageCapability {
  switch (env) {
    case "node":
    case "bun":
      return "filesystem";
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

// Simple Scarf event logger implementation
class ScarfEventLogger {
  private endpoint: string;
  private timeout: number;

  constructor(endpoint: string, timeout: number = 3000) {
    this.endpoint = endpoint;
    this.timeout = timeout;
  }

  async logEvent(properties: TelemetryPayload): Promise<void> {
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

class RawPostHogClient {
  private readonly apiKey: string;
  private readonly host: string;
  private readonly flushAt: number;
  private queue: Array<{
    distinctId: string;
    event: string;
    properties?: TelemetryPayload;
    timestamp: string;
  }> = [];
  private flushing: Promise<void> | null = null;

  constructor(apiKey: string, host: string, flushAt = 20) {
    this.apiKey = apiKey;
    this.host = host.replace(/\/$/, "");
    this.flushAt = flushAt;
  }

  capture(params: {
    distinctId: string;
    event: string;
    properties?: TelemetryPayload;
  }): void {
    this.queue.push({ ...params, timestamp: new Date().toISOString() });
    if (this.queue.length >= this.flushAt) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    this.flushing = telFetch(`${this.host}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        batch: batch.map((event) => ({
          event: event.event,
          distinct_id: event.distinctId,
          properties: event.properties,
          timestamp: event.timestamp,
        })),
      }),
    })
      .then(() => undefined)
      .finally(() => {
        this.flushing = null;
      });

    await this.flushing;
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}

/**
 * Node.js Telemetry class that works in Node.js environments only.
 *
 * Uses raw fetch for telemetry, require("crypto") for secure random strings,
 * and filesystem for user ID persistence.
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
  private _posthogClient: RawPostHogClient | null = null;
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
      logger.debug(
        "Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false to disable."
      );

      this._posthogClient = new RawPostHogClient(
        this.PROJECT_API_KEY,
        this.HOST,
        ["cloudflare-workers", "edge", "deno"].includes(
          this._runtimeEnvironment
        )
          ? 1
          : 20
      );

      // Initialize Scarf (server-side only)
      try {
        this._scarfClient = new ScarfEventLogger(this.SCARF_GATEWAY_URL, 3000);
      } catch (e) {
        logger.warn(`Failed to initialize Scarf telemetry: ${e}`);
        this._scarfClient = null;
      }

      // Track package download asynchronously (non-blocking)
      // This runs after construction completes and only tracks on first use or version upgrade
      if (this._storageCapability === "filesystem" && this._scarfClient) {
        // Use setTimeout to ensure this runs after constructor completes
        setTimeout(() => {
          this.trackPackageDownload({ triggered_by: "initialization" }).catch(
            (e) => logger.debug(`Failed to track package download: ${e}`)
          );
        }, 0);
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
    return this._posthogClient !== null || this._scarfClient !== null;
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
   * Get or create user ID from filesystem (Node.js/Bun)
   * Falls back to session ID if filesystem operations fail
   */
  private _getUserIdFromFilesystem(): string {
    try {
      // Try to load Node.js modules
      // In CJS context, require should work
      // In ESM context, this will fail but we'll fall back gracefully
      let fs: NodeFs, os: NodeOs, path: NodePath;

      try {
        fs = require("node:fs") as NodeFs;
        os = require("node:os") as NodeOs;
        path = require("node:path") as NodePath;
      } catch (requireError) {
        // require not available (ESM build) - fall back to session ID
        // Generate session-based ID as fallback
        try {
          const sessionId = `session-${generateUUID()}`;
          return sessionId;
        } catch (uuidError) {
          return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        }
      }

      // If we got here, fs/os/path are available
      if (!this._userIdPath) {
        this._userIdPath = path.join(
          this._getCacheHome(os, path),
          "mcp_use_3",
          "telemetry_user_id"
        );
      }

      const isFirstTime = !fs.existsSync(this._userIdPath);

      if (isFirstTime) {
        fs.mkdirSync(path.dirname(this._userIdPath), { recursive: true });
        let newUserId: string;
        try {
          newUserId = generateUUID();
        } catch (uuidError) {
          newUserId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        }
        fs.writeFileSync(this._userIdPath, newUserId);
        return newUserId;
      }

      const userId = fs.readFileSync(this._userIdPath, "utf-8").trim();
      return userId;
    } catch (e) {
      // Final fallback - generate a session ID
      try {
        return `session-${generateUUID()}`;
      } catch (uuidError) {
        return `session-${Date.now()}-${secureRandomString()}`;
      }
    }
  }

  private _getCacheHome(os: NodeOs, path: NodePath): string {
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
    if (!this._posthogClient && !this._scarfClient) {
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

    // Send to PostHog via dependency-free raw fetch.
    if (this._posthogClient) {
      try {
        this._posthogClient.capture({
          distinctId: currentUserId,
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
        const scarfProperties: TelemetryPayload = {
          ...properties,
          user_id: currentUserId,
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
  async trackPackageDownload(properties?: TelemetryPayload): Promise<void> {
    return this._trackPackageDownloadInternal(this.userId, properties);
  }

  /**
   * Internal method to track package download with explicit userId.
   */
  private async _trackPackageDownloadInternal(
    userId: string,
    properties?: TelemetryPayload
  ): Promise<void> {
    if (!this._scarfClient) {
      return;
    }

    // Only track downloads in filesystem environments (can persist version)
    if (this._storageCapability !== "filesystem") {
      return;
    }

    try {
      const fs = require("node:fs") as NodeFs;
      const path = require("node:path") as NodePath;
      const os = require("node:os") as NodeOs;

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
    serverConfig: ClientServerConfigTelemetryInput
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
  // React Hook / Browser specific events (no-ops in Node.js)
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
    // No-op in Node.js - this is browser-specific
  }

  async trackUseMcpToolCall(data: {
    toolName: string;
    success: boolean;
    errorType?: string | null;
    executionTimeMs?: number | null;
  }): Promise<void> {
    // No-op in Node.js - this is browser-specific
  }

  async trackUseMcpResourceRead(data: {
    resourceUri: string;
    success: boolean;
    errorType?: string | null;
  }): Promise<void> {
    // No-op in Node.js - this is browser-specific
  }

  // ============================================================================
  // Browser-specific Methods (no-ops in Node.js)
  // ============================================================================

  /**
   * Identify the current user (browser only - no-op in Node.js)
   */
  identify(userId: string, properties?: TelemetryPayload): void {
    // No-op in Node.js
  }

  /**
   * Reset the user identity (browser only - no-op in Node.js)
   */
  reset(): void {
    this._currUserId = null;
  }

  // ============================================================================
  // Node.js-specific Methods
  // ============================================================================

  /**
   * Flush the telemetry queue (Node.js only)
   */
  flush(): void {
    if (this._posthogClient) {
      this._posthogClient
        .flush()
        .then(() => logger.debug("PostHog telemetry queue flushed"))
        .catch((e) => logger.debug(`Failed to flush PostHog client: ${e}`));
    }
  }

  /**
   * Shutdown the telemetry client (Node.js only)
   */
  async shutdown(): Promise<void> {
    if (this._posthogClient) {
      try {
        await this._posthogClient.shutdown();
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
/** @alias */
export const Tel = Telemetry;

/**
 * Convenience function to set telemetry source globally
 */
export function setTelemetrySource(source: string): void {
  Tel.getInstance().setSource(source);
}
