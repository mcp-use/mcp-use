import type { BaseTelemetryEvent } from "./events.js";
import { MCPInspectorOpenEvent } from "./events.js";
import { getPackageVersion } from "./utils.js";
import { getApiUrl } from "../utils/api.js";

// Environment detection function
function isBrowserEnvironment(): boolean {
  try {
    return typeof window !== "undefined" && typeof document !== "undefined";
  } catch {
    return false;
  }
}

class TelemetryEventLogger {
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
    } catch {
      // Silently fail - telemetry should not break the application
    }
  }
}

function getCacheKey(key: string): string {
  return `mcp_inspector_telemetry_${key}`;
}

export class Telemetry {
  private static instance: Telemetry | null = null;

  private readonly UNKNOWN_USER_ID = "UNKNOWN_USER_ID";

  private _currUserId: string | null = null;
  private _posthogClient: TelemetryEventLogger | null = null;
  private _scarfClient: TelemetryEventLogger | null = null;
  private _source: string = "inspector";

  private constructor() {
    // Check if we're in a browser environment first
    const isBrowser = isBrowserEnvironment();

    // Safely access environment variables or check localStorage
    const telemetryDisabled = this.isTelemetryDisabled();

    // Check for source from localStorage or default to 'inspector'
    this._source = this.getStoredSource() || "inspector";

    if (telemetryDisabled) {
      this._posthogClient = null;
      this._scarfClient = null;
    } else if (!isBrowser) {
      this._posthogClient = null;
      this._scarfClient = null;
    } else {
      // Initialize PostHog proxy client (sends to server)
      try {
        this._posthogClient = new TelemetryEventLogger(
          getApiUrl("/inspector/api/tel/posthog"),
          3000
        );
      } catch {
        // Silently fail - telemetry should not break the application
        this._posthogClient = null;
      }

      // Initialize Scarf proxy client (sends to server)
      try {
        this._scarfClient = new TelemetryEventLogger(
          getApiUrl("/inspector/api/tel/scarf"),
          3000
        );
      } catch {
        // Silently fail - telemetry should not break the application
        this._scarfClient = null;
      }
    }
  }

  private isTelemetryDisabled(): boolean {
    // Check localStorage
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(getCacheKey("disabled"));
      if (stored === "true") return true;
    }
    // Check environment variable (if available)
    if (
      typeof process !== "undefined" &&
      process.env?.MCP_USE_ANONYMIZED_TELEMETRY === "false"
    ) {
      return true;
    }
    return false;
  }

  private getStoredSource(): string | null {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(getCacheKey("source"));
    }
    return null;
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
   * @param source - The source identifier (e.g., "inspector-web", "inspector-standalone")
   */
  setSource(source: string): void {
    this._source = source;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(getCacheKey("source"), source);
    }
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

    // If we're not in a browser environment, just return a static user ID
    if (!isBrowserEnvironment()) {
      this._currUserId = this.UNKNOWN_USER_ID;
      return this._currUserId;
    }

    try {
      // Check localStorage for existing user ID
      const storedUserId = localStorage.getItem(getCacheKey("user_id"));

      if (storedUserId) {
        this._currUserId = storedUserId;
      } else {
        // Generate new user ID
        const newUserId = this.generateUserId();
        localStorage.setItem(getCacheKey("user_id"), newUserId);
        this._currUserId = newUserId;
      }

      // Track package download on first access
      this.trackPackageDownload({
        triggered_by: "user_id_property",
      }).catch(() => {
        // Silently fail - telemetry should not break the application
      });
    } catch {
      // Silently fail - telemetry should not break the application
      this._currUserId = this.UNKNOWN_USER_ID;
    }

    return this._currUserId;
  }

  private generateUserId(): string {
    // Generate a random UUID v4 using crypto.getRandomValues for secure randomness
    const cryptoObj = window.crypto;
    if (cryptoObj) {
      // UUID v4 template: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const buffer = new Uint8Array(16);
      cryptoObj.getRandomValues(buffer);
      // Per RFC4122: set bits for version and `clock_seq_hi_and_reserved`
      buffer[6] = (buffer[6] & 0x0f) | 0x40; // version 4
      buffer[8] = (buffer[8] & 0x3f) | 0x80; // variant 10xx
      const hex = Array.from(buffer)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return (
        hex.slice(0, 8) +
        "-" +
        hex.slice(8, 12) +
        "-" +
        hex.slice(12, 16) +
        "-" +
        hex.slice(16, 20) +
        "-" +
        hex.slice(20, 32)
      );
    } else {
      // fallback (should rarely be needed; insecure)
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }
  }

  async capture(event: BaseTelemetryEvent): Promise<void> {
    if (!this._posthogClient && !this._scarfClient) {
      return;
    }

    // Send to PostHog proxy
    if (this._posthogClient) {
      try {
        // Add package version, language flag, source, and user_id to all events
        const properties: Record<string, any> = {
          event: event.name,
          user_id: this.userId, // Include user_id for distinct_id
          properties: {
            ...event.properties,
            mcp_use_version: getPackageVersion(),
            language: "typescript",
            source: this._source,
            package: "inspector",
          },
        };

        await this._posthogClient.logEvent(properties);
      } catch {
        // Silently fail - telemetry should not break the application
      }
    }

    // Send to Scarf proxy
    if (this._scarfClient) {
      try {
        // Add package version, user_id, language flag, and source to all events
        const properties: Record<string, any> = {};
        properties.mcp_use_version = getPackageVersion();
        properties.user_id = this.userId;
        properties.event = event.name;
        properties.language = "typescript";
        properties.source = this._source;
        properties.package = "inspector";

        await this._scarfClient.logEvent(properties);
      } catch {
        // Silently fail - telemetry should not break the application
      }
    }
  }

  async trackPackageDownload(properties?: Record<string, any>): Promise<void> {
    if (!this._scarfClient) {
      return;
    }

    // Skip tracking in non-browser environments
    if (!isBrowserEnvironment()) {
      return;
    }

    try {
      const currentVersion = getPackageVersion();
      let shouldTrack = false;
      let firstDownload = false;

      // Check localStorage for version
      const storedVersion = localStorage.getItem(
        getCacheKey("download_version")
      );

      if (!storedVersion) {
        // First download
        shouldTrack = true;
        firstDownload = true;
        localStorage.setItem(getCacheKey("download_version"), currentVersion);
      } else if (currentVersion > storedVersion) {
        // Version upgrade
        shouldTrack = true;
        firstDownload = false;
        localStorage.setItem(getCacheKey("download_version"), currentVersion);
      }

      if (shouldTrack) {
        // Add package version, user_id, language flag, and source to event
        const eventProperties = { ...(properties || {}) };
        eventProperties.mcp_use_version = currentVersion;
        eventProperties.user_id = this.userId;
        eventProperties.event = "package_download";
        eventProperties.first_download = firstDownload;
        eventProperties.language = "typescript";
        eventProperties.source = this._source;
        eventProperties.package = "inspector";

        await this._scarfClient.logEvent(eventProperties);
      }
    } catch {
      // Silently fail - telemetry should not break the application
    }
  }

  async trackInspectorOpen(data: {
    serverUrl?: string;
    connectionCount?: number;
  }): Promise<void> {
    const event = new MCPInspectorOpenEvent(data);
    await this.capture(event);
  }
}
