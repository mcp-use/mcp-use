export function getWidgetAssetBase(
  mcpUrl: string | undefined,
  widgetName: string
): string {
  const widgetPath = `/mcp-use/widgets/${widgetName}/`;
  if (!mcpUrl) {
    return widgetPath;
  }
  const origin = mcpUrl.replace(/\/+$/, "");
  return `${origin}${widgetPath}`;
}
