/* eslint-disable @typescript-eslint/no-require-imports */
import type { BaseTelemetryEvent } from "./events.js";
import type { TelemetryProvider } from "./provider.js";
import { getPackageVersion } from "./utils.js";
import type { RuntimeEnvironment, StorageCapability } from "./env.js";
import { getRuntimeEnvironment, getStorageCapability } from "./env.js";
import { generateUUID, secureRandomString } from "./id-utils.js";

// Simple logger shim
const logger = {
  debug: (msg: string) => {
    if (typeof console !== "undefined" && console.debug) {
      console.debug(`[Telemetry:Node] ${msg}`);
    }
  },
  warn: (msg: string) => {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[Telemetry:Node] ${msg}`);
    }
  },
};

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
      // @ts-ignore - AbortController exists in Node 16+
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      // @ts-ignore - fetch exists in Node 18+ or needs polyfill
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

// PostHog types for Node
type PostHogNodeClient = {
  capture: (params: {
    distinctId: string;
    event: string;
    properties?: Record<string, any>;
  }) => void;
  flush: () => void;
  shutdown: () => void;
};

export class NodeTelemetryProvider implements TelemetryProvider {
  private readonly PROJECT_API_KEY =
    "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI";
  private readonly HOST = "https://eu.i.posthog.com";
  private readonly SCARF_GATEWAY_URL =
    "https://mcpuse.gateway.scarf.sh/events-ts";

  private _posthogNodeClient: PostHogNodeClient | null = null;
  private _posthogLoading: Promise<void> | null = null;
  private _scarfClient: ScarfEventLogger | null = null;

  private _runtimeEnvironment: RuntimeEnvironment;
  private _storageCapability: StorageCapability;
  private _currUserId: string | null = null;
  private _userIdPath: string | null = null;
  private _versionDownloadPath: string | null = null;
  private _disabled = false;

  constructor() {
    this._runtimeEnvironment = getRuntimeEnvironment();
    this._storageCapability = getStorageCapability(this._runtimeEnvironment);
    this._disabled = this._checkTelemetryDisabled();

    if (!this._disabled) {
      // Initialize PostHog
      this._posthogLoading = this._initPostHogNode();

      // Initialize Scarf
      try {
        this._scarfClient = new ScarfEventLogger(this.SCARF_GATEWAY_URL, 3000);
      } catch (e) {
        logger.warn(`Failed to initialize Scarf telemetry: ${e}`);
        this._scarfClient = null;
      }

      // Track package download
      if (this._storageCapability === "filesystem" && this._scarfClient) {
        setTimeout(() => {
          this.trackPackageDownload({ triggered_by: "initialization" }).catch(
            (e) => logger.debug(`Failed to track package download: ${e}`)
          );
        }, 0);
      }
    }
  }

  private _checkTelemetryDisabled(): boolean {
    if (
      typeof process !== "undefined" &&
      process.env?.MCP_USE_ANONYMIZED_TELEMETRY?.toLowerCase() === "false"
    ) {
      return true;
    }
    return false;
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
        case "session-only":
        default:
          // Fallback for non-filesystem Node environments (e.g. Lambda ephemeral)
          try {
            this._currUserId = `session-${generateUUID()}`;
          } catch (uuidError) {
            this._currUserId = `session-${Date.now()}-${secureRandomString()}`;
          }
          break;
      }
    } catch (e) {
      this._currUserId = "UNKNOWN_USER_ID";
    }

    return this._currUserId!;
  }

  private _getUserIdFromFilesystem(): string {
    try {
      let fs: any, os: any, path: any;

      try {
        fs = require("node:fs");
        os = require("node:os");
        path = require("node:path");
      } catch (requireError) {
        try {
          return `session-${generateUUID()}`;
        } catch (uuidError) {
          return `session-${Date.now()}-${secureRandomString()}`;
        }
      }

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
      try {
        return `session-${generateUUID()}`;
      } catch (uuidError) {
        return `session-${Date.now()}-${secureRandomString()}`;
      }
    }
  }

  private _getCacheHome(os: any, path: any): string {
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
      return path.join(homeDir, "Library", "Caches");
    } else {
      return path.join(homeDir, ".cache");
    }
  }

  async trackPackageDownload(properties?: Record<string, any>): Promise<void> {
    if (!this._scarfClient || this._storageCapability !== "filesystem") {
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

      if (!fs.existsSync(this._versionDownloadPath)) {
        shouldTrack = true;
        firstDownload = true;
        fs.mkdirSync(path.dirname(this._versionDownloadPath), {
          recursive: true,
        });
        fs.writeFileSync(this._versionDownloadPath, currentVersion);
      } else {
        const savedVersion = fs
          .readFileSync(this._versionDownloadPath, "utf-8")
          .trim();
        if (currentVersion > savedVersion) {
          shouldTrack = true;
          firstDownload = false;
          fs.writeFileSync(this._versionDownloadPath, currentVersion);
        }
      }

      if (shouldTrack) {
        const eventProperties = { ...(properties || {}) };
        eventProperties.mcp_use_version = currentVersion;
        eventProperties.user_id = this.userId;
        eventProperties.event = "package_download";
        eventProperties.first_download = firstDownload;
        eventProperties.language = "typescript";
        eventProperties.source = "node"; // Default source
        eventProperties.runtime = this._runtimeEnvironment;

        await this._scarfClient.logEvent(eventProperties);
      }
    } catch (e) {
      logger.debug(`Failed to track Scarf package_download event: ${e}`);
    }
  }

  isEnabled(): boolean {
    return (
      !this._disabled &&
      (this._posthogNodeClient !== null || this._scarfClient !== null)
    );
  }

  async capture(event: BaseTelemetryEvent, source?: string): Promise<void> {
    if (this._disabled) return;

    if (this._posthogLoading) {
      await this._posthogLoading;
    }

    const currentUserId = this.userId;
    const properties = { ...event.properties };
    properties.mcp_use_version = getPackageVersion();
    properties.language = "typescript";
    properties.source =
      source ||
      process.env?.MCP_USE_TELEMETRY_SOURCE ||
      this._runtimeEnvironment;
    properties.runtime = this._runtimeEnvironment;

    // Send to PostHog
    if (this._posthogNodeClient) {
      try {
        this._posthogNodeClient.capture({
          distinctId: currentUserId,
          event: event.name,
          properties,
        });
      } catch (e) {
        logger.debug(`Failed to track PostHog Node event ${event.name}: ${e}`);
      }
    }

    // Send to Scarf
    if (this._scarfClient) {
      try {
        const scarfProperties: Record<string, any> = {
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

  flush(): void {
    if (this._posthogNodeClient) {
      try {
        this._posthogNodeClient.flush();
      } catch (e) {
        logger.debug(`Failed to flush PostHog client: ${e}`);
      }
    }
  }

  shutdown(): void {
    if (this._posthogNodeClient) {
      try {
        this._posthogNodeClient.shutdown();
      } catch (e) {
        logger.debug(`Error shutting down PostHog client: ${e}`);
      }
    }
  }
}
