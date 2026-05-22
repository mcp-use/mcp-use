/**
 * Static widget route handlers
 *
 * In production, `${basePath}/_mcp-use/*` is a pure static-file namespace
 * mapped to `.mcp-use/` on disk — Next.js-style. Built HTML already contains
 * the runtime globals it needs (baked in by the CLI's `buildWidgets`), so
 * the framework just ships bytes.
 */

import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Hono as HonoType } from "hono";
import { fsHelpers, getCwd, isDeno, pathHelpers } from "../utils/runtime.js";
import { getContentType, setupFaviconRoute } from "./widget-helpers.js";
import type { ServerConfig } from "./widget-types.js";

/**
 * Mount static routes for `${basePath}/_mcp-use/*` on the basePath-aware app.
 *
 * Node + Bun: one `serveStatic` mount handles widgets, assets, and public
 * files in a single middleware. Deno can't use `@hono/node-server`, so it
 * falls back to hand-rolled handlers that go through the `fsHelpers`
 * cross-runtime shim.
 *
 * Favicon is registered separately at `/favicon.ico` (basePath-prefixed
 * to `${basePath}/favicon.ico`) because it needs an explicit Cache-Control
 * header that `serveStatic` doesn't add by default.
 *
 * @param app - basePath-aware Hono view. The `/_mcp-use/*` route below is
 *   auto-prefixed to `${basePath}/_mcp-use/*`.
 * @param serverConfig - Server configuration.
 * @param basePath - Server basePath prefix (e.g. `/api`). Used by the
 *   serveStatic rewriter to strip the prefix before mapping to disk paths.
 */
export function setupWidgetRoutes(
  app: HonoType,
  serverConfig: ServerConfig,
  basePath: string = ""
): void {
  if (isDeno) {
    setupWidgetRoutesDeno(app);
  } else {
    app.get(
      "/_mcp-use/*",
      serveStatic({
        root: "./.mcp-use",
        // Strip both the basePath prefix and the `/_mcp-use` namespace to
        // get a path relative to `./.mcp-use/` on disk. Works whether or not
        // basePath is set.
        rewriteRequestPath: (p) =>
          p.replace(new RegExp(`^${escapeRegex(basePath)}/_mcp-use`), ""),
      })
    );
  }

  setupFaviconRoute(app, serverConfig.favicon, true);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deno fallback — three small handlers backed by `fsHelpers.readFile`.
 * Kept separate so the Node/Bun path stays a one-liner.
 *
 * The handlers slice `c.req.path` on the `/_mcp-use/...` segment instead of
 * matching from the start, so they work regardless of basePath.
 */
function setupWidgetRoutesDeno(app: HonoType): void {
  const serveDenoFile = async (
    c: Context,
    segments: string[]
  ): Promise<Response> => {
    const fullPath = pathHelpers.join(getCwd(), ".mcp-use", ...segments);
    try {
      const content = await fsHelpers.readFile(fullPath);
      return new Response(content, {
        status: 200,
        headers: { "Content-Type": getContentType(segments.at(-1) ?? "") },
      });
    } catch {
      return c.notFound();
    }
  };

  app.get("/_mcp-use/widgets/:widget", async (c) => {
    const widget = c.req.param("widget")!;
    return serveDenoFile(c, ["widgets", widget, "index.html"]);
  });

  app.get("/_mcp-use/widgets/:widget/assets/*", async (c) => {
    const widget = c.req.param("widget")!;
    const assetFile = c.req.path.split("/assets/")[1] ?? "";
    return serveDenoFile(c, ["widgets", widget, "assets", assetFile]);
  });

  app.get("/_mcp-use/public/*", async (c) => {
    const filePath = c.req.path.split("/_mcp-use/public/")[1] ?? "";
    return serveDenoFile(c, ["public", filePath]);
  });
}
