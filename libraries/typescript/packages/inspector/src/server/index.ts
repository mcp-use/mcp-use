// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- tsup's declaration build does not automatically include this ambient subpath type.
/// <reference path="../rate-limiter-flexible-memory.d.ts" />

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
