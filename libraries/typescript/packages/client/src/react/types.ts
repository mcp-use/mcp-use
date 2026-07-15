import type {
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
   * Connection policy used by higher-level clients such as the Inspector.
   * Behavior is controlled by `proxyConfig` and `autoProxyFallback`; this field
   * is persisted so editors can distinguish Auto, forced Direct, and forced Proxy.
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
        enabled?: boolean;
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
   * @default "silent"
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
   * @default true (3000ms initial delay)
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
         * @default 10000
         */
        healthCheckInterval?: number | false;
        /**
         * Time in ms without a successful health check before triggering reconnect.
         * @default 30000
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
   * Use full-page redirect for OAuth instead of popup window (default: false)
   * Redirect flow avoids popup blockers and provides better UX on mobile.
   * Set to true to use redirect flow instead of popup.
   */
  useRedirectFlow?: boolean;
  /**
   * Callback function that is invoked just before the authentication popup window is opened.
   * Only used when useRedirectFlow is false (popup mode).
   * @param url The URL that will be opened in the popup.
   * @param features The features string for the popup window.
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
  clientOptions?: {
    capabilities?: Record<string, unknown> & { views?: boolean };
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
    name: string;
    title?: string;
    version: string;
    description?: string;
    icons?: Array<{
      src: string;
      mimeType?: string;
      sizes?: string[];
    }>;
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
 *
 * Reverse-request and notification callbacks are owned by the provider, so
 * they are intentionally excluded from this persisted configuration.
 */
export interface McpServerOptions extends Omit<
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

/** Notification received from one managed MCP server. */
export interface McpNotification {
  id: string;
  method: string;
  params?: Record<string, unknown>;
  timestamp: number;
  read: boolean;
}

/** A server sampling request awaiting UI or application approval. */
export interface PendingSamplingRequest {
  id: string;
  request: {
    method: "sampling/createMessage";
    params: SamplingCreateMessageParams;
  };
  timestamp: number;
  serverName: string;
}

/** A server elicitation request awaiting UI or application approval. */
export interface PendingElicitationRequest {
  id: string;
  request: ElicitRequestFormParams | ElicitRequestURLParams;
  timestamp: number;
  serverName: string;
}

export type UseMcpResult = {
  name: string;

  /** List of tools available from the connected MCP server */
  tools: Tool[];
  /** List of resources available from the connected MCP server */
  resources: Resource[];
  /** List of resource templates available from the connected MCP server */
  resourceTemplates: ResourceTemplate[];
  /** List of prompts available from the connected MCP server */
  prompts: Prompt[];
  /** Server information normalized for the active connection. */
  serverInfo?: {
    title?: string;
    name: string;
    version?: string;
    description?: string;
    websiteUrl?: string;
    icons?: Array<{
      src: string;
      mimeType?: string;
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
    access_token: string;
    token_type: string;
    expires_at?: number;
    refresh_token?: string;
    scope?: string;
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
  /** Array of internal log messages (useful for debugging) */
  log: {
    level: "debug" | "info" | "warn" | "error";
    message: string;
    timestamp: number;
  }[];
  /**
   * Function to call a tool on the MCP server.
   * @param name The name of the tool to call.
   * @param args Optional arguments for the tool.
   * @param options Optional request options including timeout configuration.
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
   * @param uri The URI of the resource to read.
   * @returns A promise that resolves with the resource contents.
   * @throws If the client is not in the 'ready' state or the read fails.
   */
  readResource: (uri: string) => Promise<{
    contents: Array<{
      uri: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    }>;
  }>;
  /**
   * Function to list prompts from the MCP server.
   * @returns A promise that resolves when prompts are refreshed.
   * @throws If the client is not in the 'ready' state.
   */
  listPrompts: () => Promise<void>;
  /**
   * Function to get a specific prompt from the MCP server.
   * @param name The name of the prompt to get.
   * @param args Optional arguments for the prompt.
   * @returns A promise that resolves with the prompt messages.
   * @throws If the client is not in the 'ready' state or the get fails.
   */
  getPrompt: (
    name: string,
    args?: Record<string, string>
  ) => Promise<{
    messages: Array<{
      role: "user" | "assistant";
      content: { type: string; text?: string; [key: string]: any };
    }>;
  }>;
  /**
   * Request completion suggestions for a prompt or resource template argument.
   * @param params Completion request parameters specifying the ref and argument to complete.
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
