/** Shared Vite tooling used by framework adapters. @internal */
export { mcpUseViewsPlugin } from "../cli/views-plugin.js";
export {
  discoverViews,
  buildDevViewsManifest,
  virtualViewId,
  isViewEntryPath,
} from "../cli/views.js";
export { syncMcpEnvDeclaration } from "../cli/mcp-env-declaration.js";
