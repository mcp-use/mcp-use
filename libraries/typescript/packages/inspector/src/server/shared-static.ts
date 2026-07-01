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
 * Inspector deployment mode. Identifies how the inspector is being served so the
 * client can distinguish the three supported deployments.
 */
export type InspectorMode = "standalone" | "embedded" | "cloud";

/**
 * Runtime configuration injected into the inspector HTML at serve time.
 */
interface RuntimeConfig {
  /** Whether the server is running in development mode */
  devMode?: boolean;
  /** Override sandbox origin for MCP Apps widgets behind reverse proxies */
  sandboxOrigin?: string | null;
  /** Relative path to the MCP proxy (e.g. "/inspector/api/proxy"). Set null when the proxy is not available (e.g. Python server serving inspector). */
  proxyUrl?: string | null;
  /** How the inspector is being served (standalone CLI, embedded in mcp-use, or cloud-hosted). Consumed by telemetry. */
  inspectorMode?: InspectorMode;
  /**
   * Full URL of the Manufact hosted chat stream endpoint
   * (e.g. `https://manufact.com/api/v1/inspector/chat/stream`). When set, the
   * client switches the Chat tab to hosted mode: uses this endpoint with
   * `credentials: "include"` and shows the free-tier banner / login modal.
   *
   * Prefer this over the build-time `VITE_MANUFACT_CHAT_URL` so a single
   * pre-built npm tarball can be configured at deploy time.
   */
  manufactChatUrl?: string | null;
  /**
   * Disable anonymized telemetry across the inspector and any `useMcp` hooks
   * it instantiates. Auto-populated from `MCP_USE_ANONYMIZED_TELEMETRY=false`
   * on the serving process; the value is forwarded to the browser so the
   * client-side posthog-js init in `mcp-use/react` can be skipped before any
   * network calls are made.
   */
  disableTelemetry?: boolean;
  /**
   * Server-wide path prefix the whole framework surface is mounted under
   * (default `/mcp`; `""` = root). Injected as `window.__MCP_BASE_PATH__` so
   * the inspector client can derive its own URL and the relocated MCP
   * transport/proxy addresses from a single source.
   */
  basePath?: string;
}

/**
 * Rewrite the inspector's absolute asset references so they resolve under the
 * server-wide `basePath`.
 *
 * `@mcp-use/inspector` is a prebuilt bundle: its Vite `base` bakes
 * `/inspector/assets/...` into `index.html` at INSPECTOR-build time, but the
 * consuming server only knows its `basePath` at runtime. When embedded under a
 * non-empty basePath (e.g. `/mcp` or `/app`) the document is served at
 * `${basePath}/inspector`, so the baked `/inspector/assets/...` URLs would miss
 * the static route registered at `${basePath}/inspector/assets/*`. Rewriting at
 * serve time (mirroring the widget `processWidgetHtml` pattern) keeps the
 * prebuilt bundle untouched and applies basePath purely on the way out.
 *
 * No-op when root-mounted (`basePath === ""`): the baked `/inspector/...` paths
 * already match the root-registered routes.
 */
