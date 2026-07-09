import type { ViewManifestEntry, ViewResourceFacts } from "./types.js";
import {
  TOOL_NAME_META_KEY,
  UI_META_KEY,
  UI_MIME_TYPE,
  UI_RESOURCE_URI_META_KEY,
  viewResourceUri,
} from "./constants.js";

/**
 * Tool declaration `_meta` for `tools/list`.
 *
 * When `viewName` is set, emits `ui.resourceUri` plus the legacy flat
 * {@link UI_RESOURCE_URI_META_KEY} key. When `visibility` is set, emits
 * `ui.visibility: [visibility]`. Either may be set independently — a
 * view-less tool can still declare app-only visibility. Returns
 * `undefined` when both are unset so the caller omits `_meta`.
 *
 * @param viewName - Bound view directory / manifest key, or `undefined` when
 * the tool has no view.
 * @param visibility - Optional model/app visibility narrowing from the tool
 * definition's top-level `visibility` field.
 * @returns Wire metadata for the tool listing, or `undefined` when there is
 * nothing to emit.
 */
export function buildToolUiMeta(
  viewName: string | undefined,
  visibility: "model" | "app" | undefined
): Record<string, unknown> | undefined {
  if (viewName === undefined && visibility === undefined) {
    return undefined;
  }

  const ui: Record<string, unknown> = {};
  const meta: Record<string, unknown> = { [UI_META_KEY]: ui };

  if (viewName !== undefined) {
    const resourceUri = viewResourceUri(viewName);
    ui["resourceUri"] = resourceUri;
    meta[UI_RESOURCE_URI_META_KEY] = resourceUri;
  }
  if (visibility !== undefined) {
    ui["visibility"] = [visibility];
  }

  return meta;
}

/**
 * Tool result `_meta` stamped on every non-error `CallToolResult` from a
 * view-bound tool.
 *
 * Emits the resource-URI wire keys (`ui.resourceUri` and the legacy flat
 * key) plus {@link TOOL_NAME_META_KEY} at the top level of `_meta` (sibling
 * of `ui`, not inside it). The `ui/notifications/tool-result` wire
 * notification carries no tool identity; with several tools bound to one
 * view this is how the view's `useToolContext().toolName` discriminates
 * which tool's output arrived. Result `_meta` is view-only and never
 * enters model context.
 *
 * @param viewName - Bound view directory / manifest key.
 * @param toolName - The calling tool's registered name.
 * @returns Resource-URI wire keys plus the tool-name stamp.
 */
export function buildToolResultUiMeta(
  viewName: string,
  toolName: string
): Record<string, unknown> {
  const resourceUri = viewResourceUri(viewName);
  return {
    [TOOL_NAME_META_KEY]: toolName,
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
  /**
   * When true, append the serving origin's websocket variant
   * (`http:` → `ws:`, `https:` → `wss:`) to `csp.connectDomains` for Vite
   * HMR under host-enforced CSP.
   */
  hmrWs?: boolean;
}

/**
 * Derive a websocket origin from an HTTP(S) serving origin.
 *
 * @param servingOrigin - Request-resolved `http://` or `https://` origin.
 * @returns The corresponding `ws://` or `wss://` origin.
 */
function toWebSocketOrigin(servingOrigin: string): string {
  if (servingOrigin.startsWith("https://")) {
    return `wss://${servingOrigin.slice("https://".length)}`;
  }
  if (servingOrigin.startsWith("http://")) {
    return `ws://${servingOrigin.slice("http://".length)}`;
  }
  return servingOrigin;
}

/**
 * Resource `_meta.ui` for a primed view.
 *
 * Emits `csp` by spreading author-declared fields from the bound tool's
 * `view:` config (including `frameDomains` and `baseUriDomains`) with
 * `connectDomains` defaulting to `[]` and the request-derived serving origin
 * appended to `resourceDomains` when non-empty. When `options.hmrWs` is
 * true, the serving origin's websocket variant is appended to
 * `connectDomains` (after author-declared entries, without duplication).
 * `permissions`, `domain`, and `prefersBorder` are included only when the
 * author set them.
 *
 * @param authorFacts - Resource facts from the bound tool's `view:` config, or
 * `undefined` for unbound views (auto CSP only).
 * @param servingOrigin - Request-resolved asset origin appended to
 * `csp.resourceDomains` and, when `options.hmrWs`, used to derive the HMR
 * websocket origin for `csp.connectDomains`.
 * @param options - Optional emission flags (dev HMR websocket origin).
 */
export function buildResourceUiMeta(
  authorFacts: ViewResourceFacts | undefined,
  servingOrigin: string,
  options?: BuildResourceUiMetaOptions
): Record<string, unknown> {
  const authorResourceDomains = authorFacts?.csp?.resourceDomains ?? [];
  const resourceDomains = [
    ...authorResourceDomains,
    ...(servingOrigin !== "" ? [servingOrigin] : []),
  ];

  const authorConnectDomains = authorFacts?.csp?.connectDomains ?? [];
  const connectDomains = [...authorConnectDomains];
  if (options?.hmrWs === true && servingOrigin !== "") {
    const wsOrigin = toWebSocketOrigin(servingOrigin);
    if (!connectDomains.includes(wsOrigin)) {
      connectDomains.push(wsOrigin);
    }
  }

  const ui: Record<string, unknown> = {
    csp: {
      ...authorFacts?.csp,
      connectDomains,
      resourceDomains,
    },
  };

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
 *
 * @param _viewName - View directory / manifest key (reserved for future use).
 * @param _entry - Primed manifest entry (reserved for future use).
 * @param authorFacts - Resource facts from the bound tool's `view:` config.
 * @param servingOrigin - Request-resolved asset origin for CSP emission.
 * @param options - Optional emission flags forwarded to
 * {@link buildResourceUiMeta}.
 */
export function viewResourceConfig(
  _viewName: string,
  _entry: ViewManifestEntry,
  authorFacts: ViewResourceFacts | undefined,
  servingOrigin: string,
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
    _meta: buildResourceUiMeta(authorFacts, servingOrigin, options),
  };
}
