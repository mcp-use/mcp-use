/** MCP Apps extension identifier (`io.modelcontextprotocol/ui`). */
export const UI_EXTENSION_ID = "io.modelcontextprotocol/ui" as const;

/** MIME type for MCP App view resources. */
export const UI_MIME_TYPE = "text/html;profile=mcp-app" as const;

/** URI scheme prefix for view resources (`ui://views/<name>.html`). */
export const UI_RESOURCE_URI_PREFIX = "ui://views/" as const;

/** Nested `_meta` key for UI metadata on tools and resources. */
export const UI_META_KEY = "ui" as const;

/** Legacy flat `_meta` key for the view resource URI (kept while hosts read it). */
export const UI_RESOURCE_URI_META_KEY = "ui/resourceUri" as const;

/**
 * Framework `_meta` key stamped on every non-error result of a view-bound
 * tool, carrying the calling tool's name. The wire notifications
 * (`ui/notifications/tool-result`) carry no tool identity, so with several
 * tools bound to one view this is how the view discriminates which tool's
 * output arrived (`useToolContext().toolName`). Result `_meta` is the
 * view-only channel — the name never enters model context.
 */
export const TOOL_NAME_META_KEY = "mcp-use/toolName" as const;

/**
 * Build the stable `ui://` resource URI for a view name.
 *
 * @param viewName - View directory / manifest key.
 */
export function viewResourceUri(viewName: string): string {
  return `${UI_RESOURCE_URI_PREFIX}${viewName}.html`;
}