function rewriteAssetPaths(html: string, basePath: string): string {
  if (!basePath) return html;
  // Only the local asset references Vite emits are root-relative
  // `/inspector/assets/...`; favicons and fonts are absolute CDN/Google URLs
  // and must be left untouched. Pin the match to `"/inspector/assets/` (with
  // the opening attribute quote) so unrelated strings aren't rewritten.
  return html.replace(
    /(["'(])\/inspector\/assets\//g,
    `$1${basePath}/inspector/assets/`
  );
}

/**
 * Inject runtime configuration scripts into the inspector HTML.
 * Used by both the CDN shell and the local file-serving path.
 */
function injectRuntimeConfig(html: string, config?: RuntimeConfig): string {
  if (!config) return html;

  const scripts: string[] = [];

  if (config.basePath !== undefined) {
    scripts.push(
      `<script>window.__MCP_BASE_PATH__ = ${JSON.stringify(config.basePath)};</script>`
    );
  }

  if (config.devMode) {
    scripts.push(`<script>window.__MCP_DEV_MODE__ = true;</script>`);
  }

  if (config.sandboxOrigin) {
    scripts.push(
      `<script>window.__MCP_SANDBOX_ORIGIN__ = ${JSON.stringify(config.sandboxOrigin)};</script>`
    );
  }

  if (config.proxyUrl !== undefined) {
    scripts.push(
      `<script>window.__MCP_PROXY_URL__ = ${JSON.stringify(config.proxyUrl)};</script>`
    );
  }

  if (config.inspectorMode) {
    scripts.push(
      `<script>window.__MCP_INSPECTOR_MODE__ = ${JSON.stringify(config.inspectorMode)};</script>`
    );
  }

  if (config.manufactChatUrl) {
    scripts.push(
      `<script>window.__MANUFACT_CHAT_URL__ = ${JSON.stringify(config.manufactChatUrl)};</script>`
    );
  }

  if (config.disableTelemetry) {
    scripts.push(
      `<script>window.__MCP_USE_ANONYMIZED_TELEMETRY__ = false;</script>`
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
    if (config.basePath !== undefined) {
      scripts.push(
        `<script>window.__MCP_BASE_PATH__ = ${JSON.stringify(config.basePath)};</script>`
      );
    }
    if (config.devMode) {
      scripts.push(`<script>window.__MCP_DEV_MODE__ = true;</script>`);
    }
    if (config.sandboxOrigin) {
      scripts.push(
        `<script>window.__MCP_SANDBOX_ORIGIN__ = ${JSON.stringify(config.sandboxOrigin)};</script>`
      );
    }
    if (config.proxyUrl !== undefined) {
      scripts.push(
        `<script>window.__MCP_PROXY_URL__ = ${JSON.stringify(config.proxyUrl)};</script>`
      );
    }
    if (config.inspectorMode) {
      scripts.push(
        `<script>window.__MCP_INSPECTOR_MODE__ = ${JSON.stringify(config.inspectorMode)};</script>`
      );
    }
    if (config.manufactChatUrl) {
      scripts.push(
        `<script>window.__MANUFACT_CHAT_URL__ = ${JSON.stringify(config.manufactChatUrl)};</script>`
      );
    }
    if (config.disableTelemetry) {
      scripts.push(
        `<script>window.__MCP_USE_ANONYMIZED_TELEMETRY__ = false;try{localStorage.setItem("MCP_USE_ANONYMIZED_TELEMETRY","false");}catch(e){}</script>`
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
    <meta
      name="description"
      content="Free, open-source MCP Inspector by mcp-use. Connect to any MCP server, test tools, prompts, and resources, inspect RPC logs, and debug MCP apps — all in your browser."
    />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="mcp-use" />
    <meta property="og:url" content="https://inspector.mcp-use.com" />
    <meta property="og:title" content="MCP Inspector — Test &amp; Debug MCP Servers | mcp-use" />
    <meta
      property="og:description"
      content="Free, open-source MCP Inspector by mcp-use. Connect to any MCP server, test tools, prompts, and resources, inspect RPC logs, and debug MCP apps — all in your browser."
    />
    <meta
      property="og:image"
      content="https://inspector-cdn.mcp-use.com/inspector-cover.png"
    />
    <meta property="og:image:alt" content="mcp-use MCP Inspector — test and debug MCP servers" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@mcpuse" />
    <meta name="twitter:creator" content="@mcpuse" />
    <meta name="twitter:title" content="MCP Inspector — Test &amp; Debug MCP Servers | mcp-use" />
    <meta
      name="twitter:description"
      content="Free, open-source MCP Inspector by mcp-use. Connect to any MCP server, test tools, prompts, and resources, inspect RPC logs, and debug MCP apps — all in your browser."
    />
    <meta
      name="twitter:image"
      content="https://inspector-cdn.mcp-use.com/inspector-cover.png"
    />
    <meta name="twitter:image:alt" content="mcp-use MCP Inspector — test and debug MCP servers" />
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
  runtimeConfig?: RuntimeConfig,
  basePath: string = ""
) {
  // All inspector static routes relocate under the server-wide basePath.
  const p = (suffix: string) => `${basePath}${suffix}`;
  // When the inspector's own server serves, the proxy is always available.
  // Default proxyUrl (basePath-aware) so the client can use it; callers may
  // override with null to disable.
  // disableTelemetry is auto-populated from MCP_USE_ANONYMIZED_TELEMETRY=false so
  // setting that single env var disables both the inspector's own telemetry and
  // the in-browser posthog-js init triggered by `useMcp` hooks rendered inside.
  const effectiveConfig: RuntimeConfig = {
    ...runtimeConfig,
    basePath: runtimeConfig?.basePath ?? basePath,
    proxyUrl:
      runtimeConfig?.proxyUrl !== undefined
        ? runtimeConfig.proxyUrl
        : p("/inspector/api/proxy"),
    disableTelemetry:
      runtimeConfig?.disableTelemetry ??
      process.env.MCP_USE_ANONYMIZED_TELEMETRY === "false",
  };

  if (USE_CDN) {
    const serveShell = (c: any) =>
      c.html(generateCdnShellHtml(effectiveConfig));

    app.get(p("/inspector"), serveShell);
    app.get(p("/inspector/*"), serveShell);
    app.post(p("/inspector/*"), serveShell);

    // Root redirect + SPA catch-all only when root-mounted (basePath ""). When
    // embedded under a basePath the host owns `/` and its transport owns
    // `${basePath}`, so the inspector must NOT register anything at root — that
    // would shadow the host and answer at a stray root `/inspector`.
    if (basePath === "") {
      app.get("/", (c) => {
        const url = new URL(c.req.url);
        return c.redirect(`${p("/inspector")}${url.search}`);
      });
      app.get("*", serveShell);
    }
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

    const notFoundPage = (c: any) =>
      c.html(`
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

    // Scope the "not built" page to the inspector's own prefix so it doesn't
    // shadow the host under a non-empty basePath. A root catch-all is added
    // only when root-mounted.
    app.get(p("/inspector"), notFoundPage);
    app.get(p("/inspector/*"), notFoundPage);
    if (basePath === "") {
      app.get("*", notFoundPage);
    }
    return;
  }

  // Serve static assets from ${basePath}/inspector/assets/*
  app.get(p("/inspector/assets/*"), (c) => {
    const path = c.req.path.replace(p("/inspector/assets/"), "assets/");
    const fullPath = join(distPath, path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath);
      const contentType = getContentType(fullPath);
      c.header("Content-Type", contentType);
      return c.body(content);
    }
    return c.notFound();
  });

  // Redirect root to /inspector — ONLY when root-mounted (basePath ""). When
  // embedded under a basePath the host owns `/` (and its transport owns
  // `${basePath}`), so the inspector must not register a root route.
  if (basePath === "") {
    app.get("/", (c) => {
      const url = new URL(c.req.url);
      const queryString = url.search;
      return c.redirect(`${p("/inspector")}${queryString}`);
    });
  }

  const serveIndex = (c: any) => {
    const indexPath = join(distPath, "index.html");
    if (existsSync(indexPath)) {
      // Rewrite baked `/inspector/assets/...` refs under basePath BEFORE
      // injecting runtime config so the served document loads its JS/CSS from
      // the basePath-prefixed static route.
      const html = rewriteAssetPaths(
        readFileSync(indexPath, "utf-8"),
        basePath
      );
      const content = injectRuntimeConfig(html, effectiveConfig);
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

  // The inspector SPA is reachable ONLY under `${basePath}/inspector`. The
  // `/inspector/*` glob is the client-side-routing (React Router) fallback so
  // deep links like `${basePath}/inspector/preview/:view` serve index.html.
  app.get(p("/inspector"), serveIndex);
  app.get(p("/inspector/*"), serveIndex);
  app.post(p("/inspector/*"), serveIndex);

  // Root SPA catch-all is ONLY registered when root-mounted (basePath ""), so a
  // non-empty basePath never answers at root `/inspector` (which would break
  // sub-mounted deployments, e.g. Next.js mounting mcp-use at `/api/mcp/*`, and
  // mask the host's own transport). When basePath is set, unmatched GETs fall
  // through to the host app instead of being shadowed by the inspector shell.
  if (basePath === "") {
    app.get("*", (c) => {
      const indexPath = join(distPath, "index.html");
      if (existsSync(indexPath)) {
        const html = rewriteAssetPaths(
          readFileSync(indexPath, "utf-8"),
          basePath
        );
        const content = injectRuntimeConfig(html, effectiveConfig);
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
  clientDistPath?: string,
  runtimeConfig?: RuntimeConfig
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
    registerStaticRoutes(app, distPath, runtimeConfig);
  }
}
