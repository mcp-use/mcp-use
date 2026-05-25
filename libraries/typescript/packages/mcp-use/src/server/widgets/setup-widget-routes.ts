/**
 * Static widget route handlers
 *
 * In production, `${basePath}/_mcp-use/*` is a pure static-file namespace
 * mapped to `.mcp-use/` on disk — Next.js-style. Built HTML already contains
 * the runtime globals it needs (baked in by the CLI's `buildWidgets`), so
 * the framework just ships bytes.
 */

import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono as HonoType, MiddlewareHandler } from "hono";
import { isDeno } from "../utils/runtime.js";
import { setupFaviconRoute } from "./widget-helpers.js";
import type { ServerConfig } from "./widget-types.js";

/**
 * Mount static routes for `${basePath}/_mcp-use/*` on the basePath-aware app.
 *
 * Node + Bun: one `serveStatic` mount handles widgets, assets, and public
 * files in a single middleware. Deno can't use `@hono/node-server`, so it
 * uses `hono/deno`'s `serveStatic` with the same mount config.
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
    setupWidgetRoutesDeno(app, basePath);
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
 * Deno fallback — mirrors the Node/Bun mount above using `hono/deno`'s
 * `serveStatic`. The import is lazy because `hono/deno` reads `Deno.open` and
 * `Deno.lstatSync` at module load, which would crash in Node.
 */
function setupWidgetRoutesDeno(app: HonoType, basePath: string): void {
  let middleware: MiddlewareHandler | null = null;
  app.get("/_mcp-use/*", async (c, next) => {
    if (!middleware) {
      const { serveStatic: denoServeStatic } = await import("hono/deno");
      middleware = denoServeStatic({
        root: "./.mcp-use",
        rewriteRequestPath: (p) =>
          p.replace(new RegExp(`^${escapeRegex(basePath)}/_mcp-use`), ""),
      });
    }
    return middleware(c, next);
  });
}
