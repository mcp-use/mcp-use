/**
 * Build the base URL/path for a built widget's assets.
 *
 * The framework HTTP surface (including widget assets) lives under a
 * server-wide `basePath` (default `/mcp`), so the built HTML must reference
 * `${basePath}/mcp-use/widgets/${name}/`. Pass the project's resolved
 * `config.basePath` (from `mcp-use.config.json` via `resolveWorkspace`).
 *
 * @param mcpUrl - Public server origin, or undefined for a root-relative path
 * @param widgetName - Built widget directory name
 * @param basePath - Normalized server-wide path prefix (default `/mcp`).
 *   Already-normalized values are expected; this also tolerates `""` (root).
 */
export function getWidgetAssetBase(
  mcpUrl: string | undefined,
  widgetName: string,
  basePath: string = "/mcp"
): string {
  // Normalize defensively: single leading slash, no trailing slash, "" = root.
  const normalized = normalizeBasePathLocal(basePath);
  const widgetPath = `${normalized}/mcp-use/widgets/${widgetName}/`;
  if (!mcpUrl) {
    return widgetPath;
  }
  const origin = mcpUrl.replace(/\/+$/, "");
  return `${origin}${widgetPath}`;
}

/**
 * Build the root-relative public asset prefix (`${basePath}/mcp-use/public`)
 * for baking into built widget HTML (e.g. the favicon `<link>`).
 *
 * @param basePath - Normalized or raw server-wide path prefix (default `/mcp`).
 */
export function getPublicAssetBase(basePath: string = "/mcp"): string {
  return `${normalizeBasePathLocal(basePath)}/mcp-use/public`;
}

/**
 * Local copy of mcp-use's `normalizeBasePath` so this build-time helper stays
 * dependency-free (it runs in the CLI's bundled context): a single leading
 * slash, no trailing slash; `""`/`"/"` collapse to `""` (root).
 */
export function normalizeBasePathLocal(raw: string | undefined): string {
  if (raw === undefined) return "/mcp";
  let value = raw
    .trim()
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  if (value === "" || value === "/") return "";
  if (!value.startsWith("/")) value = `/${value}`;
  return value;
}
