import type { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkClientFiles,
  getClientDistPath,
  getContentType,
} from "./file-utils.js";
import { getInspectorVersion } from "./version.js";

// ---------------------------------------------------------------------------
// CDN mode (opt-in)
// Set INSPECTOR_USE_CDN=true to serve the inspector shell from CDN instead of
// local dist/web/ files. Defaults to false so existing tests and workflows are
// unaffected until the CDN is deployed and validated end-to-end.
// ---------------------------------------------------------------------------
const USE_CDN = process.env.INSPECTOR_USE_CDN === "true";

// Version is embedded at build time — works regardless of where cli.js is
// located in the installed package (avoids path-traversal bugs when bundled).
const INSPECTOR_VERSION = getInspectorVersion();

// Allow overriding the CDN base for local testing:
//   INSPECTOR_CDN_BASE=http://localhost:4000 INSPECTOR_USE_CDN=true node dist/server/server.js
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

/**
 * Inject runtime configuration scripts into the inspector HTML.
 * Used by both the CDN shell and the local file-serving path.
 */
function injectRuntimeConfig(html: string, config?: RuntimeConfig): string {
  if (!config) return html;

  const scripts: string[] = [];

  if (config.devMode) {
    scripts.push(`<script>window.__MCP_DEV_MODE__ = true;</script>`);
  }

  if (config.sandboxOrigin) {
    scripts.push(
      `<script>window.__MCP_SANDBOX_ORIGIN__ = ${JSON.stringify(config.sandboxOrigin)};</script>`
    );
  }

  if (scripts.length === 0) return html;

  const injection = scripts.join("\n    ");
  return html.replace("</head>", `    ${injection}\n  </head>`);
}

/**
 * Generate the minimal HTML shell that loads the inspector from CDN.
 *
 * The JS runs in the context of the serving origin so all /inspector/api/*
 * calls remain same-origin regardless of where the CDN script is hosted.
 */
function generateCdnShellHtml(config?: RuntimeConfig): string {
  const runtimeScripts = (() => {
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
  })();

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
    <script>window.__INSPECTOR_VERSION__ = ${JSON.stringify(INSPECTOR_VERSION)};</script>
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
 * Register routes that serve the inspector client.
 *
 * Default (INSPECTOR_USE_CDN unset or "false"): serves built files from
 * dist/web/ exactly as before.
 *
 * Opt-in (INSPECTOR_USE_CDN=true): serves a minimal inline HTML shell that
 * loads the inspector bundle from CDN. No local file reads at request time.
 */
export function registerStaticRoutes(
  app: Hono,
  clientDistPath?: string,
  runtimeConfig?: RuntimeConfig
) {
  if (USE_CDN) {
    const serveShell = (c: any) => c.html(generateCdnShellHtml(runtimeConfig));

    app.get("/", (c) => {
      const url = new URL(c.req.url);
      return c.redirect(`/inspector${url.search}`);
    });

    app.get("/inspector", serveShell);
    app.get("/inspector/*", serveShell);
    app.post("/inspector/*", serveShell);
    app.get("*", serveShell);
    return;
  }

  // -------------------------------------------------------------------------
  // Default: local dist/web/ file serving (original behavior)
  // -------------------------------------------------------------------------
  const distPath = clientDistPath || getClientDistPath();

  if (!checkClientFiles(distPath)) {
    console.warn(`⚠️  MCP Inspector client files not found at ${distPath}`);
    console.warn(
      `   Run 'yarn build' in the inspector package to build the UI`
    );

    app.get("*", (c) => {
      return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCP Inspector</title>
        </head>
        <body>
          <h1>MCP Inspector</h1>
          <p>Client files not found. Please run 'yarn build' to build the UI.</p>
        </body>
      </html>
    `);
    });
    return;
  }

  // Serve static assets from /inspector/assets/*
  app.get("/inspector/assets/*", (c) => {
    const path = c.req.path.replace("/inspector/assets/", "assets/");
    const fullPath = join(distPath, path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath);
      const contentType = getContentType(fullPath);
      c.header("Content-Type", contentType);
      return c.body(content);
    }
    return c.notFound();
  });

  // Redirect root to /inspector preserving query parameters
  app.get("/", (c) => {
    const url = new URL(c.req.url);
    const queryString = url.search;
    return c.redirect(`/inspector${queryString}`);
  });

  const serveIndex = (c: any) => {
    const indexPath = join(distPath, "index.html");
    if (existsSync(indexPath)) {
      const content = injectRuntimeConfig(
        readFileSync(indexPath, "utf-8"),
        runtimeConfig
      );
      return c.html(content);
    }
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCP Inspector</title>
        </head>
        <body>
          <h1>MCP Inspector</h1>
          <p>Client files not found. Please run 'yarn build' to build the UI.</p>
        </body>
      </html>
    `);
  };

  app.get("/inspector", serveIndex);
  app.get("/inspector/*", serveIndex);
  app.post("/inspector/*", serveIndex);

  app.get("*", (c) => {
    const indexPath = join(distPath, "index.html");
    if (existsSync(indexPath)) {
      const content = injectRuntimeConfig(
        readFileSync(indexPath, "utf-8"),
        runtimeConfig
      );
      return c.html(content);
    }
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCP Inspector</title>
        </head>
        <body>
          <h1>MCP Inspector</h1>
          <p>Client files not found. Please run 'yarn build' to build the UI.</p>
        </body>
      </html>
    `);
  });
}

/**
 * Register static routes with development mode proxy support.
 *
 * When VITE_DEV=true, proxies all non-API requests to the Vite dev server
 * at localhost:3000 for HMR during inspector development. Otherwise falls
 * back to registerStaticRoutes (local files or CDN depending on INSPECTOR_USE_CDN).
 */
export function registerStaticRoutesWithDevProxy(
  app: Hono,
  clientDistPath?: string
) {
  const distPath = clientDistPath || getClientDistPath();
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
          <head>
            <title>MCP Inspector - Development</title>
          </head>
          <body>
            <h1>MCP Inspector - Development Mode</h1>
            <p>Vite dev server is not running. Please start it with:</p>
            <pre>yarn dev:client</pre>
            </body>
        </html>
      `);
    });
  } else {
    registerStaticRoutes(app, distPath);
  }
}
