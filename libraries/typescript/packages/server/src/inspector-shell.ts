/**
 * Inspector CDN shell — the FastAPI `/docs` analog.
 *
 * The server ships no inspector code: it serves a tiny self-contained HTML
 * page whose inline module loader resolves the current `@mcp-use/inspector`
 * beta and then loads that exact release's CDN bundle entry
 * (`dist/cdn/inspector.js`) plus lazy chunks. Runtime configuration crosses to
 * the bundle through a serialized `window` global; the connect URL is derived
 * in the browser from the page's own origin, so the server never guesses its
 * public hostname.
 */
import type { InspectorOptions } from "./config.js";
import { pathUnderBase, type FetchHandler } from "./fetch-app.js";

/**
 * npm dist-tag of the `@mcp-use/inspector` CDN bundle the default URL follows.
 *
 * Every new Inspector beta published with this tag becomes the default
 * inspector for mcp-use servers without requiring an mcp-use release.
 */
export const INSPECTOR_TAG = "beta";

/**
 * Legacy direct URL for the mutable `@mcp-use/inspector` beta-tag bundle.
 * Passing this URL through {@link InspectorOptions.assetsUrl} bypasses the
 * default loader that resolves the tag to one immutable release.
 *
 * @deprecated Leave `assetsUrl` undefined to resolve the latest beta safely,
 * or provide an exact-version or self-hosted URL as an explicit override.
 */
export const DEFAULT_INSPECTOR_ASSETS_URL = `https://cdn.jsdelivr.net/npm/@mcp-use/inspector@${INSPECTOR_TAG}/dist/cdn/inspector.js`;

const INSPECTOR_VERSION_RESOLVER_URL = `https://data.jsdelivr.com/v1/packages/npm/@mcp-use/inspector/resolved?specifier=${INSPECTOR_TAG}`;
const INSPECTOR_CDN_PACKAGE_URL =
  "https://cdn.jsdelivr.net/npm/@mcp-use/inspector";

/**
 * Derive the stylesheet URL that accompanies an inspector bundle URL.
 *
 * The CDN build ships as dist/cdn/inspector.js + dist/cdn/inspector.css
 * plus sibling lazy chunks referenced by the entry script. The stylesheet URL
 * is the script URL with its `.js` suffix swapped for `.css`. Query
 * strings and fragments are preserved.
 */
