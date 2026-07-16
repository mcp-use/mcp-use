import type { Context, Hono } from "hono";
import { renderInspectorFaviconLinks } from "./favicon-links.js";
import { registerInspectorFaviconStatic } from "./favicon-static.js";
import { getInspectorVersion } from "./version.js";

const INSPECTOR_VERSION = getInspectorVersion();

const CDN_BASE =
  process.env.INSPECTOR_CDN_BASE ?? "https://inspector-cdn.mcp-use.com";
const CDN_JS_URL = `${CDN_BASE}/inspector@${INSPECTOR_VERSION}.js`;
const CDN_CSS_URL = `${CDN_BASE}/inspector@${INSPECTOR_VERSION}.css`;

/** How the inspector is being served (telemetry + hosted UI behavior). */
export type InspectorMode = "standalone" | "embedded" | "cloud";

export type CdnShellConfig = {
  basePath?: string;
  devMode?: boolean;
  sandboxOrigin?: string | null;
  /** Relative proxy path, e.g. `/inspector/api/proxy`. `null` disables proxy in the client. */
  proxyUrl?: string | null;
  inspectorMode?: InspectorMode;
  manufactChatUrl?: string | null;
  disableTelemetry?: boolean;
};

const OAUTH_POPUP_CLOSED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signed in</title><meta name="robots" content="noindex"><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#4b5563;background:#fff}</style></head>
<body><div>Signed in. You can close this window.</div>
<script>try{if(window.opener&&!window.opener.closed)window.opener.postMessage({type:"manufact:oauth-complete"},"*")}catch(e){}try{window.close()}catch(e){}</script>
</body></html>`;

function generateCdnShellHtml(config?: CdnShellConfig, basePath = ""): string {
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
  const runtimeScripts = scripts.join("\n    ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${renderInspectorFaviconLinks(basePath)}
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="${CDN_CSS_URL}" />
    <title>Inspector | mcp-use</title>
    <meta name="description" content="Free, open-source MCP Inspector by mcp-use. Connect to any MCP server, test tools, prompts, and resources, inspect RPC logs, and debug MCP apps — all in your browser." />
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
 * Serve the inspector UI from CDN at `${basePath}/inspector`.
 */
export function registerInspectorCdnShell(
  app: Hono,
  config?: CdnShellConfig,
  basePath: string = ""
) {
  const p = (suffix: string) => `${basePath}${suffix}`;
  const effectiveConfig: CdnShellConfig = {
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

  const serveShell = (c: Context) =>
    c.html(generateCdnShellHtml(effectiveConfig, basePath));

  registerInspectorFaviconStatic(app, basePath);

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

  if (basePath === "") {
    app.get("/", (c) => {
      const url = new URL(c.req.url);
      return c.redirect(`${p("/inspector")}${url.search}`);
    });
  }
}
