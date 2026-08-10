import type {
  ClientOptions,
  CompleteRequestParams,
  CompleteResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  Notification,
  OAuthClientProvider,
  ProtocolEra,
  Transport,
  Prompt,
  Resource,
  // v2 exports the resource-template type as `ResourceTemplateType` (the bare
  // `ResourceTemplate` name is the server package's class).
  ResourceTemplateType as ResourceTemplate,
  Tool,
  VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import type { BaseMCPClient } from "../core/base.js";
import type { MCPAuthorizationInfo } from "../core/session.js";
import type {
  SamplingCreateMessageParams,
  SamplingCreateMessageResult,
} from "../core/config.js";

/** Proxy configuration for routing MCP traffic through a proxy server. */
export interface ProxyConfig {
  /** Proxy server address (e.g. "http://localhost:3001/inspector/api/proxy"). */
  proxyAddress?: string;
  /** Additional headers to include in proxied requests. */
  headers?: Record<string, string>;
  /**
   * @deprecated Use `headers` instead.
   */
  customHeaders?: Record<string, string>;
}

/**
 * SDK-level reconnection options for streamable HTTP transports.
 * Controls the retry behavior of the underlying `StreamableHTTPClientTransport`.
 */
export type ReconnectionOptions = {
  /** Maximum delay between reconnection attempts in ms (default: 30000) */
  maxReconnectionDelay?: number;
  /** Initial delay before first reconnection attempt in ms (default: 1000) */
  initialReconnectionDelay?: number;
  /** Multiplier applied to delay after each failed attempt (default: 1.5) */
  reconnectionDelayGrowFactor?: number;
  /** Maximum number of reconnection retries (default: 2) */
  maxRetries?: number;
};

/** Configures the {@link useMcp} hook and its browser connection lifecycle. */
export type UseMcpOptions = {
  /** The /sse URL of your remote MCP server */
  url?: string;
  /** Enable/disable the connection (similar to TanStack Query). When false, no connection will be attempted (default: true) */
  enabled?: boolean;
  /** Proxy configuration for routing through a proxy server */
  proxyConfig?: ProxyConfig;
  /**
   * OAuth proxy base URL (e.g. `https://inspector.example.com/inspector/api/oauth`)
   * used to route OAuth requests (`.well-known` discovery, DCR, token exchange)
   * through a transparent server-side proxy — bypassing browser CORS against
   * third-party identity providers — WITHOUT proxying MCP traffic itself.
   *
   * The proxy is transparent: it forwards requests and responses unmodified, so
   * the SDK's authorization-server issuer validation (RFC 8414 §3.3) still
   * passes. When omitted, the OAuth proxy URL is derived from
   * `proxyConfig.proxyAddress` (replacing a trailing `/proxy` with `/oauth`),
   * preserving the existing behavior for fully-proxied connections.
   */
  oauthProxyUrl?: string;
  /**
   * Connection policy for proxy routing.
   * - `auto`: start direct and use `autoProxyFallback` after a qualifying failure
   * - `direct`: never use `proxyConfig` and never fall back
   * - `proxy`: use `proxyConfig` immediately and never fall back
   *
   * When omitted, `proxyConfig` retains its legacy immediate-proxy behavior,
   * except when `autoProxyFallback` explicitly requests a direct-first attempt.
   */
  connectionMode?: "auto" | "direct" | "proxy";
  /**
   * Enable automatic proxy fallback when direct connection fails
   * When enabled, if a direct connection fails with FastMCP or CORS errors,
   * automatically retries using the proxy configuration
   *
   * Can be:
   * - `true`: Enable with `proxyConfig.proxyAddress`
   * - `false`: Disable automatic fallback (default)
   * - `{ enabled: boolean, proxyAddress?: string }`: Custom configuration
   *
   * @defaultValue false
   *
   * @example
   * ```typescript
   * // Use default proxy
   * useMcp({ url: '...', autoProxyFallback: true })
   *
   * // Use custom proxy
   * useMcp({
   *   url: '...',
   *   autoProxyFallback: {
   *     enabled: true,
   *     proxyAddress: 'https://my-proxy.com/api/proxy'
   *   }
   * })
   * ```
   */
  autoProxyFallback?:
    | boolean
    | {
        /** Whether fallback is enabled. */
        enabled?: boolean;
        /** Proxy endpoint used after a qualifying direct failure. */
        proxyAddress?: string;
      };
  /** Custom callback URL for OAuth redirect (defaults to /oauth/callback on the current origin) */
  callbackUrl?: string;
  /** Storage key prefix for OAuth data in localStorage (defaults to "mcp:auth") */
  storageKeyPrefix?: string;
  /** Headers that can be used to bypass auth */
  headers?: Record<string, string>;
  /**
   * Log level for console output.
   * Set to 'silent' to suppress ALL console logging (the `mcp.log` state array is still populated).
   * @defaultValue `"silent"`
   */
  logLevel?:
    | "silent"
    | "error"
    | "warn"
    | "info"
    | "http"
    | "verbose"
    | "debug"
    | "silly";
  /** Auto retry connection if initial connection fails, with delay in ms (default: false) */
  autoRetry?: boolean | number;
  /**
   * Auto reconnect if an established connection is lost.
   *
   * Can be:
   * - `boolean`: Enable/disable with default 3000ms delay and 10s health check
   * - `number`: Reconnect delay in ms (enables health checks with defaults)
   * - `object`: Full configuration for reconnection and health checks
   *
   * @defaultValue `true` with a 3000 ms initial delay
   */
  autoReconnect?:
    | boolean
    | number
    | {
        /** Whether to enable automatic reconnection (default: true) */
        enabled?: boolean;
        /** Delay in ms before reconnection attempt (default: 3000) */
        initialDelay?: number;
        /**
         * Interval in ms for health check polling via HEAD requests.
         * Set to `false` to disable health checks entirely.
         * @defaultValue `10000`
         */
        healthCheckInterval?: number | false;
        /**
         * Time in ms without a successful health check before triggering reconnect.
         * @defaultValue `30000`
         */
        healthCheckTimeout?: number;
      };
  /** SDK-level reconnection options for the streamable HTTP transport */
  reconnectionOptions?: ReconnectionOptions;
  /** Popup window features string (dimensions and behavior) for OAuth */
  popupFeatures?: string;
  /**
   * Prevent automatic authentication popup/redirect on initial connection (default: true)
   * When true, the connection will enter 'pending_auth' state and wait for user to call authenticate()
   * Set to true to show a modal/button before triggering OAuth instead of auto-redirecting
   */
  preventAutoAuth?: boolean;
  /**
   * Detect OAuth protected-resource metadata after an anonymous connection so
   * mixed-auth servers can offer optional authentication without blocking use.
   * @defaultValue true
   */
  detectMixedAuth?: boolean;
  /**
   * Use full-page redirect for OAuth instead of popup window (default: false)
   * Redirect flow avoids popup blockers and provides better UX on mobile.
   * Set to true to use redirect flow instead of popup.
   */
  useRedirectFlow?: boolean;
  /**
   * Callback function that is invoked just before the authentication popup window is opened.
   * Only used when useRedirectFlow is false (popup mode).
   * @param url - The URL that will be opened in the popup.
   * @param features - The features string for the popup window.
   */
  onPopupWindow?: (
    url: string,
    features: string,
    window: globalThis.Window | null
  ) => void;
  /**
   * Additional client options passed to the underlying MCP SDK Client.
   * Use `capabilities.views: true` as shorthand for the MCP Apps UI extension,
   * or set `capabilities.extensions` directly.
   *
   * @example
   * ```typescript
   * useMcp({
   *   url: '...',
   *   clientOptions: {
   *     capabilities: {
   *       views: true,
   *     },
   *   },
   * })
   * ```
   */
  clientOptions?: Omit<ClientOptions, "capabilities"> & {
    /** MCP capabilities advertised by the underlying SDK client. */
    capabilities?: NonNullable<ClientOptions["capabilities"]> & {
      /** Whether to advertise the MCP Apps UI extension shorthand. */
      views?: boolean;
    };
  };
  /**
   * Protocol version negotiation mode passed to the underlying SDK `Client`.
   * - `"auto"` (default): probe with `server/discover` to detect modern (2026-07-28)
   *   servers, falling back to the 2025 handshake against legacy servers.
   * - `"legacy"`: classic 2025 `initialize` handshake, no probe.
   * - `{ pin: "2026-07-28" }`: modern era only, no fallback.
   */
  protocolNegotiation?: VersionNegotiationMode;
  /** Connection timeout in milliseconds for establishing initial connection (default: 30000 / 30 seconds) */
  timeout?: number;
  /** Optional callback to wrap the transport before passing it to the Client. Useful for logging, monitoring, or other transport-level interceptors. */
  wrapTransport?: (transport: Transport, serverId: string) => Transport;
  /** Stable identifier supplied to `wrapTransport`; defaults to `url`. */
  serverId?: string;
  /** Callback function that is invoked when a notification is received from the MCP server */
  onNotification?: (notification: Notification) => void;
  /**
   * Optional callback function to handle sampling requests from servers.
   * When provided, the client will declare sampling capability and handle
   * `sampling/createMessage` requests by calling this callback.
   *
   * @deprecated Sampling is deprecated by the 2026 protocol. Retained for v1
   * push requests and v2 multi-round-trip compatibility.
   */
  onSampling?: (
    params: SamplingCreateMessageParams
  ) => Promise<SamplingCreateMessageResult>;
  /**
   * Optional callback function to handle elicitation requests from servers.
   * When provided, the client will declare elicitation capability and handle
   * `elicitation/create` requests by calling this callback.
   *
   * Elicitation allows servers to request additional information from users:
   * - Form mode: Collect structured data with JSON schema validation
   * - URL mode: Direct users to external URLs for sensitive interactions
   */
  onElicitation?: (
    params: ElicitRequestFormParams | ElicitRequestURLParams
  ) => Promise<ElicitResult>;
  /** Client information advertised while establishing the MCP connection. */
  clientInfo?: {
    /** Stable programmatic client name. */
    name: string;
    /** Optional human-readable client title. */
    title?: string;
    /** Client version. */
    version: string;
    /** Optional human-readable client description. */
    description?: string;
    /** Icons representing the client. */
    icons?: Array<{
      /** Icon URL. */
      src: string;
      /** Icon media type. */
      mimeType?: string;
      /** Supported icon sizes, such as `"48x48"`. */
      sizes?: string[];
    }>;
    /** Public website describing the client. */
    websiteUrl?: string;
  };
  /**
   * Optional custom fetch function to use for all MCP HTTP requests.
   *
   * When provided, this replaces the default global `fetch` for transport-level
   * requests. Useful for adding custom auth retry logic, logging, or proxying.
   *
   * @example
   * ```typescript
   * useMcp({
   *   url: 'http://localhost:3000/mcp',
   *   fetch: myCustomFetch,
   * })
   * ```
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Optional external OAuth client provider.
   *
   * When provided, useMcp will use this provider directly instead of creating
   * BrowserOAuthClientProvider internally. This is useful for headless/testing
   * runtimes where popup/redirect flows are not available.
   */
  authProvider?: OAuthClientProvider;
  /**
   * OAuth client registration settings.
   *
   * Use this when the upstream auth server does **not** support Dynamic Client
   * Registration — for example, MCP servers running in proxy mode against
   * Slack, WorkOS, or similar providers. Prefer `clientMetadataUrl` when the
   * authorization server advertises CIMD support; the SDK falls back to DCR
   * when appropriate.
   *
   * @example
   * ```typescript
   * useMcp({
   *   url: 'https://mcp.example.com',
   *   oauth: {
   *     clientId: 'my-preregistered-client-id',
   *     clientMetadataUrl: 'https://app.example.com/oauth/client-metadata.json',
   *     scope: 'openid profile email',
   *   },
   * })
   * ```
   */
  oauth?: {
    /** Pre-registered OAuth client_id. */
    clientId?: string;
    /**
     * Public HTTPS OAuth Client ID Metadata Document URL (CIMD).
     * The document must contain a matching client_id and redirect_uris.
     */
    clientMetadataUrl?: string;
    /** OAuth scope string included in the authorize request. */
    scope?: string;
  };
};

/**
 * Serializable configuration for one server managed by `McpClientProvider`.
 * Pass this to `addServer` / `updateServer`.
 */
export interface McpServerConfig extends Omit<
  UseMcpOptions,
  "onSampling" | "onElicitation" | "onNotification"
> {
  /** Optional user-facing alias. `server.name` always comes from MCP server metadata. */
  displayName?: string;
  /** Optional callback invoked when the provider queues sampling. */
  onSamplingRequest?: (request: PendingSamplingRequest) => void;
  /** Optional callback invoked when the provider queues elicitation. */
  onElicitationRequest?: (request: PendingElicitationRequest) => void;
  /** Optional callback invoked when the provider receives a notification. */
  onNotificationReceived?: (notification: McpNotification) => void;
}

/** @deprecated Use {@link McpServerConfig} */
export type McpServerOptions = McpServerConfig;

/** Non-secret connection settings that built-in providers may persist. */
export type PersistedMcpServerConfig = Pick<
  McpServerConfig,
  | "url"
  | "displayName"
  | "enabled"
  | "oauthProxyUrl"
  | "connectionMode"
  | "autoProxyFallback"
  | "callbackUrl"
  | "storageKeyPrefix"
  | "logLevel"
  | "autoRetry"
  | "autoReconnect"
  | "reconnectionOptions"
  | "popupFeatures"
  | "preventAutoAuth"
  | "detectMixedAuth"
  | "useRedirectFlow"
  | "protocolNegotiation"
  | "timeout"
  | "clientInfo"
> & {
  /** Proxy endpoint only. Proxy authorization headers are runtime-only. */
  proxyConfig?: Pick<ProxyConfig, "proxyAddress">;
  /** Public OAuth registration settings only. */
  oauth?: {
    /** Pre-registered public OAuth client identifier. */
    clientId?: string;
    /** Public OAuth Client ID Metadata Document URL. */
    clientMetadataUrl?: string;
    /** Space-delimited OAuth scopes. */
    scope?: string;
  };
};

/** Notification received from one managed MCP server. */
export interface McpNotification {
  /** Unique notification identifier generated by the provider. */
  id: string;
  /** MCP notification method name. */
  method: string;
  /** Optional notification parameters. */
  params?: Record<string, unknown>;
  /** Unix timestamp in milliseconds when the notification was received. */
  timestamp: number;
  /** Whether the consumer has marked the notification as read. */
  read: boolean;
}

/** A server sampling request awaiting UI or application approval. */
export interface PendingSamplingRequest {
  /** Unique request identifier generated by the provider. */
  id: string;
  /** Sampling request received from the server. */
  request: {
    /** Sampling JSON-RPC method name. */
    method: "sampling/createMessage";
    /** Sampling request parameters. */
    params: SamplingCreateMessageParams;
  };
  /** Unix timestamp in milliseconds when the request was received. */
  timestamp: number;
  /** Name of the server that issued the request. */
  serverName: string;
}

/** A server elicitation request awaiting UI or application approval. */
export interface PendingElicitationRequest {
  /** Unique request identifier generated by the provider. */
  id: string;
  /** Form or URL elicitation request received from the server. */
  request: ElicitRequestFormParams | ElicitRequestURLParams;
  /** Unix timestamp in milliseconds when the request was received. */
  timestamp: number;
  /** Name of the server that issued the request. */
  serverName: string;
}

/** Reactive state and operations returned by {@link useMcp}. */
export type UseMcpResult = {
  /** Name advertised by the connected MCP server. */
  name: string;

  /** List of tools available from the connected MCP server */
  tools: Tool[];
  /** List of resources available from the connected MCP server */
  resources: Resource[];
  /** List of resource templates available from the connected MCP server */
  resourceTemplates: ResourceTemplate[];
  /** List of prompts available from the connected MCP server */
  prompts: Prompt[];
  /** Skills advertised through the experimental Skills over MCP extension. */
  skills: import("../core/skills.js").Skill[];
  /** Server information normalized for the active connection. */
  serverInfo?: {
    /** Optional human-readable server title. */
    title?: string;
    /** Stable server name. */
    name: string;
    /** Server version. */
    version?: string;
    /** Optional human-readable server description. */
    description?: string;
    /** Public website describing the server. */
    websiteUrl?: string;
    /** Icons advertised by the server. */
    icons?: Array<{
      /** Icon URL. */
      src: string;
      /** Icon media type. */
      mimeType?: string;
      /** Supported icon sizes, such as `"48x48"`. */
      sizes?: string[];
    }>;
    /** Base64-encoded favicon auto-detected from server domain */
    icon?: string;
  };
  /** Server capabilities normalized for the active connection. */
  capabilities?: Record<string, unknown>;
  /** Optional server instructions advertised for the active connection. */
  instructions?: string;
  /** Protocol extension metadata normalized from the server capabilities. */
  extensions: Record<string, unknown>;
  /**
   * Negotiated MCP protocol era for the active connection:
   * - 'legacy': 2025-era server; lifecycle is managed internally.
   * - 'modern': 2026-07-28-era server, stateless per-request.
   * `undefined` until a connection has negotiated.
   */
  protocolEra?: ProtocolEra;
  /** Negotiated MCP protocol version string (e.g. '2025-06-18', '2026-07-28'). */
  protocolVersion?: string;
  /**
   * The current state of the MCP connection:
   * - 'discovering': Checking server existence and capabilities (including auth requirements).
   * - 'pending_auth': Authentication is required but auto-popup was prevented. User action needed.
   * - 'authenticating': Authentication is required and the process (e.g., popup) has been initiated.
   * - 'ready': Connected and ready for tool calls.
   * - 'failed': Connection or authentication failed. Check the `error` property.
   */
  state: "discovering" | "pending_auth" | "authenticating" | "ready" | "failed";
  /** If the state is 'failed', this provides the error message */
  error?: string;
  /**
   * If authentication requires user interaction (e.g., popup was blocked),
   * this URL can be presented to the user to complete authentication manually in a new tab.
   */
  authUrl?: string;
  /**
   * OAuth tokens if authentication was completed
   * Available when state is 'ready' and OAuth was used
   */
  authTokens?: {
    /** OAuth access token. */
    access_token: string;
    /** OAuth token type, commonly `"Bearer"`. */
    token_type: string;
    /** Unix timestamp in seconds when the access token expires. */
    expires_at?: number;
    /** OAuth refresh token, when issued. */
    refresh_token?: string;
    /** Space-delimited OAuth scopes granted to the token. */
    scope?: string;
    /** Canonical protected-resource URL required by some token refresh flows. */
    resource?: string;
    /**
     * OAuth token endpoint resolved during discovery (when available). Lets
     * consumers persist it so a backend can proactively refresh the token.
     */
    token_endpoint?: string;
    /**
     * OAuth client id (from Dynamic Client Registration or a static client).
     * Most token endpoints require it on refresh, so consumers can persist it
     * for server-side proactive refresh.
     */
    client_id?: string;
    /** OAuth client secret, when the provider issued a confidential client. */
    client_secret?: string;
  };
  /** OAuth availability discovered for an anonymously connected server. */
  authorization?: MCPAuthorizationInfo;
  /** Array of internal log messages (useful for debugging) */
  log: {
    /** Log severity. */
    level: "debug" | "info" | "warn" | "error";
    /** Human-readable log message. */
    message: string;
    /** Unix timestamp in milliseconds when the entry was created. */
    timestamp: number;
  }[];
  /**
   * Function to call a tool on the MCP server.
   * @param name - The name of the tool to call.
   * @param args - Optional arguments for the tool.
   * @param options - Optional request options including timeout configuration.
   * @returns A promise that resolves with the tool's result.
   * @throws If the client is not in the 'ready' state or the call fails.
   *
   * @example
   * ```typescript
   * // Simple tool call
   * const result = await mcp.callTool('my-tool', { arg: 'value' })
   *
   * // Tool call with extended timeout (e.g., for tools that trigger sampling)
   * const result = await mcp.callTool('analyze-sentiment', { text: 'Hello' }, {
   *   timeout: 300000, // 5 minutes
   *   resetTimeoutOnProgress: true // Reset timeout when progress notifications are received
   * })
   * ```
   */
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    options?: {
      /** Timeout in milliseconds for this tool call (default: 60000 / 60 seconds) */
      timeout?: number;
      /** Maximum total timeout in milliseconds, even with progress resets */
      maxTotalTimeout?: number;
      /** Reset the timeout when progress notifications are received (default: false) */
      resetTimeoutOnProgress?: boolean;
      /** AbortSignal to cancel the request */
      signal?: AbortSignal;
    }
  ) => Promise<any>;
  /**
   * Function to list resources from the MCP server.
   * @returns A promise that resolves when resources are refreshed.
   * @throws If the client is not in the 'ready' state.
   */
  listResources: () => Promise<void>;
  /**
   * Function to read a resource from the MCP server.
   * @param uri - The URI of the resource to read.
   * @returns A promise that resolves with the resource contents.
   * @throws If the client is not in the 'ready' state or the read fails.
   */
  readResource: (uri: string) => Promise<{
    /** Content blocks returned for the resource. */
    contents: Array<{
      /** URI of the returned resource content. */
      uri: string;
      /** Content media type. */
      mimeType?: string;
      /** UTF-8 text content. */
      text?: string;
      /** Base64-encoded binary content. */
      blob?: string;
    }>;
  }>;
  /** Refresh the complete paginated skill catalog. */
  listSkills: () => Promise<void>;
  /** Resolve one skill by its canonical URI. */
  getSkill: (
    uri: string
  ) => Promise<import("../core/skills.js").SkillGetResult>;
  /** Read one non-recursive directory in a remote skill. */
  readResourceDirectory: (
    uri: string,
    cursor?: string
  ) => Promise<import("../core/skills.js").SkillDirectoryReadResult>;
  /**
   * Function to list prompts from the MCP server.
   * @returns A promise that resolves when prompts are refreshed.
   * @throws If the client is not in the 'ready' state.
   */
  listPrompts: () => Promise<void>;
  /**
   * Function to get a specific prompt from the MCP server.
   * @param name - The name of the prompt to get.
   * @param args - Optional arguments for the prompt.
   * @returns A promise that resolves with the prompt messages.
   * @throws If the client is not in the 'ready' state or the get fails.
   */
  getPrompt: (
    name: string,
    args?: Record<string, string>
  ) => Promise<{
    /** Messages produced from the prompt template. */
    messages: Array<{
      /** Conversation role for the prompt message. */
      role: "user" | "assistant";
      /** Prompt message content. */
      content: {
        /** MCP content block type. */
        type: string;
        /** Text value for text content blocks. */
        text?: string;
        [key: string]: any;
      };
    }>;
  }>;
  /**
   * Request completion suggestions for a prompt or resource template argument.
   * @param params - Completion request parameters specifying the ref and argument to complete.
   * @returns A promise that resolves with completion suggestions from the server.
   * @throws If the client is not in the 'ready' state or the completion request fails.
   */
  complete: (params: CompleteRequestParams) => Promise<CompleteResult>;
  /**
   * Refresh the tools list from the server.
   * Called automatically when notifications/tools/list_changed is received.
   * Can also be called manually for explicit refresh.
   */
  refreshTools: () => Promise<void>;
  /**
   * Refresh the resources list from the server.
   * Called automatically when notifications/resources/list_changed is received.
   * Can also be called manually for explicit refresh.
   */
  refreshResources: () => Promise<void>;
  /**
   * Refresh the resource templates list from the server.
   * Can be called manually for explicit refresh.
   */
  refreshResourceTemplates: () => Promise<void>;
  /**
   * Refresh the prompts list from the server.
   * Called automatically when notifications/prompts/list_changed is received.
   * Can also be called manually for explicit refresh.
   */
  refreshPrompts: () => Promise<void>;
  /**
   * Refresh all lists (tools, resources, resource templates, prompts) from the server.
   * Useful after reconnection or for manual refresh.
   */
  refreshAll: () => Promise<void>;
  /** Manually attempts to reconnect if the state is 'failed'. */
  retry: () => void;
  /** Disconnects the client from the MCP server. */
  disconnect: () => Promise<void>;
  /**
   * Manually triggers the authentication process. Useful if the initial attempt failed
   * due to a blocked popup, allowing the user to initiate it via a button click.
   * @returns A promise that resolves with the authorization URL opened (or intended to be opened),
   *          or undefined if auth cannot be started.
   */
  authenticate: () => Promise<void>;
  /** Clears all stored authentication data (tokens, client info, etc.) for this server URL from localStorage. */
  clearStorage: () => void;
  /**
   * Ensure the server icon is loaded and available in serverInfo
   * Returns a promise that resolves when the icon is ready
   * Use this before server creation to guarantee the icon is available
   *
   * @returns Promise that resolves with the base64 icon or null if not available
   *
   * @example
   * ```typescript
   * // Wait for icon before creating server
   * const icon = await mcp.ensureIconLoaded();
   * // Now mcp.serverInfo.icon is guaranteed to be set (if icon exists)
   * ```
   */
  ensureIconLoaded: () => Promise<string | null>;
  /**
   * The underlying runtime-neutral MCP client instance.
   * Use this to create an MCPAgent for AI chat functionality.
   *
   * @example
   * ```typescript
   * import { MCPAgent } from "@mcp-use/agent"
   * import { ChatOpenAI } from '@langchain/openai'
   *
   * const mcp = useMcp({ url: 'http://localhost:3000/mcp' })
   * const llm = new ChatOpenAI({ model: 'gpt-4' })
   *
   * const agent = new MCPAgent({ llm, client: mcp.client })
   * await agent.initialize()
   *
   * for await (const event of agent.streamEvents('Hello')) {
   *   console.log(event)
   * }
   * ```
   */
  client: BaseMCPClient | null;
};

