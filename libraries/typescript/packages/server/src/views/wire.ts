import type { ViewManifestEntry, ViewMetadata } from "./types.js";
import {
  UI_META_KEY,
  UI_MIME_TYPE,
  UI_RESOURCE_URI_META_KEY,
  viewResourceUri,
} from "./constants.js";

/** Tool `_meta` emitted for view-bound tools when the client supports UI. */
export function buildToolUiMeta(
  viewName: string,
  visibility: "model" | "app" | undefined
): Record<string, unknown> {
  const resourceUri = viewResourceUri(viewName);
  const ui: Record<string, unknown> = { resourceUri };
  if (visibility !== undefined) {
    ui["visibility"] = [visibility];
  }
  return {
    [UI_META_KEY]: ui,
    [UI_RESOURCE_URI_META_KEY]: resourceUri,
  };
}

/**
 * Resource `_meta.ui` for a primed view, including auto-appended serving
 * origin in `csp.resourceDomains`.
 *
 * When the author declared no `csp`, emit `{ connectDomains: [], resourceDomains: [origin] }`
 * so the view's own assets are always loadable.
 */
export function buildResourceUiMeta(
  metadata: ViewMetadata,
  servingOrigin: string
): Record<string, unknown> {
  const ui: Record<string, unknown> = {};

  if (metadata.csp !== undefined || servingOrigin !== "") {
    const authorCsp = metadata.csp;
    ui["csp"] = {
      connectDomains: authorCsp?.connectDomains ?? [],
      resourceDomains: [
        ...(authorCsp?.resourceDomains ?? []),
        servingOrigin,
      ],
    };
  }

  if (metadata.permissions !== undefined) {
    ui["permissions"] = metadata.permissions;
  }
  if (metadata.domain !== undefined) {
    ui["domain"] = metadata.domain;
  }
  if (metadata.prefersBorder !== undefined) {
    ui["prefersBorder"] = metadata.prefersBorder;
  }

  return { [UI_META_KEY]: ui };
}

/** Listing metadata for a primed view resource. */
export function viewResourceConfig(
  viewName: string,
  entry: ViewManifestEntry,
  servingOrigin: string,
  uiCapable: boolean
): {
  description?: string;
  mimeType: string;
  _meta?: Record<string, unknown>;
} {
  const config: {
    description?: string;
    mimeType: string;
    _meta?: Record<string, unknown>;
  } = {
    mimeType: UI_MIME_TYPE,
  };

  if (entry.metadata.description !== undefined) {
    config.description = entry.metadata.description;
  }

  if (uiCapable) {
    config._meta = buildResourceUiMeta(entry.metadata, servingOrigin);
  }

  return config;
}
