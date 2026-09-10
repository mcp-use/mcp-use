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
import type { StdioStderrMode } from "../transport/stdio.js";
import { getPackageVersion } from "../utils/version.js";

/** Parameters accepted by the MCP `sampling/createMessage` request. */
export type SamplingCreateMessageParams =
  RequestTypeMap["sampling/createMessage"]["params"];

/** Result returned for the MCP `sampling/createMessage` request. */
export type SamplingCreateMessageResult =
  ResultTypeMap["sampling/createMessage"];

/**
 * Handles a sampling request initiated by an MCP server.
 *
 * @param params - Sampling request parameters supplied by the server.
 * @returns The model-generated sampling result.
 */
export type OnSamplingCallback = (
  params: SamplingCreateMessageParams
) => Promise<SamplingCreateMessageResult>;

/**
 * Handles a form or URL elicitation request initiated by an MCP server.
 *
 * @param params - Elicitation request parameters supplied by the server.
 * @returns The user's elicitation decision and optional content.
 */
export type OnElicitationCallback = (
  params: ElicitRequestFormParams | ElicitRequestURLParams
) => Promise<ElicitResult>;

/**
 * Handles a notification sent by an MCP server.
 *
 * @param notification - The notification envelope supplied by the server.
 */
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
 * Resolves callback handlers, preferring per-server values over global values.
 *
 * @param perServer - Callback overrides for one server.
 * @param globalDefaults - Fallback callbacks shared by all servers.
 * @returns The effective callbacks for the server.
 */