/**
 * Connected MCP server: non-secret settings, live runtime headers, and state.
 * Returned from `useMcpClient().servers`.
 */
type LiveMcpServerConfig = Omit<PersistedMcpServerConfig, "proxyConfig"> & {
  /** Runtime HTTP headers. These values are never persisted. */
  headers?: Record<string, string>;
  /** Live proxy configuration, including runtime-only headers. */
  proxyConfig?: ProxyConfig;
  /** SDK client options used by the active connection. */
  clientOptions?: McpServerConfig["clientOptions"];
};

export interface McpServer extends LiveMcpServerConfig, UseMcpResult {
  /** Stable provider-managed server identifier. */
  id: string;
  /** Notifications received from this server. */
  notifications: McpNotification[];
  /** Number of notifications not yet marked as read. */
  unreadNotificationCount: number;
  /** Marks one notification as read. */
  markNotificationRead: (id: string) => void;
  /** Marks every notification as read. */
  markAllNotificationsRead: () => void;
  /** Removes every notification from local state. */
  clearNotifications: () => void;
  /** Sampling requests awaiting an application decision. */
  pendingSamplingRequests: PendingSamplingRequest[];
  /** Approves a pending sampling request with a result. */
  approveSampling: (
    requestId: string,
    result: SamplingCreateMessageResult
  ) => void;
  /** Rejects a pending sampling request. */
  rejectSampling: (requestId: string, error?: string) => void;
  /** Elicitation requests awaiting an application decision. */
  pendingElicitationRequests: PendingElicitationRequest[];
  /** Approves a pending elicitation request with a result. */
  approveElicitation: (requestId: string, result: ElicitResult) => void;
  /** Rejects a pending elicitation request. */
  rejectElicitation: (requestId: string, error?: string) => void;
  /**
   * Merge connection-affecting config and reconnect when it changed.
   * Prefer this over context `updateServer(id, …)` when you already hold the server.
   */
  updateConfig: (config: Partial<McpServerConfig>) => Promise<void>;
  /** Set HTTP headers on the connection config and reconnect. */
  setHeaders: (headers: Record<string, string> | undefined) => Promise<void>;
  /** Rename the server without disconnecting. */
  setDisplayName: (displayName: string) => Promise<void>;
  /** Disconnect and reconnect with the current config. */
  reconnect: () => Promise<void>;
}

