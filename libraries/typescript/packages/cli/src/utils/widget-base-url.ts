const PRODUCTION_WIDGET_ROUTE = "/mcp-use/widgets";

/**
 * Return the Vite base URL that matches the production widget static route.
 *
 * The production server mounts built widget assets under
 * /mcp-use/widgets/:widget/assets/*, so builds that use an absolute MCP_URL
 * must keep the same route prefix instead of publishing assets under
 * /:widget/assets/*.
 */
export function getWidgetBuildBaseUrl(
  widgetName: string,
  mcpUrl?: string
): string {
  const widgetRoute = `${PRODUCTION_WIDGET_ROUTE}/${widgetName}/`;
  if (!mcpUrl) {
    return widgetRoute;
  }

  return `${mcpUrl.replace(/\/+$/, "")}${widgetRoute}`;
}
