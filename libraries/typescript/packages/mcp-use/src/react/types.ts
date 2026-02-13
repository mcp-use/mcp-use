import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  Notification,
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { BrowserMCPClient } from "../client/browser.js";

export type UseMcpOptions = {
  /** The /sse URL of your remote MCP server */
  url?: string;
  /** Enable/disable the connection (similar to TanStack Query). When false, no connection will be attempted (default: true) */
  enabled?: boolean;
  /** Proxy configuration for routing through a proxy server */
  proxyConfig?: {
    proxyAddress?: string;
    headers?: Record<string, string>;
    /**
     * @deprecated Use `headers` instead. This option will be removed in a future version.
     */
    customHeaders?: Record<string, string>;
  };
  /**
   * Enable automatic proxy fallback when direct connection fails
   * When enabled, if a direct connection fails with FastMCP or CORS errors,
   * automatically retries using the proxy configuration
   *
   * Can be:
   * - `true`: Enable with default proxy (https://inspector.mcp-use.com/inspector/api/proxy)
   * - `false`: Disable automatic fallback (default)
   * - `{ enabled: boolean, proxyAddress?: string }`: Custom configuration
   *
   * @default false
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
  /**
   * @deprecated Use `clientInfo` instead. This option will be removed in a future version.
   * The `clientConfig` will be automatically derived from `clientInfo` for OAuth registration.
   *
   * Client configuration for OAuth registration (deprecated - derived from clientInfo).
   */
  clientConfig?: {
    /** Client name (used for OAuth registration) */
    name?: string;
    /** Client version (used for OAuth registration) */
    version?: string;
    /** Client URI/homepage (used for OAuth registration) */
    uri?: string;
    /** Client logo URI (used for OAuth registration, defaults to https://mcp-use.com/logo.png) */
    logo_uri?: string;
  };
  /** Headers that can be used to bypass auth */
  headers?: Record<string, string>;
  /**
   * @deprecated Use `headers` instead. This option will be removed in a future version.
   * Custom headers that can be used to bypass auth
   */
  customHeaders?: Record<string, string>;
  /** Whether to enable verbose debug logging to the console and the log state */
  debug?: boolean;
  /** Auto retry connection if initial connection fails, with delay in ms (default: false) */
  autoRetry?: boolean | number;
  /** 
   * Auto reconnect if an established connection is lost.
   * 
   * Can be:
   * - `boolean`: Enable/disable with default 3000ms delay and 10000ms health check
   * - `number`: Reconnect delay in ms
   * - `object`: Full configuration for reconnection and health checks
   * 
   * @default 3000
   */
  autoReconnect?:
    | boolean
    | number
    | {
        /** Whether to enable automatic reconnection (default: true) */
        enabled?: boolean;
        /** Initial delay in ms before first reconnection attempt (default: 3000) */
        initialDelay?: number;
        /** 
         * Interval in ms for health check polling. 
         * Set to false to disable health checks entirely.
         * @default 10000
         */
        healthCheckInterval?: number | false;
        /** 
         * Timeout in ms for health check requests.
         * Consider connection dead after this time without response.
         * @default 30000
         */
        healthCheckTimeout?: number;
      };
  /** Popup window features string (dimensions and behavior) for OAuth */
  popupFeatures?: string;
  /**
   * Transport type preference.
   *
   * @deprecated The 'sse' option is deprecated. Use 'http' or 'auto' instead.
   *
   * As of MCP spec 2025-11-25, the old HTTP+SSE transport is deprecated in favor
   * of Streamable HTTP (unified endpoint). StreamableHTTP still supports SSE for
   * notifications - it just uses a single /mcp endpoint instead of separate endpoints.
   *
   * **Backward compatibility:** 'sse' option still works and is maintained.
   *
   * Options:
   * - 'auto': Try HTTP (Streamable HTTP), fallback to SSE if needed (recommended)
   * - 'http': Use Streamable HTTP only (recommended for new code)
   * - 'sse': Use old SSE transport (deprecated, but still works)
   *
   * @see https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
   */
  transportType?: "auto" | "http" | "sse";
  /**
   * Prevent automatic authentication popup/redirect on initial connection (default: false)
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
  /** Connection timeout in milliseconds for establishing initial connection (default: 30000 / 30 seconds) */
  timeout?: number;
  /** SSE read timeout in milliseconds to prevent idle connection drops (default: 300000 / 5 minutes) */
  sseReadTimeout?: number;
  /** Optional callback to wrap the transport before passing it to the Client. Useful for logging, monitoring, or other transport-level interceptors. */
  wrapTransport?: (transport: any, serverId: string) => any;
  /** Callback function that is invoked when a notification is received from the MCP server */
  onNotification?: (notification: Notification) => void;
  /**
   * Optional callback function to handle sampling requests from servers.
   * When provided, the client will declare sampling capability and handle
   * `sampling/createMessage` requests by calling this callback.
   */
  onSampling?: (
    params: CreateMessageRequest["params"]
  ) => Promise<CreateMessageResult>;
  /**
   * @deprecated Use `onSampling` instead. This option will be removed in a future version.
   * Optional callback function to handle sampling requests from servers.
   * When provided, the client will declare sampling capability and handle
   * `sampling/createMessage` requests by calling this callback.
   */
  samplingCallback?: (
    params: CreateMessageRequest["params"]
  ) => Promise<CreateMessageResult>;
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
  /**
   * Client information sent to the MCP server in the initialize request.
   * If not provided, defaults to mcp-use client info.
   */
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
   * Initial server info to use from cache (internal use).
   * This will be displayed immediately while the actual server info is being fetched.
   * Once the real server info is available, it will replace this cached value.
   * @internal
   */
  _initialServerInfo?: {
    name?: string;
    version?: string;
    title?: string;
    websiteUrl?: string;
    icons?: Array<{
      src: string;
      mimeType?: string;
    }>;
    icon?: string;
  };
};

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
  /** Server information from the initialize response */
  serverInfo?: {
    title?: string;
    name: string;
    version?: string;
    websiteUrl?: string;
    icons?: Array<{
      src: string;
      mimeType?: string;
    }>;
    /** Base64-encoded favicon auto-detected from server domain */
    icon?: string;
  };
  /** Server capabilities from the initialize response */
  capabilities?: Record<string, any>;
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
   * Refresh the prompts list from the server.
   * Called automatically when notifications/prompts/list_changed is received.
   * Can also be called manually for explicit refresh.
   */
  refreshPrompts: () => Promise<void>;
  /**
   * Refresh all lists (tools, resources, prompts) from the server.
   * Useful after reconnection or for manual refresh.
   */
  refreshAll: () => Promise<void>;
  /** Manually attempts to reconnect if the state is 'failed'. */
  retry: () => void;
  /** Disconnects the client from the MCP server. */
  disconnect: () => void;
  /**
   * Manually triggers the authentication process. Useful if the initial attempt failed
   * due to a blocked popup, allowing the user to initiate it via a button click.
   * @returns A promise that resolves with the authorization URL opened (or intended to be opened),
   *          or undefined if auth cannot be started.
   */
  authenticate: () => void;
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
   * The underlying BrowserMCPClient instance.
   * Use this to create an MCPAgent for AI chat functionality.
   *
   * @example
   * ```typescript
   * import { MCPAgent } from 'mcp-use'
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
  client: BrowserMCPClient | null;
};
