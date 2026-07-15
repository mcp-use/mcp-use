import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  Notification,
  AuthProvider,
  OAuthClientInformation,
  OAuthClientProvider,
  Root,
  RequestTypeMap,
  RequestOptions,
  ResultTypeMap,
  ClientOptions,
  VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import type { BaseConnector, ConnectorInitOptions } from "../transport/base.js";
import type { ClientInfo } from "../transport/http.js";
import { HttpConnector } from "../transport/http.js";
import { getPackageVersion } from "../utils/version.js";

/** Params for `sampling/createMessage` (avoids deprecated `CreateMessageRequest`). */
export type SamplingCreateMessageParams =
  RequestTypeMap["sampling/createMessage"]["params"];

/** Result for `sampling/createMessage` (avoids deprecated `CreateMessageResult`). */
export type SamplingCreateMessageResult =
  ResultTypeMap["sampling/createMessage"];

/** Callback for sampling requests (canonical name). */
export type OnSamplingCallback = (
  params: SamplingCreateMessageParams
) => Promise<SamplingCreateMessageResult>;

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
 */
export interface CallbackConfig {
  /**
   * Callback for sampling input.
   *
   * @deprecated Sampling is deprecated by the 2026 protocol. Retained for v1
   * push requests and the v2 `input_required` compatibility window.
   */
  onSampling?: OnSamplingCallback;
  /** Callback for elicitation requests from servers. */
  onElicitation?: OnElicitationCallback;
  /** Callback for notifications from servers. */
  onNotification?: OnNotificationCallback;
}

/**
 * Resolves effective callbacks from per-server and global config.
 */
export function resolveCallbacks(
  perServer: CallbackConfig | undefined,
  globalDefaults: CallbackConfig | undefined
): {
  onSampling?: OnSamplingCallback;
  onElicitation?: OnElicitationCallback;
  onNotification?: OnNotificationCallback;
} {
  const pickSampling = perServer?.onSampling ?? globalDefaults?.onSampling;
  const pickElicitation =
    perServer?.onElicitation ?? globalDefaults?.onElicitation;
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
  /** Advertise support for MCP Apps views. */
  viewSupport?: boolean;
  /** Initial roots advertised to the server. */
  roots?: Root[];
  /** Options forwarded to the official MCP SDK Client. */
  clientOptions?: ClientOptions;
  /** Default timeout/cancellation options for requests. */
  defaultRequestOptions?: RequestOptions;
}

/**
 * Server configuration for STDIO connectors
 */
export interface StdioServerConfig extends BaseServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  /**
   * Protocol version negotiation mode. Defaults to `"legacy"` for stdio (the
   * SDK advises against probing for spawn-per-invocation tools). See
   * {@link StdioConnector}.
   */
  protocolNegotiation?: VersionNegotiationMode;
}

/**
 * Options forwarded to the platform `createOAuthProvider` when the client
 * auto-provisions OAuth for an HTTP server. Platform-specific fields
 * (e.g. Node `openBrowser`, browser `oauthProxyUrl`) are accepted and ignored
 * by the other runtime.
 */
export interface AutoOAuthOptions {
  storageKeyPrefix?: string;
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
  callbackUrl?: string;
  clientMetadataUrl?: string;
  scope?: string;
  /** Pre-registered public client id (skips DCR). */
  staticClientInfo?: OAuthClientInformation;
  /** Node: preferred loopback port. */
  preferredPort?: number;
  /** Node: ports to walk on EADDRINUSE. */
  portRange?: number;
  /** Node: loopback wait timeout in ms. */
  authTimeoutMs?: number;
  /** Node: override browser launch (CLI prints the URL instead). */
  openBrowser?: (url: string) => void | Promise<void>;
  /** Browser: wait for explicit authenticate() instead of auto popup. */
  preventAutoAuth?: boolean;
  /** Browser: full-page redirect instead of popup. */
  useRedirectFlow?: boolean;
  /** Browser: same-origin OAuth BFF base URL. */
  oauthProxyUrl?: string;
  /** Browser: route OAuth HTTP through `oauthProxyUrl` (default true when set). */
  proxyOAuthRequests?: boolean;
}

/**
 * Server configuration for HTTP connectors
 */
export interface HttpServerConfig extends BaseServerConfig {
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  authToken?: string;
  /** Connection timeout in milliseconds. */
  timeout?: number;
  authProvider?: AuthProvider | OAuthClientProvider;
  /**
   * Auto-OAuth options for HTTP servers.
   * - omit / `{}`: client creates the platform provider on connect
   * - `false`: disable auto-OAuth (e.g. CLI `--no-oauth`)
   * - object: forwarded to `createOAuthProvider`
   *
   * Ignored when `authProvider` or `authToken` is set, or when `headers`
   * already includes `Authorization`.
   */
  oauth?: AutoOAuthOptions | false;
  /**
   * Protocol version negotiation mode. Defaults to `"auto"` to negotiate both
   * v1 and v2 MCP servers. See {@link HttpConnector}.
   */
  protocolNegotiation?: VersionNegotiationMode;
}

/** True when the client should auto-create an OAuth provider for this server. */
export function shouldAutoProvisionOAuth(
  serverConfig: ServerConfig
): serverConfig is HttpServerConfig {
  if (!("url" in serverConfig) || typeof serverConfig.url !== "string") {
    return false;
  }
  if (serverConfig.authProvider) return false;
  if (serverConfig.authToken) return false;
  if (serverConfig.oauth === false) return false;
  const headers = serverConfig.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "authorization") return false;
    }
  }
  return true;
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

/** Resolve SDK client options, including the MCP Apps capability shorthand. */
export function resolveClientOptions(
  clientOptions: ClientOptions | undefined,
  viewSupport: boolean | undefined
): ClientOptions | undefined {
  if (!viewSupport) return clientOptions;
  const capabilities = clientOptions?.capabilities ?? {};
  const extensions =
    (capabilities.extensions as Record<string, unknown> | undefined) ?? {};
  return {
    ...clientOptions,
    capabilities: {
      ...capabilities,
      extensions: {
        ...extensions,
        "io.modelcontextprotocol/ui": {
          mimeTypes: ["text/html;profile=mcp-app"],
        },
      },
    },
  };
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
      authToken: serverConfig.authToken,
      authProvider: serverConfig.authProvider,
      protocolNegotiation: serverConfig.protocolNegotiation,
      timeout: serverConfig.timeout,
      roots: serverConfig.roots,
      clientOptions: resolveClientOptions(
        serverConfig.clientOptions,
        serverConfig.viewSupport
      ),
      defaultRequestOptions: serverConfig.defaultRequestOptions,
      clientInfo,
      ...connectorOptions,
    });
  }

  throw new Error("Cannot determine connector type from config");
}