export function inspectorStylesUrl(assetsUrl: string): string {
  return assetsUrl.replace(/\.js(?=$|[?#])/, ".css");
}

/** True for inspector UI shell routes (SPA), excluding `/inspector/api/*`. */
export function matchesInspectorShellPath(
  pathname: string,
  basePath: string
): boolean {
  const prefix = pathUnderBase(basePath, "inspector");
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    return false;
  }
  const suffix = pathname.slice(prefix.length);
  return suffix !== "/api" && !suffix.startsWith("/api/");
}

/** Inputs for {@link renderInspectorShell}. */
export interface InspectorShellOptions {
  /** Server display name, used in the page title. */
  serverName: string;
  /** Route path the MCP endpoint is mounted on (e.g. `/mcp`). */
  basePath: string;
  /** Browser favicon URL, normally the server's root-level `/favicon.ico`. */
  faviconHref?: string | undefined;
  /** MIME type for the favicon link tag when known. */
  faviconType?: string | undefined;
  /**
   * Full replacement URL for the inspector bundle script. When omitted, the
   * shell resolves {@link INSPECTOR_TAG} to one exact release before loading.
   */
  assetsUrl?: string | undefined;
  /** Hosted managed-chat URL (`window.__MANUFACT_CHAT_URL__`). */
  manufactChatUrl?: string | undefined;
  /** Same-origin Inspector MCP relay path, or null when the relay is disabled. */
  proxyUrl?: string | null | undefined;
}

/** Escape a string for interpolation into HTML text or attribute values. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Serialize a value for interpolation inside an inline `<script>` body.
 *
 * `<` is escaped to its unicode JSON escape (backslash-u003c) so serialized
 * config can never form a `</script>` (or `<!--`) sequence and break out of
 * the script element.
 */
function serializeForInlineScript(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/** Render the default loader that resolves one immutable Inspector release. */
function renderDefaultInspectorAssetLoader(): string {
  return `<script type="module">
      const resolverUrl = ${serializeForInlineScript(INSPECTOR_VERSION_RESOLVER_URL)};
      const packageUrl = ${serializeForInlineScript(INSPECTOR_CDN_PACKAGE_URL)};
      const versionPattern = /^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$/;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        let response;
        try {
          response = await fetch(resolverUrl, { signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }
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

/**
 * Render the inspector shell page.
 *
 * A minimal shell document whose background matches the inspector UI
 * with a `#root` mount node pre-filled by a centered boot spinner so the
 * page is not blank while the CDN bundle downloads, an inline script
 * publishing `window.__MCP_USE_INSPECTOR__ = { autoConnectUrl, basePath }`
 * — where `autoConnectUrl` is computed client-side as
 * `window.location.origin + basePath` — and either a default inline loader
 * that resolves the latest beta to one immutable asset version or direct
 * stylesheet and module tags for a custom asset URL. All server-provided
 * values are HTML-escaped or JSON-serialized with `<` escaped, so config can't
 * inject markup.
 */
export function renderInspectorShell(options: InspectorShellOptions): string {
  const {
    serverName,
    basePath,
    faviconHref,
    faviconType,
    assetsUrl,
    manufactChatUrl,
    proxyUrl,
  } = options;
  const serializedBasePath = serializeForInlineScript(basePath);
  const serializedManufactChatUrl = manufactChatUrl
    ? serializeForInlineScript(manufactChatUrl)
    : null;
  const serializedProxyUrl =
    proxyUrl === undefined
      ? undefined
      : proxyUrl === null
        ? "null"
        : serializeForInlineScript(proxyUrl);
  const usesDefaultAssets = assetsUrl === undefined;
  const customScriptSrc =
    assetsUrl === undefined ? null : escapeHtml(assetsUrl);
  const customStylesHref =
    assetsUrl === undefined ? null : escapeHtml(inspectorStylesUrl(assetsUrl));
  const assetPreconnects = usesDefaultAssets
    ? `    <link rel="preconnect" href="https://data.jsdelivr.com" crossorigin />
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />`
    : "";
  const stylesheetTag =
    customStylesHref !== null
      ? `    <link rel="stylesheet" href="${customStylesHref}" />`
      : "";
  const assetLoader = usesDefaultAssets
    ? renderDefaultInspectorAssetLoader()
    : `<script type="module" src="${customScriptSrc}"></script>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serverName)} — MCP Inspector</title>
    ${faviconHref !== undefined ? `<link rel="icon"${faviconType !== undefined ? ` type="${escapeHtml(faviconType)}"` : ""} href="${escapeHtml(faviconHref)}" />` : ""}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${assetPreconnects}
    <link
      href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
${stylesheetTag}
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
  </head>
  <body>
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
    <script>
      (function () {
        var basePath = ${serializedBasePath};
        // The connect URL is derived from the page's own origin: the server
        // never guesses the hostname a browser reached it by.
        window.__MCP_USE_INSPECTOR__ = {
          autoConnectUrl: window.location.origin + basePath,
          basePath: basePath,
        };
        // Read by the current inspector bundle to derive its own URLs.
        window.__MCP_BASE_PATH__ = basePath;
        ${serializedProxyUrl !== undefined ? `window.__MCP_PROXY_URL__ = ${serializedProxyUrl};` : ""}
        ${process.env.MCP_USE_DEV_CLI === "1" ? "window.__MCP_DEV_CLI__ = true;" : ""}
        ${serializedManufactChatUrl ? `window.__MANUFACT_CHAT_URL__ = ${serializedManufactChatUrl};` : ""}
        // The bundle carries Node-flavored dependencies that touch \`process\`
        // at module scope; give them the same browser polyfill the v1
        // inspector shell provides, or the bundle throws on load.
        if (typeof window.process === "undefined") {
          window.process = {
            env: {},
            platform: "browser",
            browser: true,
            version: "v18.0.0",
            versions: { node: "18.0.0" },
            cwd: function () { return "/"; },
            nextTick: function (fn) {
              var args = Array.prototype.slice.call(arguments, 1);
              queueMicrotask(function () { fn.apply(null, args); });
            },
          };
        }
      })();
    </script>
    ${assetLoader}
  </body>
</html>
`;
}

/**
 * Fetch handler for `${basePath}/inspector` (GET and HEAD).
 *
 * No-op when `inspector.enabled` is `false`; `undefined` and `{}` mean enabled.
 *
 * @internal Wiring for `MCPServer`.
 */
export function createInspectorHandler(
  inspector: InspectorOptions | undefined,
  options: {
    serverName: string;
    basePath: string;
    faviconHref?: string;
    faviconType?: string;
    proxyUrl?: string | null;
  }
): FetchHandler | undefined {
  if (inspector?.enabled === false) {
    return undefined;
  }
  const { assetsUrl: configAssetsUrl, manufactChatUrl: configManufactChatUrl } =
    inspector ?? {};
  const assetsUrl =
    configAssetsUrl ?? process.env["MCP_USE_INSPECTOR_ASSETS_URL"] ?? undefined;
  const manufactChatUrl =
    configManufactChatUrl ?? process.env["MANUFACT_CHAT_URL"] ?? undefined;
  const shellOptions: InspectorShellOptions = {
    serverName: options.serverName,
    basePath: options.basePath,
    ...(options.faviconHref !== undefined && {
      faviconHref: options.faviconHref,
    }),
    ...(options.faviconType !== undefined && {
      faviconType: options.faviconType,
    }),
    assetsUrl,
    manufactChatUrl,
    ...(options.proxyUrl !== undefined && { proxyUrl: options.proxyUrl }),
  };

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const pathname = new URL(request.url).pathname;
    if (!matchesInspectorShellPath(pathname, options.basePath)) {
      return new Response("Not Found", { status: 404 });
    }
    const html = renderInspectorShell(shellOptions);
    return new Response(request.method === "HEAD" ? null : html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}

/**
 * @deprecated Use {@link createInspectorHandler}.
 *
 * @internal
 */
export function mountInspectorShell(): void {
  throw new Error(
    "mountInspectorShell(app) was removed — use createInspectorHandler"
  );
}
