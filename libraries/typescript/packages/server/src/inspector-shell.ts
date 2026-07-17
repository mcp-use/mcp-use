/**
 * Inspector CDN shell — the FastAPI `/docs` analog.
 *
 * The server ships no inspector code: it serves a tiny self-contained HTML
 * page whose `<script type="module">` loads the `@mcp-use/inspector` CDN
 * bundle entry (`dist/cdn/inspector.js`) plus lazy chunks, pinned to a major
 * version so the UI updates independently of SDK releases. Runtime configuration crosses to
 * the bundle through a serialized `window` global; the connect URL is derived
 * in the browser from the page's own origin, so the server never guesses its
 * public hostname.
 */
import type { InspectorOptions } from "./config.js";
import type { FetchHandler } from "./fetch-app.js";

/**
 * npm dist-tag of the `@mcp-use/inspector` CDN bundle the default URL follows.
 *
 * Every new Inspector beta published with this tag becomes the default
 * inspector for mcp-use servers without requiring an mcp-use release.
 */
export const INSPECTOR_TAG = "beta";

/**
 * Default URL the inspector shell loads the UI bundle from: the
 * `@mcp-use/inspector` CDN build (`dist/cdn/inspector.js`) built from this
 * branch and served by jsDelivr from npm's {@link INSPECTOR_TAG} tag.
 * Override per server with {@link InspectorOptions.assetsUrl}.
 */
export const DEFAULT_INSPECTOR_ASSETS_URL = `https://cdn.jsdelivr.net/npm/@mcp-use/inspector@${INSPECTOR_TAG}/dist/cdn/inspector.js`;

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
  const prefix = `${basePath}/inspector`;
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
  /**
   * Full replacement URL for the inspector bundle script. Defaults to
   * {@link DEFAULT_INSPECTOR_ASSETS_URL}.
   */
  assetsUrl?: string | undefined;
  /** Hosted managed-chat URL (`window.__MANUFACT_CHAT_URL__`). */
  manufactChatUrl?: string | undefined;
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

/**
 * Render the inspector shell page.
 *
 * A minimal shell document whose background matches the inspector UI
 * with a `#root` mount node, an inline script publishing
 * `window.__MCP_USE_INSPECTOR__ = { autoConnectUrl, basePath }` — where
 * `autoConnectUrl` is computed client-side as
 * `window.location.origin + basePath` — a stylesheet link for the bundle's
 * companion CSS (see {@link inspectorStylesUrl}), and a module script
 * loading the inspector bundle. All server-provided values are HTML-escaped
 * or JSON-serialized with `<` escaped, so config can't inject markup.
 */
export function renderInspectorShell(options: InspectorShellOptions): string {
  const { serverName, basePath, assetsUrl, manufactChatUrl } = options;
  const serializedBasePath = serializeForInlineScript(basePath);
  const serializedManufactChatUrl = manufactChatUrl
    ? serializeForInlineScript(manufactChatUrl)
    : null;
  const bundleUrl = assetsUrl ?? DEFAULT_INSPECTOR_ASSETS_URL;
  const scriptSrc = escapeHtml(bundleUrl);
  const stylesHref = escapeHtml(inspectorStylesUrl(bundleUrl));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serverName)} — MCP Inspector</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="${stylesHref}" />
    <style>
      :root { color-scheme: light dark; }
      html, body { height: 100%; margin: 0; background-color: #f3f3f3; }
    </style>
  </head>
  <body>
    <div id="root"></div>
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
    <script type="module" src="${scriptSrc}"></script>
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
  options: { serverName: string; basePath: string }
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
  const html = renderInspectorShell({
    serverName: options.serverName,
    basePath: options.basePath,
    assetsUrl,
    manufactChatUrl,
  });

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const pathname = new URL(request.url).pathname;
    if (!matchesInspectorShellPath(pathname, options.basePath)) {
      return new Response("Not Found", { status: 404 });
    }
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
