import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the package root directory
function getPackageRoot(): string {
  // When running from built files, we're in dist/server or dist/
  // We need to find the dist directory
  const currentDir = __dirname;

  // If we're in dist/server, go up to dist
  if (
    currentDir.endsWith("dist/server") ||
    currentDir.endsWith("dist\\server")
  ) {
    return path.resolve(currentDir, "..");
  }

  // If we're already in dist, use it
  if (currentDir.endsWith("dist") || currentDir.endsWith("dist/")) {
    return currentDir;
  }

  // Otherwise assume we're in dist
  return currentDir;
}

/**
 * Register static file serving routes
 */
export function registerStaticRoutes(app: Hono) {
  const isDev =
    process.env.NODE_ENV === "development" || process.env.VITE_DEV === "true";

  if (isDev) {
    // In dev mode, Vite dev server handles the client
    // API server only handles /api routes, no catch-all needed
    return;
  } else {
    // In production, serve built client files
    const packageRoot = getPackageRoot();
    const clientDir = path.join(packageRoot, "client");

    // Serve static assets
    app.use(
      "/*",
      serveStatic({
        root: clientDir,
      })
    );

    // SPA fallback - serve index.html for all non-API routes
    app.get("*", (c) => {
      try {
        const indexPath = path.join(clientDir, "index.html");
        const html = readFileSync(indexPath, "utf-8");
        return c.html(html);
      } catch (error) {
        console.error("Error serving index.html:", error);
        console.error("Client dir:", clientDir);
        console.error("Index path:", path.join(clientDir, "index.html"));
        return c.text("Error loading application", 500);
      }
    });
  }
}
