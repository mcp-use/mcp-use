// Keep this URL layout aligned with the server resource document helper. The
// join rule lives in ../base-path.js to keep the CLI build graph independent of
// server runtime code while giving every consumer one answer for basePath "/".
import { pathUnderBase } from "../base-path.js";

/** Build the HTTP path prefix for one view's generated assets. */
export function viewAssetsBasePath(basePath: string, viewName: string): string {
  return `${pathUnderBase(basePath, `_mcp-use/views/${viewName}`)}/`;
}
