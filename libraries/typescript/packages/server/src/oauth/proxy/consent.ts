/**
 * HTML pages the OAuth proxy serves: the consent page and error pages.
 *
 * @internal
 */

/**
 * Values handed to a custom consent page (the `consent.page` option of
 * `oauthProxy`).
 *
 * The page must render a form that posts to `form.action` with the method
 * `post`, a hidden input named `csrf` whose value is `form.csrf`, and submit
 * buttons named `decision` with the values `allow` and `deny`.
 *
 * @example
 * ```tsx
 * import type { ConsentPageProps } from "mcp-use/oauth";
 *
 * export function Consent({ client, upstream, form }: ConsentPageProps) {
 *   return (
 *     <form method="post" action={form.action}>
 *       <p>Allow {client.name ?? "this app"} to sign in with {upstream}?</p>
 *       <input type="hidden" name="csrf" value={form.csrf} />
 *       <button name="decision" value="deny">Deny</button>
 *       <button name="decision" value="allow">Allow</button>
 *     </form>
 *   );
 * }
 * ```
 */
export interface ConsentPageProps {
  /** The MCP client that asks for access. */
  client: {
    /** Client identifier. For a metadata-document client, this is its URL. */
    id: string;
    /** Name the client gave. A registered (DCR) client chose it itself. */
    name?: string;
    /** Host of the client's metadata document, when the client used one. */
    host?: string;
    /**
     * Whether the client is identified by its own HTTPS metadata document
     * or by server configuration. A dynamically registered client names
     * itself, so it is not verified.
     */
    verified: boolean;
  };
  /** Host (or custom scheme) that the browser returns to after sign-in. */
  redirectHost: string;
  /** Name of the upstream identity provider, for example `GitHub`. */
  upstream: string;
  /** Scopes that the server requests from the upstream provider. */
  scopes: string[];
  /**
   * Host of this MCP server's public URL, for example `mcp.acme.com` or
   * `localhost:3000`. The page names the server by it, because the user can
   * check it in the address bar.
   */
  serverHost: string;
  /** Form target and CSRF token. */
  form: {
    /** URL to post the decision to. */
    action: string;
    /** Value for the hidden `csrf` input. */
    csrf: string;
  };
}

/** @internal Content Security Policy for every proxy HTML page. */
export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; " +
  "frame-ancestors 'none'; base-uri 'none'";

/** @internal Renders the built-in consent page. */
export function renderDefaultConsentPage(props: ConsentPageProps): string {
  const clientName = props.client.name ?? "An app";
  const upstream = escapeHtml(props.upstream);
  const target = escapeHtml(props.serverHost);
  const scopes =
    props.scopes.length === 0
      ? ""
      : `<dt>Scopes</dt><dd><span class="chips">${props.scopes
          .map((scope) => `<code>${escapeHtml(scope)}</code>`)
          .join("")}</span></dd>`;
  return page(
    `Allow ${clientName}?`,
    `<h1>Allow <span>${escapeHtml(clientName)}</span> to connect to ${target}?</h1>
<dl>
<dt>App</dt><dd><b>${escapeHtml(clientName)}</b></dd>
<dt>Returns to</dt><dd>After sign-in, you return to <b>${escapeHtml(props.redirectHost)}</b>.</dd>
<dt>Signs in with</dt><dd><b>${upstream}</b></dd>
${scopes}
</dl>
<p class="note">You will sign in with ${upstream}. The app can then use ${target} as you.</p>
<form method="post" action="${escapeHtml(props.form.action)}">
  <input type="hidden" name="csrf" value="${escapeHtml(props.form.csrf)}">
  <div class="actions">
    <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
    <button type="submit" name="decision" value="allow">Allow</button>
  </div>
</form>`
  );
}

/** @internal Renders a custom consent page component with react-dom/server. */
export async function renderCustomConsentPage(
  component: (props: ConsentPageProps) => unknown,
  props: ConsentPageProps
): Promise<string> {
  let react: typeof import("react");
  let server: typeof import("react-dom/server");
  try {
    [react, server] = await Promise.all([
      import("react"),
      import("react-dom/server"),
    ]);
  } catch (error) {
    throw new Error(
      "oauthProxy consent.page needs the react and react-dom packages",
      { cause: error }
    );
  }
  const element = react.createElement(
    component as unknown as import("react").FunctionComponent<ConsentPageProps>,
    props
  );
  return `<!doctype html>${server.renderToString(element)}`;
}

