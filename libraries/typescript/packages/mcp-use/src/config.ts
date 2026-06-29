import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/client";
import type { Notification } from "@modelcontextprotocol/client";
import type {
  BaseConnector,
  ConnectorAuthProvider,
  ConnectorInitOptions,
} from "./connectors/base.js";
import type { ClientInfo } from "./connectors/http.js";
import { HttpConnector } from "./connectors/http.js";
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

/** Callback options shared by per-server config and global defaults. */
export interface CallbackConfig {
  onSampling?: OnSamplingCallback;
  onElicitation?: OnElicitationCallback;
  onNotification?: OnNotificationCallback;
}

/** Per-server callbacks override global defaults. */
export function resolveCallbacks(
  perServer: CallbackConfig | undefined,
  globalDefaults: CallbackConfig | undefined
): {
  onSampling?: OnSamplingCallback;
  onElicitation?: OnElicitationCallback;
  onNotification?: OnNotificationCallback;
} {
  return {
    onSampling: perServer?.onSampling ?? globalDefaults?.onSampling,
    onElicitation: perServer?.onElicitation ?? globalDefaults?.onElicitation,
    onNotification: perServer?.onNotification ?? globalDefaults?.onNotification,
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
  cwd?: string;
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
  authProvider?: ConnectorAuthProvider;
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

export function createConnectorFromConfig(
  serverConfig: ServerConfig,
  connectorOptions?: Partial<ConnectorInitOptions>
): BaseConnector {
  // Normalize clientInfo to ensure required fields are present
  const clientInfo = normalizeClientInfo(serverConfig.clientInfo);

  if ("command" in serverConfig && "args" in serverConfig) {
    throw new Error(
      "Stdio connector is not supported in this environment. " +
        "Stdio connections require Node.js and are only available in the Node.js MCPClient."
    );
  }

  if ("url" in serverConfig) {
    return new HttpConnector(serverConfig.url, {
      headers: serverConfig.headers,
      fetch: serverConfig.fetch,
      authToken: serverConfig.auth_token || serverConfig.authToken,
      authProvider: serverConfig.authProvider,
      clientInfo,
      ...connectorOptions,
    });
  }

  throw new Error("Cannot determine connector type from config");
}
