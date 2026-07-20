import type { Context, Hono } from "hono";
import { resolveInspectorAssetUrls, type InspectorMode } from "./asset-urls.js";
import { renderInspectorFaviconLinks } from "./favicon-links.js";
import { registerInspectorFaviconStatic } from "./favicon-static.js";
import { registerInspectorStaticAssets } from "./static-assets.js";
import { getInspectorVersion } from "./version.js";

const INSPECTOR_VERSION = getInspectorVersion();
const INSPECTOR_VERSION_RESOLVER_URL =
  "https://data.jsdelivr.com/v1/packages/npm/@mcp-use/inspector/resolved?specifier=beta";
const INSPECTOR_CDN_PACKAGE_URL =
  "https://cdn.jsdelivr.net/npm/@mcp-use/inspector";

export type { InspectorMode } from "./asset-urls.js";

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

function renderDefaultInspectorAssetLoader(): string {
  return `<script type="module">
      const resolverUrl = ${JSON.stringify(INSPECTOR_VERSION_RESOLVER_URL)};
      const packageUrl = ${JSON.stringify(INSPECTOR_CDN_PACKAGE_URL)};
      const versionPattern = /^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$/;

      try {
        const response = await fetch(resolverUrl);
        if (!response.ok) {
          throw new Error(\`Inspector version resolver returned HTTP \${response.status}\`);
        }

        const resolved = await response.json();
        if (
          resolved?.name !== "@mcp-use/inspector" ||
          typeof resolved.version !== "string" ||
          !versionPattern.test(resolved.version)
        ) {
          throw new Error("Inspector version resolver returned an invalid release");
        }

        const version = resolved.version;
        const assetBase = \`\${packageUrl}@\${version}/dist/cdn\`;
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = \`\${assetBase}/inspector.css\`;
        document.head.append(stylesheet);

        window.__INSPECTOR_VERSION__ = version;
        await import(\`\${assetBase}/inspector.js\`);
      } catch (error) {
        console.error("[Inspector] Failed to load the latest Inspector release:", error);
        document.querySelector(".mcp-boot-spinner")?.remove();
        const label = document.querySelector(".mcp-boot-label");
        if (label) {
          label.textContent = "Unable to load Inspector. Reload to try again.";
        }
      }
    </script>`;
}

function generateCdnShellHtml(
  config: CdnShellConfig | undefined,
  basePath: string,
  assets: { jsUrl: string; cssUrl: string; resolveLatest: boolean }
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
  const runtimeScripts = scripts.join("\n    ");
  const assetPreconnects = assets.resolveLatest
    ? `    <link rel="preconnect" href="https://data.jsdelivr.com" crossorigin />
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />`
    : "";
  const stylesheetTag = assets.resolveLatest
    ? ""
    : `    <link rel="stylesheet" href="${assets.cssUrl}" />`;
  const assetLoader = assets.resolveLatest
    ? renderDefaultInspectorAssetLoader()
    : `<script type="module" src="${assets.jsUrl}"></script>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${renderInspectorFaviconLinks(basePath)}
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${assetPreconnects}
    <link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap" rel="stylesheet" />
${stylesheetTag}
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
    ${assetLoader}
  </body>
</html>`;
}

/**
 * Serve the inspector UI at `${basePath}/inspector`.
 */
export function registerInspectorCdnShell(
  app: Hono,
  config?: CdnShellConfig,
  basePath: string = ""
) {
  const assets = resolveInspectorAssetUrls(config?.inspectorMode, basePath);
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

  const serveShell = (c: Context) => {
    const assets = resolveInspectorAssetUrls(config?.inspectorMode, basePath);
    return c.html(generateCdnShellHtml(effectiveConfig, basePath, assets));
  };

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

  if (assets.useLocal) {
    registerInspectorStaticAssets(app, basePath);
  }
}
