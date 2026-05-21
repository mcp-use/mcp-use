/**
 * Static widget route handlers
 *
 * In production, `/_mcp-use/*` is a pure static-file namespace mapped to
 * `.mcp-use/` on disk — Next.js-style. Built HTML already contains the
 * runtime globals it needs (baked in by the CLI's `buildWidgets`), so the
 * framework just ships bytes.
 */

import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Hono as HonoType } from "hono";
import { fsHelpers, getCwd, isDeno, pathHelpers } from "../utils/runtime.js";
import { getContentType, setupFaviconRoute } from "./widget-helpers.js";
import type { ServerConfig } from "./widget-types.js";

/**
 * Mount static routes for `/_mcp-use/*` on the root Hono app.
 *
 * Node + Bun: one `serveStatic` mount handles widgets, assets, and public
 * files in a single middleware. Deno can't use `@hono/node-server`, so it
 * falls back to hand-rolled handlers that go through the `fsHelpers`
 * cross-runtime shim.
 *
 * Favicon is registered separately at `/favicon.ico` because it lives
 * outside the `/_mcp-use/` namespace and needs an explicit Cache-Control
 * header that `serveStatic` doesn't add by default.
 *
 * @param rootApp - Underlying Hono instance. `/_mcp-use/*` always mounts at
 *   the host root, so it bypasses any `basePath` prefix.
 * @param serverConfig - Server configuration.
 */
export function setupWidgetRoutes(
  rootApp: HonoType,
  serverConfig: ServerConfig
): void {
  if (isDeno) {
    setupWidgetRoutesDeno(rootApp);
  } else {
    rootApp.get(
      "/_mcp-use/*",
      serveStatic({
        root: "./.mcp-use",
        rewriteRequestPath: (p) => p.replace(/^\/_mcp-use/, ""),
      })
    );
  }

  setupFaviconRoute(rootApp, serverConfig.favicon, true);
}

/**
 * Deno fallback — three small handlers backed by `fsHelpers.readFile`.
 * Kept separate so the Node/Bun path stays a one-liner.
 */
function setupWidgetRoutesDeno(rootApp: HonoType): void {
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

  rootApp.get("/_mcp-use/widgets/:widget", async (c) => {
    const widget = c.req.param("widget")!;
    return serveDenoFile(c, ["widgets", widget, "index.html"]);
  });

  rootApp.get("/_mcp-use/widgets/:widget/assets/*", async (c) => {
    const widget = c.req.param("widget")!;
    const assetFile = c.req.path.split("/assets/")[1] ?? "";
    return serveDenoFile(c, ["widgets", widget, "assets", assetFile]);
  });

  rootApp.get("/_mcp-use/public/*", async (c) => {
    const filePath = c.req.path.split("/_mcp-use/public/")[1] ?? "";
    return serveDenoFile(c, ["public", filePath]);
  });
}
