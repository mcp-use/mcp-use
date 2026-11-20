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
export {
  createLandingAssetsHandler,
  createViewPublicHandler,
  createViewAssetsHandler,
} from "./routes.js";
export {
  buildResourceUiMeta,
  buildToolResultUiMeta,
  buildToolUiMeta,
  viewResourceConfig,
  type BuildResourceUiMetaOptions,
} from "./wire.js";
export { resolveViewResourceUri, viewResourceUri } from "./constants.js";
export { computeViewVersion } from "./version.js";
export { applyClaudeResourceDomain } from "./claude-domain.js";
