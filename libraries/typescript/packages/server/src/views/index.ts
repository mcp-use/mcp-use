export { registerViews } from "./register.js";
export type {
  ExternalViewManifestEntry,
  InlineViewManifestEntry,
  UiPermissions,
  ViewManifestEntry,
  ViewsManifest,
} from "./types.js";
export { synthesizeViewDocument } from "./document.js";
export { resolveAssetsBase } from "./origin.js";
export { createViewPublicHandler, createViewAssetsHandler } from "./routes.js";
export {
  buildResourceUiMeta,
  buildToolResultUiMeta,
  buildToolUiMeta,
  viewResourceConfig,
  type BuildResourceUiMetaOptions,
} from "./wire.js";
export { viewResourceUri } from "./constants.js";
export { applyClaudeResourceDomain } from "./claude-domain.js";
