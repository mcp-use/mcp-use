/**
 * MCP Inspector - local Fetch handler and framework mounting adapters
 *
 * This is the main entry point for importing the inspector as a library.
 * For standalone server usage, see cli.ts
 */

export {
  mountInspector,
  type InspectorFetchHandler,
  type MountInspectorOptions,
} from "./middleware.js";
export {
  registerInspectorProxyRoutes,
  type InspectorProxyRoutesConfig,
} from "./proxy-routes.js";
export {
  createMemoryOAuthProxyStateStore,
  createRedisOAuthProxyStateStore,
  decodeOAuthProxyEncryptionKey,
  type OAuthProxyStateStore,
} from "./proxy/oauth-state-store.js";
export type {
  OAuthProxyConfidentialClient,
  OAuthProxyConfidentialClientResolver,
} from "./proxy/oauth-proxy.js";
