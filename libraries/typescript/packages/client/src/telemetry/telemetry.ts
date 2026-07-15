/**
 * Cross-compatible telemetry: PostHog + Scarf via fetch, Web Crypto, feature-
 * detected opt-out. Optional {@link TelemetryStorage} (fs from node entry,
 * localStorage when available) for durable user ids / package-download dedup.
 */
import { logger } from "../utils/logging.js";
import { getPackageVersion } from "../utils/version.js";
import type {
  BaseTelemetryEvent,
  ConnectorInitEventData,
  MCPAgentExecutionEventData,
  MCPClientInitEventData,
} from "./events.js";
import {
  ClientAddServerEvent,
  ClientRemoveServerEvent,
  ConnectorInitEvent,
  MCPAgentExecutionEvent,
  MCPClientInitEvent,
} from "./events.js";
import { capturePostHog } from "./tel-fetch.js";

function generateUUID(): string {
  return globalThis.crypto.randomUUID();
}

function secureRandomString(): string {
  const array = new Uint8Array(8);
  globalThis.crypto.getRandomValues(array);
  return Array.from(array, (v) => v.toString(16).padStart(2, "0")).join("");
}

export type TelemetryStorage = {
  getUserId(): string | null;
  setUserId(id: string): void;
  getDownloadedVersion(): string | null;
  setDownloadedVersion(version: string): void;
};

type RuntimeEnvironment =
  | "browser"
  | "node"
  | "cloudflare-workers"
  | "edge"
  | "deno"
  | "bun"
  | "unknown";

type StorageCapability = "persistent" | "session-only";

const USER_ID_STORAGE_KEY = "mcp_use_user_id";
const PROJECT_API_KEY = "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI";
const HOST = "https://eu.i.posthog.com";
const SCARF_GATEWAY_URL = "https://mcpuse.gateway.scarf.sh/events-ts";

/** Install before first `getInstance()` — node entry wires fs storage here. */
let configuredStorage: TelemetryStorage | null = null;

export function configureTelemetryStorage(storage: TelemetryStorage): void {
  configuredStorage = storage;
}

function isLocalStorageFunctional(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    typeof localStorage.getItem === "function" &&
    typeof localStorage.setItem === "function" &&
    typeof localStorage.removeItem === "function"
  );
}

function createLocalStorageBackend(): TelemetryStorage | null {
  if (!isLocalStorageFunctional()) return null;
  try {
    localStorage.setItem("__mcp_use_test__", "1");
    localStorage.removeItem("__mcp_use_test__");
  } catch {
    return null;
  }
  return {
    getUserId() {
      try {
        return localStorage.getItem(USER_ID_STORAGE_KEY);
      } catch {
        return null;
      }
    },
    setUserId(id: string) {
      try {
        localStorage.setItem(USER_ID_STORAGE_KEY, id);
      } catch {
        // ignore
      }
    },
    // Package-download dedup is node/Scarf-oriented; localStorage unused.
    getDownloadedVersion: () => null,
    setDownloadedVersion: () => undefined,
  };
}

function detectRuntimeEnvironment(): RuntimeEnvironment {
  try {
    if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
      return "bun";
    }
    if (typeof (globalThis as { Deno?: unknown }).Deno !== "undefined") {
      return "deno";
    }
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent?.includes("Cloudflare-Workers")
    ) {
      return "cloudflare-workers";
    }
    if (
      typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !==
      "undefined"
    ) {
      return "edge";
    }
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      return "browser";
    }
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

