// Keep this URL layout aligned with the server resource document helper. It is
// duplicated here to keep the CLI build graph independent of server runtime code.
function pathUnderBase(basePath: string, childPath: string): string {
  const child = childPath.replace(/^\/+/, "");
  return basePath === "/" ? `/${child}` : `${basePath}/${child}`;
}

/** Build the HTTP path prefix for one view's generated assets. */
export function viewAssetsBasePath(basePath: string, viewName: string): string {
  return `${pathUnderBase(basePath, `_mcp-use/views/${viewName}`)}/`;
}
