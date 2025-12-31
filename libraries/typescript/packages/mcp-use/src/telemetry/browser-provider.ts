/* eslint-disable @typescript-eslint/no-require-imports */
import { BaseTelemetryEvent } from "./events.js";
import { TelemetryProvider } from "./provider.js";
import { getPackageVersion } from "./utils.js";
import { generateUUID, secureRandomString } from "./id-utils.js";

// PostHog types for Browser
type PostHogBrowserClient = {
  capture: (eventName: string, properties?: Record<string, any>) => void;
  identify: (distinctId: string, properties?: Record<string, any>) => void;
  reset: () => void;
  opt_out_capturing: () => void;
  opt_in_capturing: () => void;
  init: (apiKey: string, config?: any) => void;
};

// Simple logger shim
const logger = {
  debug: (msg: string) => {
    if (typeof console !== "undefined" && console.debug) {
      console.debug(`[Telemetry:Browser] ${msg}`);
    }
  },
  warn: (msg: string) => {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[Telemetry:Browser] ${msg}`);
    }
  },
};

const USER_ID_STORAGE_KEY = "mcp_use_user_id";

export class BrowserTelemetryProvider implements TelemetryProvider {
  private readonly PROJECT_API_KEY = "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI";
  private readonly HOST = "https://eu.i.posthog.com";
  
  private _posthogBrowserClient: PostHogBrowserClient | null = null;
  private _posthogLoading: Promise<void> | null = null;
  private _currUserId: string | null = null;
  private _disabled = false;

  constructor() {
    this._disabled = this._checkTelemetryDisabled();
    
    if (!this._disabled) {
      this._posthogLoading = this._initPostHogBrowser();
    }
  }

  private _checkTelemetryDisabled(): boolean {
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

  get userId(): string {
    if (this._currUserId) {
      return this._currUserId;
    }

    try {
      if (typeof localStorage !== "undefined") {
        this._currUserId = localStorage.getItem(USER_ID_STORAGE_KEY);
        
        if (!this._currUserId) {
            try {
                this._currUserId = generateUUID();
            } catch (uuidError) {
                this._currUserId = `${Date.now()}-${secureRandomString()}`;
            }
            localStorage.setItem(USER_ID_STORAGE_KEY, this._currUserId!);
        }
      } else {
        // Session-only fallback
        try {
            this._currUserId = `session-${generateUUID()}`;
        } catch (uuidError) {
            this._currUserId = `session-${Date.now()}-${secureRandomString()}`;
        }
      }
    } catch (e) {
      this._currUserId = "UNKNOWN_USER_ID";
    }

    return this._currUserId!;
  }

  identify(userId: string, properties?: Record<string, any>): void {
    if (this._posthogBrowserClient) {
      try {
        this._posthogBrowserClient.identify(userId, properties);
      } catch (e) {
        logger.debug(`Failed to identify user: ${e}`);
      }
    }
  }

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

  isEnabled(): boolean {
    return !this._disabled && this._posthogBrowserClient !== null;
  }

  async capture(event: BaseTelemetryEvent, source?: string): Promise<void> {
    if (this._disabled) return;

    if (this._posthogLoading) {
      await this._posthogLoading;
    }

    if (!this._posthogBrowserClient) return;

    const currentUserId = this.userId;
    const properties = { ...event.properties };
    properties.mcp_use_version = getPackageVersion();
    properties.language = "typescript";
    properties.source = source || "browser";
    properties.runtime = "browser";

    try {
      this._posthogBrowserClient.capture(event.name, {
        ...properties,
        distinct_id: currentUserId,
      });
    } catch (e) {
      logger.debug(`Failed to track PostHog Browser event ${event.name}: ${e}`);
    }
  }
}

