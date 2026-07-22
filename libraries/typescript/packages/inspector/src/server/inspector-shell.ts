import type { Context, Hono } from "hono";
import { renderInspectorFaviconLinks } from "./favicon-links.js";
import { registerInspectorStaticAssets } from "./static-assets.js";
import { getInspectorVersion } from "./version.js";

const INSPECTOR_VERSION = getInspectorVersion();
type InspectorMode = "standalone" | "embedded" | "cloud";

type InspectorShellConfig = {
  basePath?: string;
  devMode?: boolean;
  sandboxOrigin?: string | null;
  /** Relative proxy path, e.g. `/inspector/api/proxy`. `null` disables proxy in the client. */
  proxyUrl?: string | null;
  inspectorMode?: InspectorMode;
  manufactChatUrl?: string | null;
  disableTelemetry?: boolean;
  /** Preserve the standalone CLI's `/` to `/inspector` redirect (default true). */
  rootRedirect?: boolean;
};

const OAUTH_POPUP_CLOSED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signed in</title><meta name="robots" content="noindex"><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#4b5563;background:#fff}</style></head>
<body><div>Signed in. You can close this window.</div>
<script>try{if(window.opener&&!window.opener.closed)window.opener.postMessage({type:"manufact:oauth-complete"},"*")}catch(e){}try{window.close()}catch(e){}</script>
</body></html>`;

function generateInspectorShellHtml(
  config: InspectorShellConfig | undefined,
  basePath: string,
  assets: { jsUrl: string; cssUrl: string }
): string {
  const scripts: string[] = [];
  if (config?.basePath !== undefined) {
    scripts.push(
      `<script>window.__MCP_BASE_PATH__ = ${JSON.stringify(config.basePath)};</script>`
    );
  }
  if (config?.devMode) {
    scripts.push(`<script>window.__MCP_DEV_MODE__ = true;</script>`);
  }
  if (config?.sandboxOrigin) {
    scripts.push(
      `<script>window.__MCP_SANDBOX_ORIGIN__ = ${JSON.stringify(config.sandboxOrigin)};</script>`
    );
  }
  if (config?.proxyUrl !== undefined) {
    scripts.push(
      `<script>window.__MCP_PROXY_URL__ = ${JSON.stringify(config.proxyUrl)};</script>`
    );
  }
  if (config?.inspectorMode) {
    scripts.push(
      `<script>window.__MCP_INSPECTOR_MODE__ = ${JSON.stringify(config.inspectorMode)};</script>`
    );
  }
  if (config?.manufactChatUrl) {
    scripts.push(
      `<script>window.__MANUFACT_CHAT_URL__ = ${JSON.stringify(config.manufactChatUrl)};</script>`
    );
  }
  if (config?.disableTelemetry) {
    scripts.push(
      `<script>window.__MCP_USE_ANONYMIZED_TELEMETRY__ = false;try{localStorage.setItem("MCP_USE_ANONYMIZED_TELEMETRY","false");}catch(e){}</script>`
    );
  }
  if (process.env.MCP_USE_DEV_CLI === "1") {
    scripts.push(`<script>window.__MCP_DEV_CLI__ = true;</script>`);
  }
  const runtimeScripts = scripts.join("\n    ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${renderInspectorFaviconLinks(`${basePath}/inspector/assets`)}
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="${assets.cssUrl}" />
    <title>Inspector | mcp-use</title>
    <meta name="description" content="Free, open-source MCP Inspector by mcp-use. Connect to any MCP server, test tools, prompts, and resources, inspect RPC logs, and debug MCP apps — all in your browser." />
    <style>
      :root { color-scheme: light dark; }
      html, body { height: 100%; margin: 0; background-color: #f3f3f3; }
      #root { height: 100%; }
      .mcp-boot {
        display: flex;
        height: 100%;
        align-items: center;
        justify-content: center;
        background-color: #f3f3f3;
      }
      .mcp-boot-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }
      .mcp-boot-spinner {
        width: 32px;
        height: 32px;
        color: #52525b;
        animation: mcp-boot-spin 1s linear infinite;
      }
      .mcp-boot-label {
        margin: 0;
        font-family: Ubuntu, sans-serif;
        font-size: 0.875rem;
        line-height: 1.25rem;
        color: #52525b;
      }
      @keyframes mcp-boot-spin {
        to { transform: rotate(360deg); }
      }
      @media (prefers-color-scheme: dark) {
        html, body { background-color: #000; }
        .mcp-boot { background-color: #000; }
        .mcp-boot-spinner, .mcp-boot-label { color: #a1a1aa; }
      }
    </style>
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
    <div id="root">
      <div class="mcp-boot">
        <div class="mcp-boot-inner">
          <svg
            class="mcp-boot-spinner"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            role="status"
            aria-label="Loading"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <p class="mcp-boot-label">Connecting to MCP server...</p>
        </div>
      </div>
    </div>
    <script type="module" src="${assets.jsUrl}"></script>
  </body>
</html>`;
}

/**
 * Serve the inspector UI at `${basePath}/inspector`.
 */
export function registerInspectorShell(
  app: Hono,
  config?: InspectorShellConfig,
  basePath: string = ""
) {
  const assetsPath = `${basePath}/inspector/assets`;
  const version = encodeURIComponent(INSPECTOR_VERSION);
  const assets = {
    jsUrl: `${assetsPath}/inspector.js?v=${version}`,
    cssUrl: `${assetsPath}/inspector.css?v=${version}`,
  };
  const p = (suffix: string) => `${basePath}${suffix}`;
  const effectiveConfig: InspectorShellConfig = {
    ...config,
    basePath: config?.basePath ?? basePath,
    proxyUrl:
      config?.proxyUrl !== undefined
        ? config.proxyUrl
        : p("/inspector/api/proxy"),
    disableTelemetry:
      config?.disableTelemetry ??
      process.env.MCP_USE_ANONYMIZED_TELEMETRY === "false",
  };

  const serveShell = (c: Context) => {
    return c.html(
      generateInspectorShellHtml(effectiveConfig, basePath, assets)
    );
  };

  // Scoped local assets must be registered before the Inspector SPA fallback,
  // otherwise `/inspector/assets/*` would be answered with the HTML shell.
  registerInspectorStaticAssets(app, assetsPath);

  app.get(p("/inspector/oauth-popup-closed.html"), (c) =>
    c.html(OAUTH_POPUP_CLOSED_HTML)
  );
  app.get(p("/inspector"), serveShell);
  app.get(`${p("/inspector")}/`, serveShell);

  const apiPrefix = p("/inspector/api/");
  app.get(p("/inspector/*"), (c) => {
    if (c.req.path.startsWith(apiPrefix)) {
      return c.notFound();
    }
    return serveShell(c);
  });
  app.post(p("/inspector/*"), (c) => {
    if (c.req.path.startsWith(apiPrefix)) {
      return c.notFound();
    }
    return serveShell(c);
  });

  if (basePath === "" && config?.rootRedirect !== false) {
    app.get("/", (c) => {
      const url = new URL(c.req.url);
      return c.redirect(`${p("/inspector")}${url.search}`);
    });
  }
}
