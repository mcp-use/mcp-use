/**
 * Static widget route handlers
 *
 * This module sets up HTTP routes for serving widget assets, HTML files,
 * and public resources in production mode.
 */

import type { Hono as HonoType, Context } from "hono";
import {
  pathHelpers,
  fsHelpers,
  getCwd,
  safeSubpath,
  safeSegment,
} from "../utils/runtime.js";
import {
  getContentType,
  processWidgetHtml,
  setupPublicRoutes,
  setupFaviconRoute,
} from "./widget-helpers.js";
import type { ServerConfig } from "./widget-types.js";

/**
 * Setup static file serving routes for widgets
 *
 * Creates HTTP routes to serve:
 * - Widget assets (JS, CSS, images) from dist/resources/widgets/{widget}/assets/
 * - Widget HTML files from dist/resources/widgets/{widget}/index.html
 * - Public files from dist/public/ or public/ directories
 *
 * These routes are used in production mode to serve pre-built widget bundles.
 *
 * @param app - Hono app instance to mount routes on
 * @param serverConfig - Server configuration (baseUrl)
 */
export function setupWidgetRoutes(
  app: HonoType,
  serverConfig: ServerConfig
): void {
  // Serve static assets (JS, CSS) from the assets directory
  app.get("/mcp-use/widgets/:widget/assets/*", async (c: Context) => {
    // Reject path traversal in both the widget name and the asset subpath.
    const widget = safeSegment(c.req.param("widget")!);
    const rawAsset = c.req.path.split("/assets/")[1];
    const assetFile = rawAsset == null ? null : safeSubpath(rawAsset);
    if (widget === null || assetFile === null) return c.notFound();
    const assetPath = pathHelpers.join(
      getCwd(),
      "dist",
      "resources",
      "widgets",
      widget,
      "assets",
      assetFile
    );

    try {
      if (await fsHelpers.existsSync(assetPath)) {
        const content = await fsHelpers.readFile(assetPath);
        const contentType = getContentType(assetFile);
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": contentType },
        });
      }
      return c.notFound();
    } catch {
      return c.notFound();
    }
  });

  // Handle assets served from the wrong path (browser resolves ./assets/ relative to /mcp-use/widgets/)
  app.get("/mcp-use/widgets/assets/*", async (c: Context) => {
    const rawAsset = c.req.path.split("/assets/")[1];
    const assetFile = rawAsset == null ? null : safeSubpath(rawAsset);
    if (assetFile === null) return c.notFound();
    // Try to find which widget this asset belongs to by checking all widget directories
    const widgetsDir = pathHelpers.join(
      getCwd(),
      "dist",
      "resources",
      "widgets"
    );

    try {
      const widgets = await fsHelpers.readdirSync(widgetsDir);
      for (const widget of widgets) {
        const assetPath = pathHelpers.join(
          widgetsDir,
          widget,
          "assets",
          assetFile
        );
        if (await fsHelpers.existsSync(assetPath)) {
          const content = await fsHelpers.readFile(assetPath);
          const contentType = getContentType(assetFile);
          return new Response(content, {
            status: 200,
            headers: { "Content-Type": contentType },
          });
        }
      }
      return c.notFound();
    } catch {
      return c.notFound();
    }
  });

  // Serve each widget's index.html at its route
  // e.g. GET /mcp-use/widgets/kanban-board -> dist/resources/widgets/kanban-board/index.html
  app.get("/mcp-use/widgets/:widget", async (c: Context) => {
    // A `..` widget segment would otherwise climb out of the widgets dir.
    const widget = safeSegment(c.req.param("widget")!);
    if (widget === null) return c.notFound();
    const filePath = pathHelpers.join(
      getCwd(),
      "dist",
      "resources",
      "widgets",
      widget,
      "index.html"
    );

    try {
      let html = await fsHelpers.readFileSync(filePath, "utf8");
      // Process HTML with base URL injection and path conversion
      html = processWidgetHtml(html, widget, serverConfig.serverBaseUrl);
      return c.html(html);
    } catch {
      return c.notFound();
    }
  });

  // Serve static files from public directory (production mode)
  setupPublicRoutes(app, true);

  // Setup favicon route at server root (production mode)
  setupFaviconRoute(app, serverConfig.favicon, true);
}
