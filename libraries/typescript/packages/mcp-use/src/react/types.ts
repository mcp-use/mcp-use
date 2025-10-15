import type { Tool, Resource, ResourceTemplate, Prompt } from '@modelcontextprotocol/sdk/types.js'

export type UseMcpOptions = {
  /** The /sse URL of your remote MCP server */
  url?: string
  /** Enable/disable the connection (similar to TanStack Query). When false, no connection will be attempted (default: true) */
  enabled?: boolean
  /** OAuth client name for registration (if dynamic registration is used) */
  clientName?: string
  /** OAuth client URI for registration (if dynamic registration is used) */
  clientUri?: string
  /** Custom callback URL for OAuth redirect (defaults to /oauth/callback on the current origin) */
  callbackUrl?: string
  /** Storage key prefix for OAuth data in localStorage (defaults to "mcp:auth") */
  storageKeyPrefix?: string
  /** Custom configuration for the MCP client identity */
  clientConfig?: {
    name?: string
    version?: string
  }
  /** Custom headers that can be used to bypass auth */
  customHeaders?: Record<string, string>
  /** Whether to enable verbose debug logging to the console and the log state */
  debug?: boolean
  /** Auto retry connection if initial connection fails, with delay in ms (default: false) */
  autoRetry?: boolean | number
  /** Auto reconnect if an established connection is lost, with delay in ms (default: 3000) */
  autoReconnect?: boolean | number
  /** Popup window features string (dimensions and behavior) for OAuth */
  popupFeatures?: string
  /** Transport type preference: 'auto' (HTTP with SSE fallback), 'http' (HTTP only), 'sse' (SSE only) */
  transportType?: 'auto' | 'http' | 'sse'
  /** Prevent automatic authentication popup on initial connection (default: false) */
  preventAutoAuth?: boolean
  /**
   * Callback function that is invoked just before the authentication popup window is opened.
   * @param url The URL that will be opened in the popup.
   * @param features The features string for the popup window.
   */
  onPopupWindow?: (url: string, features: string, window: globalThis.Window | null) => void
}

export type UseMcpResult = {
  /** List of tools available from the connected MCP server */
  tools: Tool[]
  /** List of resources available from the connected MCP server */
  resources: Resource[]
  /** List of resource templates available from the connected MCP server */
  resourceTemplates: ResourceTemplate[]
  /** List of prompts available from the connected MCP server */
  prompts: Prompt[]
  /**
   * The current state of the MCP connection:
   * - 'discovering': Checking server existence and capabilities (including auth requirements).
   * - 'pending_auth': Authentication is required but auto-popup was prevented. User action needed.
   * - 'authenticating': Authentication is required and the process (e.g., popup) has been initiated.
   * - 'connecting': Establishing the SSE connection to the server.
   * - 'loading': Connected; loading resources like the tool list.
   * - 'ready': Connected and ready for tool calls.
   * - 'failed': Connection or authentication failed. Check the `error` property.
   */
  state: 'discovering' | 'pending_auth' | 'authenticating' | 'connecting' | 'loading' | 'ready' | 'failed'
  /** If the state is 'failed', this provides the error message */
  error?: string
  /**
   * If authentication requires user interaction (e.g., popup was blocked),
   * this URL can be presented to the user to complete authentication manually in a new tab.
   */
  authUrl?: string
  /** Array of internal log messages (useful for debugging) */
  log: { level: 'debug' | 'info' | 'warn' | 'error'; message: string; timestamp: number }[]
  /**
   * Function to call a tool on the MCP server.
   * @param name The name of the tool to call.
   * @param args Optional arguments for the tool.
   * @returns A promise that resolves with the tool's result.
   * @throws If the client is not in the 'ready' state or the call fails.
   */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<any>
  /**
   * Function to list resources from the MCP server.
   * @returns A promise that resolves when resources are refreshed.
   * @throws If the client is not in the 'ready' state.
   */
  listResources: () => Promise<void>
  /**
   * Function to read a resource from the MCP server.
   * @param uri The URI of the resource to read.
   * @returns A promise that resolves with the resource contents.
   * @throws If the client is not in the 'ready' state or the read fails.
   */
  readResource: (uri: string) => Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }>
  /**
   * Function to list prompts from the MCP server.
   * @returns A promise that resolves when prompts are refreshed.
   * @throws If the client is not in the 'ready' state.
   */
  listPrompts: () => Promise<void>
  /**
   * Function to get a specific prompt from the MCP server.
   * @param name The name of the prompt to get.
   * @param args Optional arguments for the prompt.
   * @returns A promise that resolves with the prompt messages.
   * @throws If the client is not in the 'ready' state or the get fails.
   */
  getPrompt: (
    name: string,
    args?: Record<string, string>,
  ) => Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: { type: string; text?: string; [key: string]: any } }> }>
  /** Manually attempts to reconnect if the state is 'failed'. */
  retry: () => void
  /** Disconnects the client from the MCP server. */
  disconnect: () => void
  /**
   * Manually triggers the authentication process. Useful if the initial attempt failed
   * due to a blocked popup, allowing the user to initiate it via a button click.
   * @returns A promise that resolves with the authorization URL opened (or intended to be opened),
   *          or undefined if auth cannot be started.
   */
  authenticate: () => void
  /** Clears all stored authentication data (tokens, client info, etc.) for this server URL from localStorage. */
  clearStorage: () => void
}

