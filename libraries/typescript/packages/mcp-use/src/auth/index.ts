/**
 * Authentication utilities for browser-based MCP OAuth
 */

export { BrowserOAuthClientProvider } from "./browser-provider.js";
export { onMcpAuthorization } from "./callback.js";
export {
  probeAuthParams,
  type ProbeAuthParamsResult,
} from "./probe-www-auth.js";
export {
  runAuthPopup,
  MCP_AUTH_BROADCAST_CHANNEL,
  MCP_AUTH_CALLBACK_MESSAGE_TYPE,
  type AuthPopupResult,
  type RunAuthPopupOptions,
  type McpAuthCallbackMessage,
} from "./popup-runner.js";
export type { StoredState } from "./types.js";
