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
 * Build a view resource URI, versioned when a production build ID is supplied.
 *
 * @param viewName - View directory / registry key.
 * @param buildId - Immutable production build ID; omit for unversioned URIs.
 */
export function viewResourceUri(viewName: string, buildId?: string): string {
  const suffix = buildId === undefined ? "" : `-${buildId}`;
  return `${UI_RESOURCE_URI_PREFIX}${viewName}${suffix}.html`;
}
