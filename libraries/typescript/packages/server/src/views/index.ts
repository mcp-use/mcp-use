export { registerViews } from "./register.js";
export type { RegisterViews } from "./register.js";
export {
  UI_EXTENSION_ID,
  UI_META_KEY,
  UI_MIME_TYPE,
  UI_RESOURCE_URI_META_KEY,
  UI_RESOURCE_URI_PREFIX,
  viewResourceUri,
} from "./constants.js";
export type {
  ExternalViewManifestEntry,
  InlineViewManifestEntry,
  UiPermissions,
  ViewManifestEntry,
  ViewResourceFacts,
  ViewsManifest,
} from "./types.js";
export { synthesizeViewDocument, resolveAssetUrl } from "./document.js";
export { resolveRequestOrigin } from "./origin.js";
export { createViewPublicHandler } from "./routes.js";
export {
  extractClientCapabilitiesFromBody,
  getStashedClientCapabilities,
  stashClientCapabilities,
  supportsViews,
} from "./capabilities.js";
export {
  buildResourceUiMeta,
  buildToolResultUiMeta,
  buildToolUiMeta,
  viewResourceConfig,
} from "./wire.js";
