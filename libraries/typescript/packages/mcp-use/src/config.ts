import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import type { BaseConnector, ConnectorInitOptions } from "./connectors/base.js";
import type { ClientInfo } from "./connectors/http.js";
import { HttpConnector } from "./connectors/http.js";
import { StdioConnector } from "./connectors/stdio.js";
import { getPackageVersion } from "./version.js";

/** Callback for sampling requests (canonical name). */
export type OnSamplingCallback = (
  params: CreateMessageRequest["params"]
) => Promise<CreateMessageResult>;

/** Callback for elicitation requests (canonical name). */
export type OnElicitationCallback = (
  params: ElicitRequestFormParams | ElicitRequestURLParams
) => Promise<ElicitResult>;

/** Callback for notifications (canonical name). */
export type OnNotificationCallback = (
  notification: Notification
) => void | Promise<void>;

/**
 * Callback options shared by per-server config and global defaults.
 * Canonical names: onSampling, onElicitation, onNotification.
 * Deprecated aliases: samplingCallback, elicitationCallback.
 */
export interface CallbackConfig {
  /** Callback for sampling requests from servers. */
  onSampling?: OnSamplingCallback;
  /**
   * @deprecated Use `onSampling` instead. Will be removed in a future version.
   */
  samplingCallback?: OnSamplingCallback;
  /** Callback for elicitation requests from servers. */
  onElicitation?: OnElicitationCallback;
  /**
   * @deprecated Use `onElicitation` instead. Will be removed in a future version.
   */
  elicitationCallback?: OnElicitationCallback;
  /** Callback for notifications from servers. */
  onNotification?: OnNotificationCallback;
}

/**
 * Resolves effective callbacks from per-server and global config with precedence:
 * per-server canonical > per-server deprecated alias > global canonical > global deprecated alias.
 */
export function resolveCallbacks(
  perServer: CallbackConfig | undefined,
  globalDefaults: CallbackConfig | undefined
): {
  onSampling?: OnSamplingCallback;
  onElicitation?: OnElicitationCallback;
  onNotification?: OnNotificationCallback;
} {
  const pickSampling =
    perServer?.onSampling ??
    perServer?.samplingCallback ??
    globalDefaults?.onSampling ??
    globalDefaults?.samplingCallback;
  const pickElicitation =
    perServer?.onElicitation ??
    perServer?.elicitationCallback ??
    globalDefaults?.onElicitation ??
    globalDefaults?.elicitationCallback;
  const pickNotification =
    perServer?.onNotification ?? globalDefaults?.onNotification;

  return {
    onSampling: pickSampling,
    onElicitation: pickElicitation,
    onNotification: pickNotification,
  };
}

/**
 * Base server configuration with common optional fields
 */
interface BaseServerConfig extends CallbackConfig {
  clientInfo?: ClientInfo;
}

/**
 * Server configuration for STDIO connectors
 */
export interface StdioServerConfig extends BaseServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Server configuration for HTTP connectors
 */
export interface HttpServerConfig extends BaseServerConfig {
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  authToken?: string;
  /** @deprecated Use `authToken` instead. */
  auth_token?: string;
  authProvider?: unknown;
  transport?: "http" | "sse";
  preferSse?: boolean;
  disableSseFallback?: boolean;
}

/**
 * Discriminated union of all supported server configuration types
 */
export type ServerConfig = StdioServerConfig | HttpServerConfig;

/**
 * Top-level MCP client configuration shape.
 * May include global callback defaults and clientInfo applied when per-server config omits them.
 */
export interface MCPClientConfigShape extends CallbackConfig {
  /** Default clientInfo for all servers; overridable per server. */
  clientInfo?: ClientInfo;
  mcpServers?: Record<string, ServerConfig>;
}

/**
 * Default clientInfo for mcp-use
 */
function getDefaultClientInfo(): ClientInfo {
  return {
    name: "mcp-use",
    title: "mcp-use",
    version: getPackageVersion(),
    description:
      "mcp-use is a complete TypeScript framework for building and using MCP",
    icons: [
      {
        src: "https://mcp-use.com/logo.png",
      },
    ],
    websiteUrl: "https://mcp-use.com",
  };
}

/**
 * Normalizes and validates clientInfo from config.
 * Ensures required fields (name, version) are present and merges with defaults.
 */
export function normalizeClientInfo(input: unknown): ClientInfo {
  const fallback = getDefaultClientInfo();
  if (!input || typeof input !== "object") return fallback;
  const ci = input as Partial<ClientInfo>;
  // Require name + version (SDK/client contract)
  if (!ci.name || !ci.version) return fallback;
  return { ...fallback, ...ci };
}

export function loadConfigFile(filepath: string): Record<string, any> {
  const raw = readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}

export function createConnectorFromConfig(
  serverConfig: ServerConfig,
  connectorOptions?: Partial<ConnectorInitOptions>
): BaseConnector {
  // Normalize clientInfo to ensure required fields are present
  const clientInfo = normalizeClientInfo(serverConfig.clientInfo);

  if ("command" in serverConfig && "args" in serverConfig) {
    return new StdioConnector({
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env,
      clientInfo,
      ...connectorOptions,
    });
  }

  if ("url" in serverConfig) {
    // HttpConnector automatically handles streamable HTTP with SSE fallback
    const transport = serverConfig.transport || "http";

    return new HttpConnector(serverConfig.url, {
      headers: serverConfig.headers,
      fetch: serverConfig.fetch,
      authToken: serverConfig.auth_token || serverConfig.authToken,
      authProvider: serverConfig.authProvider,
      // Only force SSE if explicitly requested
      preferSse: serverConfig.preferSse || transport === "sse",
      // Disable SSE fallback if explicitly disabled in config
      disableSseFallback: serverConfig.disableSseFallback,
      clientInfo,
      ...connectorOptions,
    });
  }

  throw new Error("Cannot determine connector type from config");
}
