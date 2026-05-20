/**
 * Static widget route handlers
 *
 * This module sets up HTTP routes for serving widget assets, HTML files,
 * and public resources in production mode.
 */

import type { Context, Hono as HonoType } from "hono";
import { fsHelpers, getCwd, pathHelpers } from "../utils/runtime.js";
import {
  getContentType,
  processWidgetHtml,
  setupFaviconRoute,
  setupPublicRoutes,
} from "./widget-helpers.js";
import type { ServerConfig } from "./widget-types.js";

/**
 * Setup static file serving routes for widgets
 *
 * Routes (always at the host root — basePath-agnostic):
 * - `/_mcp-use/widgets/{widget}`              → .mcp-use/widgets/{widget}/index.html
 * - `/_mcp-use/widgets/{widget}/assets/*`     → .mcp-use/widgets/{widget}/assets/*
 * - `/_mcp-use/public/*`                      → .mcp-use/public/*
 *
 * Widget HTML is post-processed via `processWidgetHtml` so emitted asset
 * URLs are bare `/_mcp-use/widgets/...` references.
 *
 * @param rootApp - The underlying Hono instance. All `_mcp-use/*` routes
 *   register here so they bypass any `basePath` prefix.
 * @param serverConfig - Server configuration.
 */
export function setupWidgetRoutes(
  rootApp: HonoType,
  serverConfig: ServerConfig
): void {
  // Widget HTML (single index.html per widget)
  rootApp.get("/_mcp-use/widgets/:widget", async (c: Context) => {
    const widget = c.req.param("widget")!;
    const filePath = pathHelpers.join(
      getCwd(),
      ".mcp-use",
      "widgets",
      widget,
      "index.html"
    );

    try {
      let html = await fsHelpers.readFileSync(filePath, "utf8");
      html = processWidgetHtml(html, widget, serverConfig.serverBaseUrl);
      return c.html(html);
    } catch {
      return c.notFound();
    }
  });

  // Widget assets (JS/CSS/images) — single handler, prefix-strip → file path.
  rootApp.get("/_mcp-use/widgets/:widget/assets/*", async (c: Context) => {
    const widget = c.req.param("widget")!;
    const assetFile = c.req.path.split("/assets/")[1];
    const assetPath = pathHelpers.join(
      getCwd(),
      ".mcp-use",
      "widgets",
      widget,
      "assets",
      assetFile
    );

    try {
      if (await fsHelpers.existsSync(assetPath)) {
        const content = await fsHelpers.readFile(assetPath);
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": getContentType(assetFile) },
        });
      }
      return c.notFound();
    } catch {
      return c.notFound();
    }
  });

  // Public assets at `/_mcp-use/public/*`
  setupPublicRoutes(rootApp, true);

  // Favicon at server root (production mode).
  setupFaviconRoute(rootApp, serverConfig.favicon, true);
}