/** @internal Renders an error page for requests that cannot redirect. */
export function renderErrorPage(title: string, message: string): string {
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1>
<p class="lead">${escapeHtml(message)}</p>
<p class="note">Close this window and start the sign-in again from your app.</p>`
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--frame:#e9ebe8;--glow-a:#d9e5ff;--glow-b:#f7fdb0;--grain:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");--grain-opacity:.16;--grain-blend:multiply;--panel:rgba(253,252,252,.9);--panel-line:rgba(0,0,0,.06);--fg:#172037;--title:#172037;--muted:rgba(23,32,55,.66);--line:rgba(0,0,0,.09);--chip:#fff;--chip-line:rgba(0,0,0,.12);--btn:linear-gradient(180deg,#1e293b,#0f172a);--btn-fg:#fff;--btn-line:rgba(0,0,0,.12);--btn-shadow:0 1px 2px rgba(0,0,0,.12),0 2px 8px rgba(15,23,42,.15);--btn2:rgba(255,255,255,.72);--btn2-line:rgba(23,32,55,.2);--error:#9b1c1c;--error-bg:#fdecea;--error-line:#f5c2c0}
@media (prefers-color-scheme:dark){:root{--frame:#14161b;--glow-a:#2b3652;--glow-b:#3a3f1d;--grain:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");--grain-opacity:.1;--grain-blend:screen;--panel:rgba(20,22,28,.88);--panel-line:rgba(255,255,255,.09);--fg:#e8ecf5;--title:#f4f6fb;--muted:rgba(232,236,245,.62);--line:rgba(255,255,255,.1);--chip:rgba(255,255,255,.06);--chip-line:rgba(255,255,255,.16);--btn:linear-gradient(180deg,#f8fafc,#d9dfea);--btn-fg:#0f172a;--btn-line:rgba(255,255,255,.4);--btn-shadow:0 1px 2px rgba(0,0,0,.4),0 2px 10px rgba(0,0,0,.3);--btn2:rgba(255,255,255,.05);--btn2-line:rgba(255,255,255,.22);--error:#fca5a5;--error-bg:rgba(248,113,113,.12);--error-line:rgba(248,113,113,.35)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background-color:var(--frame);background-image:radial-gradient(110% 80% at 0% 0%,var(--glow-a),transparent 62%),radial-gradient(110% 85% at 100% 100%,var(--glow-b),transparent 62%);background-attachment:fixed}
body::before{content:"";position:fixed;inset:0;z-index:-1;background-image:var(--grain);opacity:var(--grain-opacity);mix-blend-mode:var(--grain-blend);pointer-events:none}
main{width:100%;max-width:400px;background:var(--panel);border:1px solid var(--panel-line);border-radius:22px;padding:28px 26px 22px}
h1{margin:0;font-size:1.4rem;line-height:1.25;font-weight:700;text-align:center;text-wrap:balance;overflow-wrap:anywhere;color:var(--title)}
p{margin:0}
b{font-weight:600}
dl{margin:20px 0 0;display:grid;grid-template-columns:minmax(78px,auto) 1fr;gap:0 16px;border-top:1px solid var(--line)}
dt,dd{margin:0;padding:11px 0;border-bottom:1px solid var(--line);font-size:.9rem}
dt{color:var(--muted)}
dd{min-width:0;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:6px}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 10px;border-radius:9999px;background:var(--chip);border:1px solid var(--chip-line)}
.lead{margin-top:10px;text-align:center;color:var(--muted)}
.note{margin-top:14px;font-size:.84rem;color:var(--muted)}
.lead+.note{text-align:center}
form{margin:18px 0 0}
[data-mcp-use-error]{background:var(--error-bg);border:1px solid var(--error-line);border-radius:10px;padding:9px 12px}
.actions{display:flex;gap:10px}
button{flex:1;font:inherit;font-weight:600;font-size:.9375rem;line-height:1.3;padding:.625rem 1.25rem;border-radius:9999px;cursor:pointer;background:var(--btn);color:var(--btn-fg);border:1px solid var(--btn-line);box-shadow:var(--btn-shadow)}
button.secondary{background:var(--btn2);color:var(--fg);border-color:var(--btn2-line);box-shadow:none}
</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}

/** @internal Escapes text for HTML element and attribute content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
