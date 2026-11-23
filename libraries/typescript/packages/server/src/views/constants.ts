/** MCP Apps extension identifier (`io.modelcontextprotocol/ui`). */
export const UI_EXTENSION_ID = "io.modelcontextprotocol/ui" as const;

/** MIME type for MCP App view resources. */
export const UI_MIME_TYPE = "text/html;profile=mcp-app" as const;

/** URI scheme prefix for view resources (`ui://views/<name>.html`). */
const UI_RESOURCE_URI_PREFIX = "ui://views/" as const;

/** Nested `_meta` key for UI metadata on tools and resources. */
export const UI_META_KEY = "ui" as const;

/** Legacy flat `_meta` key for the view resource URI (kept while hosts read it). */
export const UI_RESOURCE_URI_META_KEY = "ui/resourceUri" as const;

/**
 * Path-version suffix of the view URIs that mcp-use 2.12 advertised
 * (`ui://views/<name>-<16 hex>.html`). Still resolved so hosts holding those
 * URIs keep loading the view.
 */
const LEGACY_PATH_VERSION_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Build a view resource URI. Production adds the build ID as a `?v=` cache
 * key; the path stays `ui://views/<name>.html`.
 *
 * @param viewName - View directory / registry key.
 * @param buildId - Immutable production build ID; omit for the bare URI.
 */
export function viewResourceUri(viewName: string, buildId?: string): string {
  const query =
    buildId === undefined ? "" : `?v=${encodeURIComponent(buildId)}`;
  return `${UI_RESOURCE_URI_PREFIX}${viewName}.html${query}`;
}

/**
 * Resolve any URI a client may hold for a view to that view's name.
 *
 * The `?v=` query is only a cache key, not part of the view's identity, so it
 * is ignored: `ui://views/<name>.html` with any version or none resolves to
 * the view. The path-versioned `ui://views/<name>-<16 hex>.html` form from
 * mcp-use 2.12 resolves too. A host that kept a tool catalog from an earlier
 * deployment (for example a published ChatGPT app with a frozen tool list)
 * then still reaches the current view instead of resource-not-found. An exact
 * name wins over a path-versioned match, and the longest name wins among
 * those, so views `foo` and `foo-bar` never shadow each other.
 *
 * @param uri - Requested resource URI.
 * @param viewNames - Names of the views the server currently serves.
 * @returns The matching view name, or `undefined` when none matches.
 */
export function resolveViewResourceUri(
  uri: string,
  viewNames: Iterable<string>
): string | undefined {
  const queryIndex = uri.indexOf("?");
  const path = queryIndex === -1 ? uri : uri.slice(0, queryIndex);
  if (!path.startsWith(UI_RESOURCE_URI_PREFIX) || !path.endsWith(".html")) {
    return undefined;
  }
  const stem = path.slice(UI_RESOURCE_URI_PREFIX.length, -".html".length);
  let match: string | undefined;
  for (const name of viewNames) {
    if (name === stem) {
      return name;
    }
    if (
      stem.startsWith(`${name}-`) &&
      LEGACY_PATH_VERSION_PATTERN.test(stem.slice(name.length + 1)) &&
      (match === undefined || name.length > match.length)
    ) {
      match = name;
    }
  }
  return match;
}