export function resolveCallbacks(
  perServer: CallbackConfig | undefined,
  globalDefaults: CallbackConfig | undefined
): {
  /** Effective sampling callback. */
  onSampling?: OnSamplingCallback;
  /** Effective elicitation callback. */
  onElicitation?: OnElicitationCallback;
  /** Effective notification callback. */
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
/** Options shared by HTTP and stdio server configurations. */
interface BaseServerConfig extends CallbackConfig {
  /** Client identity advertised to the server. */
  clientInfo?: ClientInfo;
  /** Initial roots advertised to the server. */
  roots?: Root[];
  /** Options forwarded to the official MCP SDK Client. */
  clientOptions?: ClientOptions;
  /** Default timeout/cancellation options for requests. */
  defaultRequestOptions?: RequestOptions;
}

/**
 * Configures a local MCP server launched over standard input and output.
 */
export interface StdioServerConfig extends BaseServerConfig {
  /** Executable used to start the server. */
  command: string;
  /** Arguments passed to {@link StdioServerConfig.command}. */
  args: string[];
  /** Environment variables merged with the current process environment. */
  env?: Record<string, string>;
  /** Working directory used to launch the server process. */
  cwd?: string;
  /**
   * How the server process's standard error is handled. Defaults to `"pipe"`,
   * which forwards it to the connector's `errlog`. Use `"inherit"` to give the
   * child the parent's stderr file descriptor instead, preserving TTY
   * detection and colorization, or `"ignore"` to discard it.
   */
  stderr?: StdioStderrMode;
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
  /** Prefix used for persisted OAuth session keys. */
  storageKeyPrefix?: string;
  /** OAuth client display name. */
  clientName?: string;
  /** Public URL describing the OAuth client. */
  clientUri?: string;
  /** Public URL for the OAuth client logo. */
  logoUri?: string;
  /** OAuth redirect URI. The platform provider supplies a default when omitted. */
  callbackUrl?: string;
  /** URL of an OAuth Client ID Metadata Document. */
  clientMetadataUrl?: string;
  /** Space-delimited OAuth scopes to request. */
  scope?: string;
  /**
   * Pre-registered OAuth client information (skips DCR). Browser client
   * secrets require an OAuth proxy and popup flow; Node providers may use
   * confidential credentials directly.
   */
  staticClientInfo?: OAuthClientInformation;
  /** Preferred Node loopback port. Defaults to `33418`. */
  preferredPort?: number;
  /** Number of Node loopback ports to try. Defaults to `10`. */
  portRange?: number;
  /** Node loopback callback timeout in milliseconds. Defaults to five minutes. */
  authTimeoutMs?: number;
  /** Node: override browser launch (CLI prints the URL instead). */
  openBrowser?: (url: string) => void | Promise<void>;
  /** Browser: wait for explicit authenticate() instead of auto popup. */
  preventAutoAuth?: boolean;
  /** Browser: full-page redirect instead of popup. */
  useRedirectFlow?: boolean;
  /** Browser: same-origin OAuth BFF base URL. */
  oauthProxyUrl?: string;
  /** Whether browser OAuth HTTP uses `oauthProxyUrl`. Defaults to `true` when the URL is set. */
  proxyOAuthRequests?: boolean;
}

/**
 * Configures a remote MCP server accessed with streamable HTTP.
 */
export interface HttpServerConfig extends BaseServerConfig {
  /** MCP endpoint URL. */
  url: string;
  /** Headers included with MCP transport requests. */
  headers?: Record<string, string>;
  /** Fetch implementation used by the HTTP transport. */
  fetch?: typeof fetch;
  /** Bearer token added as the `Authorization` header. */
  authToken?: string;
  /** Connection timeout in milliseconds. */
  timeout?: number;
  /** OAuth provider used when the server requires authorization. */
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
   * Detect mixed-auth servers after an anonymous connection by using the
   * official SDK's RFC 9728 protected-resource metadata discovery.
   * @defaultValue true
   */
  detectMixedAuth?: boolean;
  /**
   * Protocol version negotiation mode. Defaults to `"auto"` to negotiate both
   * v1 and v2 MCP servers. See {@link HttpConnector}.
   */
  protocolNegotiation?: VersionNegotiationMode;
}

/**
 * Tests whether the client should create an OAuth provider for an HTTP server.
 *
 * @param serverConfig - Server configuration to inspect.
 * @returns `true` for an HTTP configuration without explicit authorization.
 */
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
 * Configuration for either a local stdio server or a remote HTTP server.
 */
export type ServerConfig = StdioServerConfig | HttpServerConfig;

/**
 * Top-level MCP client configuration.
 *
 * Callback and client identity values act as defaults for individual servers.
 */
export interface MCPClientConfigShape extends CallbackConfig {
  /** Default client identity for all servers; overridable per server. */
  clientInfo?: ClientInfo;
  /** Server configurations keyed by the name used in client methods. */
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
 * Normalizes a client identity and fills optional metadata with package defaults.
 *
 * @param input - Candidate client identity.
 * @returns The supplied identity merged with defaults, or the complete default
 * identity when `input` does not contain both `name` and `version`.
 */
export function normalizeClientInfo(input: unknown): ClientInfo {
  const fallback = getDefaultClientInfo();
  if (!input || typeof input !== "object") return fallback;
  const ci = input as Partial<ClientInfo>;
  // Require name + version (SDK/client contract)
  if (!ci.name || !ci.version) return fallback;
  return { ...fallback, ...ci };
}

/**
 * Expands the `capabilities.views` shorthand into the MCP Apps extension.
 *
 * @param clientOptions - SDK client options to normalize.
 * @returns Normalized options, or `undefined` when no options were supplied.
 */
export function resolveClientOptions(
  clientOptions: ClientOptions | undefined
): ClientOptions | undefined {
  const capabilities = clientOptions?.capabilities as
    | Record<string, unknown>
    | undefined;
  if (!capabilities || capabilities.views !== true) return clientOptions;

  const { views: _views, ...capsWithoutViews } = capabilities;
  const extensions =
    capsWithoutViews.extensions &&
    typeof capsWithoutViews.extensions === "object" &&
    !Array.isArray(capsWithoutViews.extensions)
      ? { ...(capsWithoutViews.extensions as Record<string, unknown>) }
      : {};

  return {
    ...clientOptions,
    capabilities: {
      ...capsWithoutViews,
      extensions: {
        ...extensions,
        "io.modelcontextprotocol/ui": {
          mimeTypes: ["text/html;profile=mcp-app"],
        },
      },
    },
  };
}

/**
 * Creates an HTTP connector from a runtime-neutral server configuration.
 *
 * @param serverConfig - Server configuration to convert.
 * @param connectorOptions - Connector options that override derived values.
 * @returns An HTTP connector for the configured endpoint.
 * @throws When `serverConfig` is a stdio configuration or has no recognized transport.
 */
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
      detectMixedAuth: serverConfig.detectMixedAuth,
      protocolNegotiation: serverConfig.protocolNegotiation,
      timeout: serverConfig.timeout,
      roots: serverConfig.roots,
      clientOptions: resolveClientOptions(serverConfig.clientOptions),
      defaultRequestOptions: serverConfig.defaultRequestOptions,
      clientInfo,
      ...connectorOptions,
    });
  }

  throw new Error("Cannot determine connector type from config");
}
