/**
 * Inspector CDN shell — the FastAPI `/docs` analog.
 *
 * The server ships no inspector code: it serves a tiny self-contained HTML
 * page whose `<script type="module">` loads the `@mcp-use/inspector` CDN
 * bundle (a single self-contained ESM file), pinned to a major version so the
 * UI updates independently of SDK releases. Runtime configuration crosses to
 * the bundle through a serialized `window` global; the connect URL is derived
 * in the browser from the page's own origin, so the server never guesses its
 * public hostname.
 */
import type { Env, Hono } from "hono";

import type { InspectorOptions } from "./config.js";

/**
 * Exact version of the `@mcp-use/inspector` CDN bundle the default URL pins
 * to (matching the R2 object key `inspector@{version}.js`).
 *
 * Bumping the inspector requires uploading the new `.js`/`.css` pair and
 * raising this constant together.
 */
export const INSPECTOR_VERSION = "11.0.0";

/**
 * Default URL the inspector shell loads the UI bundle from: the
 * `@mcp-use/inspector` CDN build (`dist/cdn/inspector.js`) built from this
 * branch and hosted on Cloudflare R2, pinned to {@link INSPECTOR_VERSION}.
 * Override per server with {@link InspectorOptions.assetsUrl}.
 *
 * TODO(inspector-cdn): swap to the jsDelivr npm copy
 * (`https://cdn.jsdelivr.net/npm/@mcp-use/inspector@<major>/dist/cdn/inspector.js`)
 * once an inspector release includes this branch's basePath-aware client —
 * published bundles up to 12.x hardcode `/inspector` as the router basename
 * and cannot run under `${basePath}/inspector`. Also replace the temporary
 * `r2.dev` development URL with the `inspector-cdn.mcp-use.com` custom
 * domain if R2 hosting outlives the v2 merge.
 */
export const DEFAULT_INSPECTOR_ASSETS_URL = `https://pub-5337e54ad50f432cab3e646138da1efc.r2.dev/inspector@${INSPECTOR_VERSION}.js`;

/**
 * Derive the stylesheet URL that accompanies an inspector bundle URL.
 *
 * The CDN build ships as a `.js`/`.css` pair with the same basename
 * (`inspector@{version}.js` + `inspector@{version}.css`), so the stylesheet
 * URL is the script URL with its `.js` suffix swapped for `.css`. Query
 * strings and fragments are preserved.
 */
export function inspectorStylesUrl(assetsUrl: string): string {
  return assetsUrl.replace(/\.js(?=$|[?#])/, ".css");
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
 * A minimal dark-background document (no white flash before the UI paints)
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
    <link rel="stylesheet" href="${stylesHref}" />
    <style>
      :root { color-scheme: dark; }
      html, body { height: 100%; margin: 0; background-color: #0c0c0d; }
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
 * Mount the inspector shell on a Hono app at `${basePath}/inspector`.
 *
 * Registers GET for both the bare and trailing-slash paths (Hono answers
 * HEAD from GET handlers automatically) and serves the pre-rendered shell as
 * `text/html; charset=utf-8`. No-op when `inspector.enabled` is `false`;
 * `undefined` and `{}` mean enabled.
 *
 * @internal Wiring for `MCPServer` — mounted on the same app as the MCP
 * endpoint, so any configured Host/Origin validation middleware applies to
 * this route too.
 */
export function mountInspectorShell<E extends Env>(
  app: Hono<E>,
  inspector: InspectorOptions | undefined,
  options: { serverName: string; basePath: string }
): void {
  if (inspector?.enabled === false) {
    return;
  }
  const { assetsUrl, manufactChatUrl: configManufactChatUrl } = inspector ?? {};
  const manufactChatUrl =
    configManufactChatUrl ?? process.env.MANUFACT_CHAT_URL ?? undefined;
  // Config is fixed at mount time, so the page renders once, not per request.
  const html = renderInspectorShell({
    serverName: options.serverName,
    basePath: options.basePath,
    assetsUrl,
    manufactChatUrl,
  });
  const path = `${options.basePath}/inspector`;
  app.on("GET", [path, `${path}/`], (c) => c.html(html));
}
