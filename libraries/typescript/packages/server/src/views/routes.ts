import { join } from "node:path";

import type { Hono } from "hono";

import type { ViewManifestEntry } from "./types.js";
import {
  resolvePublicFilePath,
  servePublicFile,
} from "./public-route.js";

const PUBLIC_BUILD_DIR = ".mcp-use/build/views/public";
const PUBLIC_DEV_DIR = "public";

/**
 * Mount the public-asset route under `${basePath}/_mcp-use/public/`.
 *
 * Public responses include `Access-Control-Allow-Origin: *` for
 * cross-origin sandboxed view iframes.
 *
 * Hosts obtain view documents only through `resources/read`; there is no
 * HTTP document or bundle-asset route. Routes exist only when views are
 * primed; a tool-only server is unchanged.
 *
 * @param app - Hono app that already mounts the MCP endpoint.
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 * @param views - Primed view registry; empty skips mounting.
 * @param options - When `dev` is true, the public route reads from
 *   `<projectRoot>/public` instead of `.mcp-use/build/views/public/`.
 *   `projectRoot` defaults to `process.cwd()`.
 *
 * @internal
 */
export function mountViewRoutes(
  app: Hono,
  basePath: string,
  views: ReadonlyMap<string, ViewManifestEntry>,
  options?: { dev?: boolean; projectRoot?: string }
): void {
  if (views.size === 0) {
    return;
  }

  const publicPrefix = `${basePath}/_mcp-use/public`;
  const publicRoot = join(
    options?.projectRoot ?? process.cwd(),
    options?.dev === true ? PUBLIC_DEV_DIR : PUBLIC_BUILD_DIR
  );

  app.get(`${publicPrefix}/:path{.+}`, (c) => {
    const subpath = c.req.param("path") ?? "";
    const diskPath = resolvePublicFilePath(publicRoot, subpath);
    if (diskPath === null) {
      return c.text("Not Found", 404);
    }
    return servePublicFile(diskPath);
  });
}
