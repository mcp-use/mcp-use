/**
 * MCP Inspector - Middleware for mounting inspector UI on Express apps
 *
 * This is the main entry point for importing the inspector as a library.
 * For standalone server usage, see cli.ts
 */

export { mountInspector } from "./middleware.js";
export {
  registerInspectorProxyRoutes,
  type InspectorProxyRoutesConfig,
} from "./proxy-routes.js";
export {
  registerInspectorCdnShell,
  type CdnShellConfig,
  type InspectorMode,
} from "./cdn-shell.js";
