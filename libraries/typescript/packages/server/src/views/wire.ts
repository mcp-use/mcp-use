import type { MetaObject } from "@modelcontextprotocol/server";

import type { ViewManifestEntry, ViewResourceFacts } from "./types.js";
import {
  UI_META_KEY,
  UI_MIME_TYPE,
  UI_RESOURCE_URI_META_KEY,
  viewResourceUri,
} from "./constants.js";
import { buildMergedResourceCsp, type BuildCspOptions } from "./csp-env.js";
import {
  hasExplicitAssetsBase,
  originFromAssetsBase,
  resolveAssetsBase,
  resolveServerOrigin,
} from "./origin.js";

/**
 * Tool declaration `_meta` for `tools/list`.
 *
 * When `viewName` is set, emits `ui.resourceUri` plus the legacy flat
 * {@link UI_RESOURCE_URI_META_KEY} key. When `visibility` is set, emits
 * `ui.visibility: [visibility]`. Either may be set independently — a
 * view-less tool can still declare app-only visibility. Returns `undefined`
 * only when no view, visibility, or existing metadata is provided.
 *
 * @param viewName - Bound view directory / manifest key, or `undefined` when
 * the tool has no view.
 * @param visibility - Optional model/app visibility narrowing from the tool
 * definition's top-level `visibility` field.
 * @param existingMetadata - Optional author-supplied definition metadata. Other
 * keys pass through, while framework-owned resource URI and visibility keys
 * are derived exclusively from `viewName` and `visibility`.
 * @returns Wire metadata for the tool listing, or `undefined` when there is
 * nothing to emit.
 */
export function buildToolUiMeta(
  viewName: string | undefined,
  visibility: "model" | "app" | undefined,
  existingMetadata?: MetaObject
): MetaObject | undefined {
  if (
    viewName === undefined &&
    visibility === undefined &&
    existingMetadata === undefined
  ) {
    return undefined;
  }

  const meta: MetaObject = { ...existingMetadata };
  const existingUi = existingMetadata?.[UI_META_KEY];
  const existingUiIsObject =
    typeof existingUi === "object" &&
    existingUi !== null &&
    !Array.isArray(existingUi);
  const ui: MetaObject = existingUiIsObject ? { ...existingUi } : {};

  if (viewName !== undefined) {
    const resourceUri = viewResourceUri(viewName);
    ui["resourceUri"] = resourceUri;
    meta[UI_RESOURCE_URI_META_KEY] = resourceUri;
  } else {
    // These keys describe the top-level view contract. Do not advertise an
    // author-supplied URI when the tool has no declared view.
    delete ui["resourceUri"];
    delete meta[UI_RESOURCE_URI_META_KEY];
  }

  if (visibility !== undefined) {
    ui["visibility"] = [visibility];
  } else {
    // Visibility is likewise derived exclusively from the top-level field.
    delete ui["visibility"];
  }

  if (
    viewName !== undefined ||
    visibility !== undefined ||
    existingUiIsObject
  ) {
    meta[UI_META_KEY] = ui;
  }

  return meta;
}

/**
 * Tool result `_meta` stamped on completed non-error `CallToolResult` values
 * from a view-bound tool.
 *
 * Emits the nested `ui.resourceUri` key and the legacy flat
 * {@link UI_RESOURCE_URI_META_KEY} key so hosts can open the bound view.
 * Error results (`isError: true`) and intermediate `input_required` returns
 * must not receive this metadata. A stamped error URI would create a new
 * rendered view through legacy host behavior. Result `_meta` is view-only and
 * never enters model context.
 *
 * @param viewName - Bound view directory / registry key.
 * @returns Nested and legacy resource-URI wire keys.
 */
export function buildToolResultUiMeta(
  viewName: string
): Record<string, unknown> {
  const resourceUri = viewResourceUri(viewName);
  return {
    [UI_META_KEY]: { resourceUri },
    [UI_RESOURCE_URI_META_KEY]: resourceUri,
  };
}

/**
 * Options for {@link buildResourceUiMeta}.
 *
 * @internal
 */
export interface BuildResourceUiMetaOptions {
  /** Request used to resolve server/assets origins when not passed explicitly. */
  request?: Request;
  /** Explicit server origin (overrides request resolution). */
  serverOrigin?: string;
  /** Explicit assets URL prefix (overrides request resolution). */
  assetsBase?: string;
  /**
   * When true, append the server origin's websocket variant to
   * `csp.connectDomains` for Vite HMR under host-enforced CSP.
   */
  hmrWs?: boolean;
}

function resolveCspOptions(
  options?: BuildResourceUiMetaOptions
): BuildCspOptions {
  const request = options?.request;
  const serverOrigin =
    options?.serverOrigin ??
    (request !== undefined ? resolveServerOrigin(request) : "");
  const assetsBase =
    options?.assetsBase ??
    (request !== undefined ? resolveAssetsBase(request) : serverOrigin);

  return {
    serverOrigin,
    assetsOrigin: originFromAssetsBase(assetsBase),
    explicitAssetsBase: hasExplicitAssetsBase(),
    ...(options?.hmrWs === true ? { hmrWs: true as const } : {}),
  };
}

/**
 * Resource `_meta.ui` for a primed view.
 *
 * Emits `csp` by merging author `view.csp`, env (`CSP_URLS` / `CSP_*_DOMAINS`),
 * and MCP auto-append (`MCP_URL` → connect; assets origin → resource).
 */
export function buildResourceUiMeta(
  authorFacts: ViewResourceFacts | undefined,
  options?: BuildResourceUiMetaOptions
): Record<string, unknown> {
  const csp = buildMergedResourceCsp(authorFacts, resolveCspOptions(options));

  const ui: Record<string, unknown> = { csp };

  if (authorFacts?.permissions !== undefined) {
    ui["permissions"] = authorFacts.permissions;
  }
  if (authorFacts?.domain !== undefined) {
    ui["domain"] = authorFacts.domain;
  }
  if (authorFacts?.prefersBorder !== undefined) {
    ui["prefersBorder"] = authorFacts.prefersBorder;
  }

  return { [UI_META_KEY]: ui };
}

/**
 * Listing metadata for a primed view resource.
 */
export function viewResourceConfig(
  _viewName: string,
  _entry: ViewManifestEntry,
  authorFacts: ViewResourceFacts | undefined,
  options?: BuildResourceUiMetaOptions
): {
  mimeType: string;
  description?: string;
  _meta: Record<string, unknown>;
} {
  return {
    mimeType: UI_MIME_TYPE,
    ...(authorFacts?.description !== undefined && {
      description: authorFacts.description,
    }),
    _meta: buildResourceUiMeta(authorFacts, options),
  };
}
