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
  /**
   * Whether the redirect goes to the user's device: a loopback address or a
   * custom URL scheme such as `cursor://`. Any local program can listen
   * there, so the page should warn the user to approve only a sign-in they
   * started.
   */
  isNative: boolean;
  /** Name of the upstream identity provider, for example `GitHub`. */
  upstream: string;
  /** Scopes that the server requests from the upstream provider. */
  scopes: string[];
  /** Name of this MCP server, when known. */
  serverName?: string;
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
  const who = props.client.verified
    ? props.client.host !== undefined
      ? `<p class="meta">Published at <b>${escapeHtml(props.client.host)}</b></p>`
      : ""
    : `<p class="meta warn">Unverified: the app named itself.</p>`;
  const loopback = props.isNative
    ? `<p class="note">This app runs on your computer. Approve only if you started this sign-in just now.</p>`
    : "";
  const scopes =
    props.scopes.length === 0
      ? ""
      : `<p class="label">Access requested from ${escapeHtml(props.upstream)}</p><ul>${props.scopes
          .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
          .join("")}</ul>`;
  const target = props.serverName ?? "this MCP server";
  return page(
    `Allow ${clientName}?`,
    `<h1>Allow <span>${escapeHtml(clientName)}</span> to use ${escapeHtml(target)}?</h1>
${who}
<p>You will sign in with ${escapeHtml(props.upstream)}. The app can then use ${escapeHtml(target)} as you. Your ${escapeHtml(props.upstream)} credentials stay on the server.</p>
<p class="meta">After sign-in, you return to <b>${escapeHtml(props.redirectHost)}</b>.</p>
${loopback}
${scopes}
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
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p class="meta">Close this window and start the sign-in again from your app.</p>`
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
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e2e2dd;--accent:#1d1d1b;--accent-fg:#fff;--warn:#9a5b00}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1c1c1a;--fg:#ededea;--muted:#a0a09a;--line:#2e2e2b;--accent:#ededea;--accent-fg:#121211;--warn:#e0a24a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:20px;line-height:1.3;margin:0 0 12px;text-wrap:balance}
h1 span{overflow-wrap:anywhere}
p{margin:0 0 12px}
.meta{color:var(--muted);font-size:13px}
.warn,.note{color:var(--warn)}
.note{font-size:13px;border-left:3px solid var(--warn);padding-left:10px}
.label{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:16px}
ul{margin:0 0 16px;padding-left:18px}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}
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
