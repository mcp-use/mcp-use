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
 * Major version of `@mcp-use/inspector` the default CDN URL pins to.
 *
 * Users pick up inspector patch/minor releases without an SDK bump; a new
 * inspector major requires deliberately raising this constant.
 */
export const INSPECTOR_MAJOR_VERSION = 11;

/**
 * Default URL the inspector shell loads the UI bundle from: the jsDelivr
 * copy of `@mcp-use/inspector`'s CDN build (`dist/cdn/inspector.js`), pinned
 * to {@link INSPECTOR_MAJOR_VERSION}. Override per server with
 * {@link InspectorOptions.assetsUrl}.
 */
export const DEFAULT_INSPECTOR_ASSETS_URL = `https://cdn.jsdelivr.net/npm/@mcp-use/inspector@${INSPECTOR_MAJOR_VERSION}/dist/cdn/inspector.js`;

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
 * `window.location.origin + basePath` — and a module script loading the
 * inspector bundle. All server-provided values are HTML-escaped or
 * JSON-serialized with `<` escaped, so config can't inject markup.
 */
export function renderInspectorShell(options: InspectorShellOptions): string {
  const { serverName, basePath, assetsUrl } = options;
  const serializedBasePath = serializeForInlineScript(basePath);
  const scriptSrc = escapeHtml(assetsUrl ?? DEFAULT_INSPECTOR_ASSETS_URL);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serverName)} — MCP Inspector</title>
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
 * `text/html; charset=utf-8`. No-op when `inspector` is `false`;
 * `undefined`, `true`, and `{}` all mean enabled.
 *
 * @internal Wiring for `MCPServer` — mounted on the same app as the MCP
 * endpoint, so any configured Host/Origin validation middleware applies to
 * this route too.
 */
export function mountInspectorShell<E extends Env>(
  app: Hono<E>,
  inspector: boolean | InspectorOptions | undefined,
  options: { serverName: string; basePath: string }
): void {
  if (inspector === false) {
    return;
  }
  const { assetsUrl } = typeof inspector === "object" ? inspector : {};
  // Config is fixed at mount time, so the page renders once, not per request.
  const html = renderInspectorShell({
    serverName: options.serverName,
    basePath: options.basePath,
    assetsUrl,
  });
  const path = `${options.basePath}/inspector`;
  app.on("GET", [path, `${path}/`], (c) => c.html(html));
}
