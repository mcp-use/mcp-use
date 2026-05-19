/**
 * Static widget route handlers
 *
 * This module sets up HTTP routes for serving widget assets, HTML files,
 * and public resources in production mode.
 */

import type { Hono as HonoType, Context } from "hono";
import { pathHelpers, fsHelpers, getCwd } from "../utils/runtime.js";
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
  const basePath = serverConfig.basePath ?? "";
  // Register on the inner app at bare paths. When `basePath` is configured
  // the inner app is sub-mounted under it externally, so these become
  // `${basePath}/mcp-use/widgets/...` from the outside. `basePath` is still
  // threaded into `processWidgetHtml` because emitted HTML needs absolute
  // URLs that include the prefix.
  // Serve static assets (JS, CSS) from the assets directory
  app.get("/mcp-use/widgets/:widget/assets/*", async (c: Context) => {
    const widget = c.req.param("widget")!;
    const assetFile = c.req.path.split("/assets/")[1];
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
    const assetFile = c.req.path.split("/assets/")[1];
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
    const widget = c.req.param("widget")!;
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
      // Process HTML with base URL injection and path conversion.
      // basePath still flows in here because emitted <script src>/<link href>
      // URLs need to be absolute and include the prefix so the browser
      // requests `${baseUrl}${basePath}/mcp-use/widgets/...`.
      html = processWidgetHtml(
        html,
        widget,
        serverConfig.serverBaseUrl,
        basePath
      );
      return c.html(html);
    } catch {
      return c.notFound();
    }
  });

  // Serve static files from public directory (production mode)
  setupPublicRoutes(app, true);

  // Setup favicon at server root (production mode). Register on the outer
  // app so browsers' implicit `GET /favicon.ico` always resolves — even
  // when `basePath` is set and the inner app only handles prefixed
  // requests. Falls back to the inner app when no outer is supplied.
  const faviconHost = (serverConfig as any).rootApp ?? app;
  setupFaviconRoute(faviconHost, serverConfig.favicon, true);
}
