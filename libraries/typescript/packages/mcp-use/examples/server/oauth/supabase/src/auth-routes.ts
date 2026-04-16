/**
 * Custom authorization UI for Supabase's OAuth 2.1 server.
 *
 * Supabase hosts /authorize, /token, /register, and .well-known discovery on
 * its own infrastructure. Supabase lets you configure a consent-screen URL in
 * the dashboard — when a user needs to approve an OAuth client, Supabase
 * redirects their browser there with `?authorization_id=<uuid>`. We look up
 * the authorization details, show a consent page, and POST the decision
 * back to Supabase, which returns a `redirect_url` that completes the flow.
 *
 * For this example we use **anonymous sign-in** to keep setup to zero:
 * one click creates a throwaway user, no email, no password. You must enable
 * anonymous sign-ins in the dashboard (Auth → Sign In / Providers → Enable
 * anonymous sign-ins). For real apps, swap this for email+password, OAuth
 * providers, or magic links.
 *
 * Endpoints called on Supabase:
 * - POST /auth/v1/signup (with empty body)                         → anon sign-up
 * - GET  /auth/v1/oauth/authorizations/{id}                        → fetch auth details
 * - POST /auth/v1/oauth/authorizations/{id}/consent                → approve/deny
 *
 * Docs: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
 */

import type { MCPServer } from "mcp-use/server";

export interface MountAuthRoutesOptions {
  projectId: string;
  anonKey: string;
}

const SESSION_COOKIE = "sb-mcp-session";

function supabaseAuthUrl(projectId: string): string {
  return `https://${projectId}.supabase.co/auth/v1`;
}

interface OAuthAuthorizationClient {
  id: string;
  name: string;
  uri: string;
  logo_uri: string;
}

interface OAuthAuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  client: OAuthAuthorizationClient;
  user: { id: string; email: string };
  scope: string;
}

interface OAuthRedirect {
  redirect_url: string;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c
  );
}

function parseSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export function mountAuthRoutes(
  server: MCPServer,
  { projectId, anonKey }: MountAuthRoutesOptions
): void {
  const authUrl = supabaseAuthUrl(projectId);

  // -------------------------------------------------------------------------
  // GET /auth/consent?authorization_id=<id>
  //
  // This is the URL to configure as the consent screen in the Supabase
  // dashboard. Supabase redirects the browser here with only
  // `authorization_id`; we fetch client/scope details from Supabase before
  // rendering.
  // -------------------------------------------------------------------------
  server.app.get("/auth/consent", async (c) => {
    const url = new URL(c.req.url);
    const authorizationId = url.searchParams.get("authorization_id");
    if (!authorizationId) {
      return c.text("Missing authorization_id", 400);
    }

    const accessToken = parseSessionCookie(c.req.header("Cookie"));

    // Not signed in yet — show the sign-in prompt. After sign-in the page
    // reloads and falls through to the authenticated branch below.
    if (!accessToken) {
      return c.html(renderSignInPage(authorizationId));
    }

    // Fetch authorization details (client name, requested scopes, …).
    const detailsRes = await fetch(
      `${authUrl}/oauth/authorizations/${authorizationId}`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!detailsRes.ok) {
      return c.text(
        `Failed to fetch authorization details: ${await detailsRes.text()}`,
        detailsRes.status as 400 | 401 | 403 | 404 | 500
      );
    }

    const details = (await detailsRes.json()) as
      | OAuthAuthorizationDetails
      | OAuthRedirect;

    // If the user has already consented to these scopes, Supabase short-
    // circuits and returns a redirect URL — honor it immediately.
    if ("redirect_url" in details) {
      return c.redirect(details.redirect_url, 302);
    }

    return c.html(renderConsentPage(authorizationId, details));
  });

  // -------------------------------------------------------------------------
  // POST /auth/signin — create an anonymous Supabase user and store the token
  // -------------------------------------------------------------------------
  server.app.post("/auth/signin", async (c) => {
    const res = await fetch(`${authUrl}/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      return c.json({ error: await res.text() }, 500);
    }

    const { access_token } = (await res.json()) as { access_token: string };

    // Short-lived cookie carries the Supabase session to the consent POST.
    // Production: replace with signed/encrypted session storage.
    c.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=${access_token}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600`
    );
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /auth/consent?authorization_id=<id>
  //   body: { approve: boolean }
  // Forwards the decision to Supabase, which responds with a redirect_url
  // pointing back to the MCP client (with `code` & `state`, or an error).
  // -------------------------------------------------------------------------
  server.app.post("/auth/consent", async (c) => {
    const url = new URL(c.req.url);
    const authorizationId = url.searchParams.get("authorization_id");
    if (!authorizationId) {
      return c.json({ error: "Missing authorization_id" }, 400);
    }

    const { approve } = await c.req.json<{ approve: boolean }>();
    const accessToken = parseSessionCookie(c.req.header("Cookie"));
    if (!accessToken) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const res = await fetch(
      `${authUrl}/oauth/authorizations/${authorizationId}/consent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: approve ? "approve" : "deny" }),
      }
    );

    if (!res.ok) {
      return c.json(
        { error: await res.text() },
        res.status as 400 | 401 | 403 | 500
      );
    }

    const { redirect_url } = (await res.json()) as OAuthRedirect;
    return c.json({ redirect_url });
  });
}

// ---------------------------------------------------------------------------
// HTML renderers
// ---------------------------------------------------------------------------

function commonStyles(): string {
  return `
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 420px; width: 100%; }
    h1 { margin-top: 0; }
    .scopes { list-style: none; padding: 0; }
    .scopes li { padding: 8px 0; border-bottom: 1px solid #eee; }
    .scopes li:last-child { border-bottom: none; }
    .buttons { display: flex; gap: 12px; margin-top: 1.5rem; }
    button { padding: 12px 24px; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; flex: 1; }
    .primary { background: #3ecf8e; color: white; }
    .primary:hover { background: #2fae75; }
    .secondary { background: #f0f0f0; color: #333; }
    .secondary:hover { background: #e0e0e0; }
    .signin { text-align: center; }
    .msg { margin-top: 1rem; font-size: 14px; color: #c00; min-height: 1em; }
  `;
}

function renderSignInPage(authorizationId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Sign In</title>
  <style>${commonStyles()}</style>
</head>
<body>
  <div class="card">
    <h1>Sign in</h1>
    <p>Sign in to authorize the application.</p>
    <div class="signin">
      <button class="primary" onclick="signIn()">Continue as guest</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>
  <script>
    async function signIn() {
      const res = await fetch('/auth/signin', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/auth/consent?authorization_id=${encodeURIComponent(authorizationId)}';
      } else {
        document.getElementById('msg').textContent =
          'Sign-in failed. Enable anonymous sign-ins in the Supabase dashboard.';
      }
    }
  </script>
</body>
</html>`;
}

function renderConsentPage(
  authorizationId: string,
  details: OAuthAuthorizationDetails
): string {
  const clientName = escapeHtml(details.client.name || "Unknown client");
  const scopes = details.scope
    ? details.scope.split(" ").map(escapeHtml)
    : ["(no scopes requested)"];

  return `<!DOCTYPE html>
<html>
<head>
  <title>Authorize Application</title>
  <style>${commonStyles()}</style>
</head>
<body>
  <div class="card">
    <h1>Authorize Application</h1>
    <p><strong>${clientName}</strong> is requesting access to:</p>
    <ul class="scopes">
      ${scopes.map((s) => `<li>${s}</li>`).join("")}
    </ul>
    <div class="buttons">
      <button class="secondary" onclick="decide(false)">Deny</button>
      <button class="primary" onclick="decide(true)">Allow</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>
  <script>
    async function decide(approve) {
      const res = await fetch(
        '/auth/consent?authorization_id=${encodeURIComponent(authorizationId)}',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ approve }),
        }
      );
      const data = await res.json();
      if (data.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        document.getElementById('msg').textContent =
          data.error || 'Consent submission failed.';
      }
    }
  </script>
</body>
</html>`;
}
