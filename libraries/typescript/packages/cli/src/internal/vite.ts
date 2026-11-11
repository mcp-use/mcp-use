/** Shared Vite tooling used by framework adapters. @internal */
export { mcpUseViewsPlugin } from "../toolchain/views-plugin.js";
export {
  discoverViews,
  buildDevViewsManifest,
  virtualViewId,
  isViewEntryPath,
} from "../toolchain/views.js";
export { syncMcpEnvDeclaration } from "../toolchain/mcp-env-declaration.js";

export { readViewConfig } from "../toolchain/view-config.js";
