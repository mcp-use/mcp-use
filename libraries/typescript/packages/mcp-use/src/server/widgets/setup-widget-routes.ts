/**
 * Static widget route handlers
 *
 * This module sets up HTTP routes for serving widget assets, HTML files,
 * and public resources in production mode.
 */

import type { Hono as HonoType, Context } from "hono";
import { pathHelpers, fsHelpers } from "../utils/runtime.js";
import {
  getContentType,
  processWidgetHtml,
  setupPublicRoutes,
  setupFaviconRoute,
} from "./widget-helpers.js";
import { widgetAssetBase } from "../config/base-path.js";
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
  // All built widgets live under `<buildDir>/resources/widgets/` (buildDir is
  // the fixed `.mcp-use/build` output).
  const widgetsDir = pathHelpers.join(
    serverConfig.buildDir,
    "resources",
    "widgets"
  );

  // Asset/HTML routes relocate under the server-wide basePath, e.g.
  // `${basePath}/mcp-use/widgets/...` (default `/mcp/mcp-use/widgets/...`).
  const widgetsBase = widgetAssetBase(serverConfig.basePath);

  // Serve static assets (JS, CSS) from the assets directory
  app.get(`${widgetsBase}/:widget/assets/*`, async (c: Context) => {
    const widget = c.req.param("widget")!;
    const assetFile = c.req.path.split("/assets/")[1];
    const assetPath = pathHelpers.join(widgetsDir, widget, "assets", assetFile);

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

  // Handle assets served from the wrong path (browser resolves ./assets/ relative to ${widgetsBase}/)
  app.get(`${widgetsBase}/assets/*`, async (c: Context) => {
    const assetFile = c.req.path.split("/assets/")[1];
    // Try to find which widget this asset belongs to by checking all widget directories
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
  // e.g. GET ${widgetsBase}/kanban-board -> <buildDir>/resources/widgets/kanban-board/index.html
  app.get(`${widgetsBase}/:widget`, async (c: Context) => {
    const widget = c.req.param("widget")!;
    const filePath = pathHelpers.join(widgetsDir, widget, "index.html");

    try {
      let html = await fsHelpers.readFileSync(filePath, "utf8");
      // Process HTML with base URL injection and path conversion
      html = processWidgetHtml(
        html,
        widget,
        serverConfig.serverBaseUrl,
        serverConfig.basePath
      );
      return c.html(html);
    } catch {
      return c.notFound();
    }
  });

  // Serve static files from public directory (production mode)
  setupPublicRoutes(app, true, serverConfig.buildDir, serverConfig.basePath);

  // Setup favicon route at server root (production mode)
  setupFaviconRoute(app, serverConfig.favicon, true, serverConfig.buildDir);
}