function readSourceHint(): string | undefined {
  if (
    typeof process !== "undefined" &&
    process.env?.MCP_USE_TELEMETRY_SOURCE
  ) {
    return process.env.MCP_USE_TELEMETRY_SOURCE;
  }
  try {
    if (isLocalStorageFunctional()) {
      return localStorage.getItem("MCP_USE_TELEMETRY_SOURCE") ?? undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function isTelemetryDisabled(): boolean {
  if (
    typeof window !== "undefined" &&
    (window as unknown as { __MCP_USE_ANONYMIZED_TELEMETRY__?: boolean })
      .__MCP_USE_ANONYMIZED_TELEMETRY__ === false
  ) {
    return true;
  }
  if (
    typeof process !== "undefined" &&
    process.env?.MCP_USE_ANONYMIZED_TELEMETRY?.toLowerCase() === "false"
  ) {
    return true;
  }
  try {
    if (
      isLocalStorageFunctional() &&
      localStorage.getItem("MCP_USE_ANONYMIZED_TELEMETRY") === "false"
    ) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

class ScarfEventLogger {
  constructor(
    private endpoint: string,
    private timeout = 3000
  ) {}

  async logEvent(properties: Record<string, unknown>): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(properties),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      logger.debug(`Failed to send Scarf event: ${error}`);
    }
  }
}

function sessionId(): string {
  try {
    return `session-${generateUUID()}`;
  } catch {
    return `session-${Date.now()}-${secureRandomString()}`;
  }
}

/**
 * Shared telemetry singleton for node and browser.
 *
 * Usage: `Tel.getInstance().trackMCPClientInit(...)`
 */
export class Telemetry {
  private static instance: Telemetry | null = null;

  private readonly UNKNOWN_USER_ID = "UNKNOWN_USER_ID";

  private _currUserId: string | null = null;
  private _telemetryEnabled = false;
  private _pending = new Set<Promise<void>>();
  private _scarfClient: ScarfEventLogger | null = null;
  private _runtimeEnvironment: RuntimeEnvironment;
  private _storageCapability: StorageCapability;
  private _storage: TelemetryStorage | null;
  /** True when node entry installed fs storage (package-download dedup). */
  private _fsBacked: boolean;
  private _source: string;

  private constructor() {
    this._runtimeEnvironment = detectRuntimeEnvironment();
    this._fsBacked = configuredStorage !== null;
    this._storage =
      configuredStorage ?? createLocalStorageBackend() ?? null;
    this._storageCapability = this._storage ? "persistent" : "session-only";
    this._source = readSourceHint() || this._runtimeEnvironment;

    const disabled = isTelemetryDisabled();
    const canSupport = this._runtimeEnvironment !== "unknown";

    if (disabled) {
      this._telemetryEnabled = false;
      logger.debug("Telemetry disabled via opt-out");
    } else if (!canSupport) {
      this._telemetryEnabled = false;
      logger.debug(
        `Telemetry disabled - unknown environment: ${this._runtimeEnvironment}`
      );
    } else {
      logger.debug(
        "Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false to disable."
      );
      this._telemetryEnabled = true;
      this._scarfClient = new ScarfEventLogger(SCARF_GATEWAY_URL, 3000);

      // Package-download is Scarf/fs-backed (node entry only).
      if (this._fsBacked) {
        setTimeout(() => {
          this.trackPackageDownload({ triggered_by: "initialization" }).catch(
            (e) => logger.debug(`Failed to track package download: ${e}`)
          );
        }, 0);
      }
    }
  }

  get runtimeEnvironment(): RuntimeEnvironment {
    return this._runtimeEnvironment;
  }

  get storageCapability(): StorageCapability {
    return this._storageCapability;
  }

  static getInstance(): Telemetry {
    if (!Telemetry.instance) {
      Telemetry.instance = new Telemetry();
    }
    return Telemetry.instance;
  }

  setSource(source: string): void {
    this._source = source;
    try {
      if (isLocalStorageFunctional()) {
        localStorage.setItem("MCP_USE_TELEMETRY_SOURCE", source);
      }
    } catch {
      // ignore
    }
    logger.debug(`Telemetry source set to: ${source}`);
  }

  getSource(): string {
    return this._source;
  }

  get isEnabled(): boolean {
    return this._telemetryEnabled || this._scarfClient !== null;
  }

  get userId(): string {
    if (this._currUserId) return this._currUserId;

    try {
      if (this._storage) {
        const existing = this._storage.getUserId();
        if (existing) {
          this._currUserId = existing;
          return existing;
        }
        const id = generateUUID();
        this._storage.setUserId(id);
        this._currUserId = id;
        return id;
      }
      this._currUserId = sessionId();
    } catch {
      this._currUserId = this.UNKNOWN_USER_ID;
    }
    return this._currUserId;
  }

  async capture(event: BaseTelemetryEvent): Promise<void> {
    if (!this._telemetryEnabled && !this._scarfClient) return;

    const currentUserId = this.userId;
    const properties: Record<string, unknown> = {
      ...event.properties,
      mcp_use_version: getPackageVersion(),
      language: "typescript",
      source: this._source,
      runtime: this._runtimeEnvironment,
    };

    if (this._telemetryEnabled) {
      const p = capturePostHog({
        host: HOST,
        apiKey: PROJECT_API_KEY,
        event: event.name,
        distinctId: currentUserId,
        properties,
      });
      this._pending.add(p);
      void p.finally(() => this._pending.delete(p));
    }

    if (this._scarfClient) {
      try {
        await this._scarfClient.logEvent({
          ...properties,
          user_id: currentUserId,
          event: event.name,
        });
      } catch (e) {
        logger.debug(`Failed to track Scarf event ${event.name}: ${e}`);
      }
    }
  }

  async trackPackageDownload(
    properties?: Record<string, unknown>
  ): Promise<void> {
    // Requires fs-backed storage from the node entry.
    if (!this._scarfClient || !this._fsBacked || !this._storage) return;

    const currentVersion = getPackageVersion();
    const saved = this._storage.getDownloadedVersion();
    let firstDownload = false;
    let shouldTrack = false;

    if (!saved) {
      shouldTrack = true;
      firstDownload = true;
      this._storage.setDownloadedVersion(currentVersion);
    } else if (currentVersion > saved) {
      shouldTrack = true;
      this._storage.setDownloadedVersion(currentVersion);
    }

    if (!shouldTrack) return;

    try {
      await this._scarfClient.logEvent({
        ...(properties || {}),
        mcp_use_version: currentVersion,
        user_id: this.userId,
        event: "package_download",
        first_download: firstDownload,
        language: "typescript",
        source: this._source,
        runtime: this._runtimeEnvironment,
      });
    } catch (e) {
      logger.debug(`Failed to track Scarf package_download event: ${e}`);
    }
  }

  async trackAgentExecution(data: MCPAgentExecutionEventData): Promise<void> {
    if (!this.isEnabled) return;
    await this.capture(new MCPAgentExecutionEvent(data));
  }

  async trackMCPClientInit(data: MCPClientInitEventData): Promise<void> {
    if (!this.isEnabled) return;
    await this.capture(new MCPClientInitEvent(data));
  }

  async trackConnectorInit(data: ConnectorInitEventData): Promise<void> {
    if (!this.isEnabled) return;
    await this.capture(new ConnectorInitEvent(data));
  }

  async trackClientAddServer(
    serverName: string,
    serverConfig: Record<string, any>
  ): Promise<void> {
    if (!this.isEnabled) return;
    await this.capture(new ClientAddServerEvent({ serverName, serverConfig }));
  }

  async trackClientRemoveServer(serverName: string): Promise<void> {
    if (!this.isEnabled) return;
    await this.capture(new ClientRemoveServerEvent({ serverName }));
  }

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
        url_domain: new URL(data.url).hostname,
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
        resource_uri_scheme: data.resourceUri.split(":")[0],
        success: data.success,
        error_type: data.errorType ?? null,
      },
    });
  }

  identify(userId: string, properties?: Record<string, unknown>): void {
    this._currUserId = userId;
    this._storage?.setUserId(userId);
    if (this._telemetryEnabled) {
      void capturePostHog({
        host: HOST,
        apiKey: PROJECT_API_KEY,
        event: "$identify",
        distinctId: userId,
        properties: { $set: properties ?? {} },
      });
    }
  }

  reset(): void {
    this._currUserId = null;
  }

  flush(): void {
    void Promise.allSettled([...this._pending]);
  }

  async shutdown(): Promise<void> {
    try {
      await Promise.allSettled([...this._pending]);
      logger.debug("Telemetry fetch captures flushed");
    } catch (e) {
      logger.debug(`Error flushing telemetry captures: ${e}`);
    }
  }
}

/** @alias */
export const Tel = Telemetry;

export function setTelemetrySource(source: string): void {
  Tel.getInstance().setSource(source);
}