const PERSISTED_SERVER_CONFIG_KEYS = [
  "url",
  "displayName",
  "enabled",
  "oauthProxyUrl",
  "connectionMode",
  "autoProxyFallback",
  "callbackUrl",
  "storageKeyPrefix",
  "logLevel",
  "autoRetry",
  "autoReconnect",
  "reconnectionOptions",
  "popupFeatures",
  "preventAutoAuth",
  "detectMixedAuth",
  "useRedirectFlow",
  "protocolNegotiation",
  "timeout",
  "clientInfo",
] as const satisfies readonly (keyof PersistedMcpServerConfig)[];

/**
 * Extracts the non-secret subset safe for provider storage.
 *
 * @param source - Server configuration or live managed server.
 * @returns A new persistable configuration object.
 */
export function pickPersistedServerConfig(
  source: McpServerConfig | McpServer
): PersistedMcpServerConfig {
  const out: PersistedMcpServerConfig = {};
  for (const key of PERSISTED_SERVER_CONFIG_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  if (source.proxyConfig?.proxyAddress !== undefined) {
    out.proxyConfig = { proxyAddress: source.proxyConfig.proxyAddress };
  }
  if (source.oauth) {
    const oauth: NonNullable<PersistedMcpServerConfig["oauth"]> = {};
    if (source.oauth.clientId !== undefined) {
      oauth.clientId = source.oauth.clientId;
    }
    if (source.oauth.clientMetadataUrl !== undefined) {
      oauth.clientMetadataUrl = source.oauth.clientMetadataUrl;
    }
    if (source.oauth.scope !== undefined) {
      oauth.scope = source.oauth.scope;
    }
    if (Object.keys(oauth).length > 0) {
      out.oauth = oauth;
    }
  }
  return out;
}

/**
 * Extracts connection settings, including runtime-only values, from a server.
 *
 * @param source - Server configuration or live managed server.
 * @returns A new live configuration object.
 */
export function pickLiveServerConfig(
  source: McpServerConfig | McpServer
): LiveMcpServerConfig {
  return {
    ...pickPersistedServerConfig(source),
    ...(source.headers !== undefined ? { headers: source.headers } : {}),
    ...(source.proxyConfig !== undefined
      ? { proxyConfig: source.proxyConfig }
      : {}),
    ...(source.clientOptions !== undefined
      ? { clientOptions: source.clientOptions }
      : {}),
  };
}

/**
 * Removes credentials, callbacks, and runtime-only values before storage.
 *
 * @param config - Configuration to sanitize.
 * @returns A new persistable configuration object.
 */
export function toPersistedServerConfig(
  config: McpServerConfig
): PersistedMcpServerConfig {
  return pickPersistedServerConfig(config);
}
