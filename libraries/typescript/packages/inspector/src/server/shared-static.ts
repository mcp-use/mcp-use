import type { Hono } from "hono";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version once at module load — dist/server/../../package.json resolves to
// the inspector package root.
const { version: INSPECTOR_VERSION } = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8")
) as { version: string };

// Allow overriding the CDN base for local development/testing:
//   INSPECTOR_CDN_BASE=http://localhost:4000 node dist/server/server.js
const CDN_BASE =
  process.env.INSPECTOR_CDN_BASE ?? "https://inspector-cdn.mcp-use.com";
const CDN_JS_URL = `${CDN_BASE}/inspector@${INSPECTOR_VERSION}.js`;
const CDN_CSS_URL = `${CDN_BASE}/inspector@${INSPECTOR_VERSION}.css`;

/**
 * Runtime configuration injected into the inspector HTML at serve time.
 */
interface RuntimeConfig {
  /** Whether the server is running in development mode */
  devMode?: boolean;
  /** Override sandbox origin for MCP Apps widgets behind reverse proxies */
  sandboxOrigin?: string | null;
}

function buildRuntimeScripts(config?: RuntimeConfig): string {
  if (!config) return "";
  const scripts: string[] = [];
  if (config.devMode) {
    scripts.push(`<script>window.__MCP_DEV_MODE__ = true;</script>`);
  }
  if (config.sandboxOrigin) {
    scripts.push(
      `<script>window.__MCP_SANDBOX_ORIGIN__ = ${JSON.stringify(config.sandboxOrigin)};</script>`
    );
  }
  return scripts.join("\n    ");
}

/**
 * Generate the minimal HTML shell that loads the inspector from CDN.
 *
 * The JS runs in the context of the serving origin so all /inspector/api/*
 * calls remain same-origin regardless of where the CDN script is hosted.
 */
function generateShellHtml(config?: RuntimeConfig): string {
  const runtimeScripts = buildRuntimeScripts(config);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link
      rel="icon"
      type="image/svg+xml"
      href="${CDN_BASE}/favicon-black.svg"
    />
    <link
      rel="icon"
      type="image/svg+xml"
      href="${CDN_BASE}/favicon-white.svg"
      media="(prefers-color-scheme: dark)"
    />
    <link
      rel="icon"
      type="image/svg+xml"
      href="${CDN_BASE}/favicon-black.svg"
      media="(prefers-color-scheme: light)"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="${CDN_CSS_URL}" />
    <title>Inspector | mcp-use</title>
    ${runtimeScripts}
  </head>
  <body>
    <script>
      if (typeof window !== "undefined" && typeof window.process === "undefined") {
        window.process = {
          env: {},
          platform: "browser",
          browser: true,
          version: "v18.0.0",
          versions: { node: "18.0.0" },
          cwd: () => "/",
          nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
        };
      }
    </script>
    <div id="root"></div>
    <script type="module" src="${CDN_JS_URL}"></script>
  </body>
</html>`;
}

/**
 * Register routes that serve the inspector HTML shell and handle SPA routing.
 *
 * The heavy client bundle is loaded from the CDN; no local static files are
 * read or served. API routes are registered separately by registerInspectorRoutes
 * and remain same-origin.
 *
 * The optional `clientDistPath` parameter is accepted for API compatibility but
 * is no longer used.
 */
export function registerStaticRoutes(
  app: Hono,
  _clientDistPath?: string,
  runtimeConfig?: RuntimeConfig
) {
  const serveShell = (c: any) => c.html(generateShellHtml(runtimeConfig));

  // Redirect root to /inspector preserving query parameters
  app.get("/", (c) => {
    const url = new URL(c.req.url);
    return c.redirect(`/inspector${url.search}`);
  });

  // Serve the shell for /inspector and all sub-routes (React Router handles client-side routing)
  app.get("/inspector", serveShell);
  app.get("/inspector/*", serveShell);
  // POST needed for OAuth flows
  app.post("/inspector/*", serveShell);

  // Final catch-all
  app.get("*", serveShell);
}

/**
 * Register static routes with development mode proxy support.
 *
 * When VITE_DEV=true, proxies all non-API requests to the Vite dev server
 * at localhost:3000 for HMR during inspector development. Otherwise falls
 * back to the CDN-based shell via registerStaticRoutes.
 */
export function registerStaticRoutesWithDevProxy(
  app: Hono,
  _clientDistPath?: string
) {
  const isDev =
    process.env.NODE_ENV === "development" || process.env.VITE_DEV === "true";

  if (isDev) {
    console.warn(
      "🔧 Development mode: Proxying client requests to Vite dev server"
    );

    app.get("*", async (c) => {
      const path = c.req.path;

      if (
        path.startsWith("/api/") ||
        path.startsWith("/inspector/api/") ||
        path === "/inspector/config.json"
      ) {
        return c.notFound();
      }

      try {
        const viteUrl = `http://localhost:3000${path}`;
        const response = await fetch(viteUrl, {
          signal: AbortSignal.timeout(1000),
        });

        if (response.ok) {
          const content = await response.text();
          const contentType =
            response.headers.get("content-type") || "text/html";
          c.header("Content-Type", contentType);
          return c.html(content);
        }
      } catch (error) {
        console.warn(`Failed to proxy to Vite dev server: ${error}`);
      }

      return c.html(`
        <!DOCTYPE html>
        <html>
          <head><title>MCP Inspector - Development</title></head>
          <body>
            <h1>MCP Inspector - Development Mode</h1>
            <p>Vite dev server is not running. Please start it with:</p>
            <pre>npm run dev:client</pre>
          </body>
        </html>
      `);
    });
  } else {
    registerStaticRoutes(app, _clientDistPath);
  }
}
