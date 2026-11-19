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
 * Version suffix shape of production view URIs: 16 lowercase hex characters,
 * both for content-derived versions and for the random build IDs that
 * earlier releases advertised.
 */
const VIEW_VERSION_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Build a view resource URI, versioned when a production version is supplied.
 *
 * @param viewName - View directory / registry key.
 * @param version - Content-derived production version; omit for unversioned
 * URIs.
 */
export function viewResourceUri(viewName: string, version?: string): string {
  const suffix = version === undefined ? "" : `-${version}`;
  return `${UI_RESOURCE_URI_PREFIX}${viewName}${suffix}.html`;
}

/**
 * Resolve any URI a client may hold for a view to that view's name.
 *
 * Accepts the unversioned form `ui://views/<name>.html` and any versioned form
 * `ui://views/<name>-<16 hex>.html`, whatever the version. A host that kept a
 * tool catalog from an earlier deployment (for example a published ChatGPT
 * app with a frozen tool list) then still reaches the current view instead of
 * resource-not-found. An exact name wins over a versioned match, and the
 * longest view name wins among versioned matches, so views `foo` and
 * `foo-bar` never shadow each other.
 *
 * @param uri - Requested resource URI.
 * @param viewNames - Names of the views the server currently serves.
 * @returns The matching view name, or `undefined` when none matches.
 */
export function resolveViewResourceUri(
  uri: string,
  viewNames: Iterable<string>
): string | undefined {
  if (!uri.startsWith(UI_RESOURCE_URI_PREFIX) || !uri.endsWith(".html")) {
    return undefined;
  }
  const stem = uri.slice(UI_RESOURCE_URI_PREFIX.length, -".html".length);
  let match: string | undefined;
  for (const name of viewNames) {
    if (name === stem) {
      return name;
    }
    if (
      stem.startsWith(`${name}-`) &&
      VIEW_VERSION_PATTERN.test(stem.slice(name.length + 1)) &&
      (match === undefined || name.length > match.length)
    ) {
      match = name;
    }
  }
  return match;
}
