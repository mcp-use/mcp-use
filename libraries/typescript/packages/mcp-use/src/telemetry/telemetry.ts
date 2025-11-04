import type {
  BaseTelemetryEvent,
  MCPAgentExecutionEventData,
} from "./events.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PostHog } from "posthog-node";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logging.js";
import { MCPAgentExecutionEvent } from "./events.js";
import { getPackageVersion } from "./utils.js";

// Environment detection function
function isNodeJSEnvironment(): boolean {
  try {
    // Check for Cloudflare Workers specifically
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent?.includes("Cloudflare-Workers")
    ) {
      return false;
    }

    // Check for other edge runtime indicators
    if (
      typeof (globalThis as any).EdgeRuntime !== "undefined" ||
      typeof (globalThis as any).Deno !== "undefined"
    ) {
      return false;
    }

    // Check for Node.js specific globals that are not available in edge environments
    const hasNodeGlobals =
      typeof process !== "undefined" &&
      typeof process.platform !== "undefined" &&
      typeof __dirname !== "undefined";

    // Check for Node.js modules
    const hasNodeModules =
      typeof fs !== "undefined" &&
      typeof os !== "undefined" &&
      typeof fs.existsSync === "function";

    return hasNodeGlobals && hasNodeModules;
  } catch {
    return false;
  }
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
  private _source: string = "typescript";

  private constructor() {
    // Check if we're in a Node.js environment first
    const isNodeJS = isNodeJSEnvironment();

    // Safely access environment variables
    const telemetryDisabled =
      (typeof process !== "undefined" &&
        process.env?.MCP_USE_ANONYMIZED_TELEMETRY?.toLowerCase() === "false") ||
      false;

    // Check for source from environment variable, default to 'typescript'
    this._source =
      (typeof process !== "undefined" &&
        process.env?.MCP_USE_TELEMETRY_SOURCE) ||
      "typescript";

    if (telemetryDisabled) {
      this._posthogClient = null;
      this._scarfClient = null;
      logger.debug("Telemetry disabled via environment variable");
    } else if (!isNodeJS) {
      this._posthogClient = null;
      this._scarfClient = null;
      logger.debug(
        "Telemetry disabled - non-Node.js environment detected (e.g., Cloudflare Workers)"
      );
    } else {
      logger.info(
        "Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false to disable."
      );

      // Initialize PostHog
      try {
        this._posthogClient = new PostHog(this.PROJECT_API_KEY, {
          host: this.HOST,
          disableGeoip: false,
        });
      } catch (e) {
        logger.warn(`Failed to initialize PostHog telemetry: ${e}`);
        this._posthogClient = null;
      }

      // Initialize Scarf
      try {
        this._scarfClient = new ScarfEventLogger(this.SCARF_GATEWAY_URL, 3000);
      } catch (e) {
        logger.warn(`Failed to initialize Scarf telemetry: ${e}`);
        this._scarfClient = null;
      }
    }
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

  get userId(): string {
    if (this._currUserId) {
      return this._currUserId;
    }

    // If we're not in a Node.js environment, just return a static user ID
    if (!isNodeJSEnvironment()) {
      this._currUserId = this.UNKNOWN_USER_ID;
      return this._currUserId;
    }

    try {
      const isFirstTime = !fs.existsSync(this.USER_ID_PATH);

      if (isFirstTime) {
        logger.debug(`Creating user ID path: ${this.USER_ID_PATH}`);
        fs.mkdirSync(path.dirname(this.USER_ID_PATH), { recursive: true });
        const newUserId = uuidv4();
        fs.writeFileSync(this.USER_ID_PATH, newUserId);
        this._currUserId = newUserId;
        logger.debug(`User ID path created: ${this.USER_ID_PATH}`);
      } else {
        this._currUserId = fs.readFileSync(this.USER_ID_PATH, "utf-8").trim();
      }

      // Always check for version-based download tracking
      // Note: We can't await here since this is a getter, so we fire and forget
      this.trackPackageDownload({
        triggered_by: "user_id_property",
      }).catch((e) => logger.debug(`Failed to track package download: ${e}`));
    } catch (e) {
      logger.debug(`Failed to get/create user ID: ${e}`);
      this._currUserId = this.UNKNOWN_USER_ID;
    }

    return this._currUserId;
  }

  async capture(event: BaseTelemetryEvent): Promise<void> {
    if (!this._posthogClient && !this._scarfClient) {
      return;
    }

    // Send to PostHog
    if (this._posthogClient) {
      try {
        // Add package version, language flag, and source to all events
        const properties = { ...event.properties };
        properties.mcp_use_version = getPackageVersion();
        properties.language = "typescript";
        properties.source = this._source;

        this._posthogClient.capture({
          distinctId: this.userId,
          event: event.name,
          properties,
        });
      } catch (e) {
        logger.debug(`Failed to track PostHog event ${event.name}: ${e}`);
      }
    }

    // Send to Scarf (when implemented)
    if (this._scarfClient) {
      try {
        // Add package version, user_id, language flag, and source to all events
        const properties: Record<string, any> = {};
        properties.mcp_use_version = getPackageVersion();
        properties.user_id = this.userId;
        properties.event = event.name;
        properties.language = "typescript";
        properties.source = this._source;

        await this._scarfClient.logEvent(properties);
      } catch (e) {
        logger.debug(`Failed to track Scarf event ${event.name}: ${e}`);
      }
    }
  }

  async trackPackageDownload(properties?: Record<string, any>): Promise<void> {
    if (!this._scarfClient) {
      return;
    }

    // Skip tracking in non-Node.js environments
    if (!isNodeJSEnvironment()) {
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
        // Add package version, user_id, language flag, and source to event
        const eventProperties = { ...(properties || {}) };
        eventProperties.mcp_use_version = currentVersion;
        eventProperties.user_id = this.userId;
        eventProperties.event = "package_download";
        eventProperties.first_download = firstDownload;
        eventProperties.language = "typescript";
        eventProperties.source = this._source;

        await this._scarfClient.logEvent(eventProperties);
      }
    } catch (e) {
      logger.debug(`Failed to track Scarf package_download event: ${e}`);
    }
  }

  async trackAgentExecution(data: MCPAgentExecutionEventData): Promise<void> {
    const event = new MCPAgentExecutionEvent(data);
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
