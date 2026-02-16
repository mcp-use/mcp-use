/**
 * Authentication utilities for browser-based MCP OAuth
 */

export { BrowserOAuthClientProvider } from "./browser-provider.js";
export { onMcpAuthorization } from "./callback.js";
export {
  probeAuthParams,
  type ProbeAuthParamsResult,
} from "./probe-www-auth.js";
export type { StoredState } from "./types.js";
