/** Shared Vite tooling used by framework adapters. @internal */
export { mcpUseViewsPlugin } from "../build/views-plugin.js";
export {
  discoverViews,
  buildDevViewsManifest,
  virtualViewId,
  isViewEntryPath,
} from "../build/views.js";
export { syncMcpEnvDeclaration } from "../build/mcp-env-declaration.js";

export { readViewConfig } from "../build/view-config.js";
