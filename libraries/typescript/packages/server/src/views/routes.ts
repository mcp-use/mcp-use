import { createReadStream, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";

import type { Hono } from "hono";

import type { ViewManifestEntry } from "./types.js";
import { synthesizeViewDocument } from "./document.js";
import { resolveRequestOrigin } from "./origin.js";
import {
  resolvePublicFilePath,
  servePublicFile,
} from "./public-route.js";

const ASSETS_DIR = ".mcp-use/build/views/assets";
const PUBLIC_BUILD_DIR = ".mcp-use/build/views/public";
const PUBLIC_DEV_DIR = "public";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".map": "application/json",
};

/**
 * Mount view document and asset routes under `${basePath}/_mcp-use/`.
 *
 * Asset and public responses include `Access-Control-Allow-Origin: *` for
 * cross-origin sandboxed view iframes (module scripts use CORS mode).
 *
 * Routes exist only when views are primed; a tool-only server is unchanged.
 *
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

  const viewsPrefix = `${basePath}/_mcp-use/views`;
  const assetsPrefix = `${basePath}/_mcp-use/assets`;
  const publicPrefix = `${basePath}/_mcp-use/public`;
  const publicRoot = join(
    options?.projectRoot ?? process.cwd(),
    options?.dev === true ? PUBLIC_DEV_DIR : PUBLIC_BUILD_DIR
  );

  app.get(`${viewsPrefix}/:name`, (c) => {
    const rawName = c.req.param("name");
    if (rawName === undefined || !rawName.endsWith(".html")) {
      return c.text("Not Found", 404);
    }
    const name = rawName.slice(0, -".html".length);
    const entry = views.get(name);
    if (entry === undefined) {
      return c.text("Not Found", 404);
    }
    const origin = resolveRequestOrigin(c.req.raw);
    const html = synthesizeViewDocument(entry, origin, basePath);
    return c.html(html, 200, { "Cache-Control": "no-store" });
  });

  app.get(`${assetsPrefix}/:file`, async (c) => {
    const file = c.req.param("file");
    if (file === undefined) {
      return c.text("Not Found", 404);
    }
    if (file.includes("/") || file.includes("\\") || file === "." || file === "..") {
      return c.text("Not Found", 404);
    }
    const diskPath = join(process.cwd(), ASSETS_DIR, basename(file));
    if (!existsSync(diskPath)) {
      return c.text("Not Found", 404);
    }
    const ext = file.includes(".") ? `.${file.split(".").pop()}` : "";
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const nodeStream = createReadStream(diskPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });

  app.get(`${publicPrefix}/:path{.+}`, (c) => {
    const subpath = c.req.param("path") ?? "";
    const diskPath = resolvePublicFilePath(publicRoot, subpath);
    if (diskPath === null) {
      return c.text("Not Found", 404);
    }
    return servePublicFile(diskPath);
  });
}
