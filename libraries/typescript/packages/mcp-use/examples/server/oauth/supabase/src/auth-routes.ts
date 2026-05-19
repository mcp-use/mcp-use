/**
 * Custom authorization UI for Supabase's OAuth 2.1 server.
 *
 * Supabase hosts /authorize, /token, /register, and .well-known discovery on
 * its own infrastructure. You configure a consent-screen URL in the dashboard
 * (Authentication → OAuth Server) — when a user needs to approve an OAuth
 * client, Supabase redirects their browser there with `?authorization_id=<uuid>`.
 *
 * This module uses the official `@supabase/supabase-js` SDK to:
 *   - sign users in (anonymously, for zero-setup demos)
 *   - fetch authorization details (`auth.oauth.getAuthorizationDetails`)
 *   - submit approve/deny (`auth.oauth.approveAuthorization|denyAuthorization`)
 *
 * Anonymous sign-ins must be enabled in the dashboard (Auth → Providers →
 * Anonymous). For real apps, swap this for email+password, magic links, or
 * OAuth providers.
 *
 * Docs: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
 */

import type { MCPServer } from "mcp-use/server";
import {
  createClient,
  type OAuthAuthorizationDetails,
  type SupabaseClient,
} from "@supabase/supabase-js";

export interface MountAuthRoutesOptions {
  projectId: string;
  publishableKey: string;
}

const SESSION_COOKIE = "sb-mcp-session";

interface StoredSession {
  access_token: string;
  refresh_token: string;
}

function supabaseUrl(projectId: string): string {
  return `https://${projectId}.supabase.co`;
}

function createServerClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
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

function parseSessionCookie(
  cookieHeader: string | undefined
): StoredSession | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1])) as StoredSession;
  } catch {
    return null;
  }
}

function serializeSessionCookie(session: StoredSession): string {
  const value = encodeURIComponent(JSON.stringify(session));
  return `${SESSION_COOKIE}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600`;
}

export function mountAuthRoutes(
  server: MCPServer,
  { projectId, publishableKey }: MountAuthRoutesOptions
): void {
  const url = supabaseUrl(projectId);

  // -------------------------------------------------------------------------
  // GET /auth/consent?authorization_id=<id>
  //
  // This is the URL to configure as the consent screen in the Supabase
  // dashboard. Supabase redirects the browser here with only
  // `authorization_id`; we load the authorization details from Supabase
  // before rendering the consent page.
  // -------------------------------------------------------------------------
  server.app.get("/auth/consent", async (c) => {
    const authorizationId = new URL(c.req.url).searchParams.get(
      "authorization_id"
    );
    if (!authorizationId) {
      return c.text("Missing authorization_id", 400);
    }

    const session = parseSessionCookie(c.req.header("Cookie"));

    // Not signed in yet — show the sign-in prompt. After sign-in the page
    // reloads and falls through to the authenticated branch below.
    if (!session) {
      return c.html(renderSignInPage(authorizationId));
    }

    const supabase = createServerClient(url, publishableKey);
    await supabase.auth.setSession(session);

    const { data, error } =
      await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

    if (error || !data) {
      return c.text(
        `Failed to fetch authorization details: ${error?.message ?? "unknown error"}`,
        500
      );
    }

    // If the user has already consented to these scopes, Supabase short-
    // circuits and returns a redirect URL — honor it immediately.
    if ("redirect_url" in data) {
      return c.redirect(data.redirect_url, 302);
    }

    return c.html(renderConsentPage(authorizationId, data));
  });

  // -------------------------------------------------------------------------
  // POST /auth/signin — anonymous sign-in, stash session in cookie
  // -------------------------------------------------------------------------
  server.app.post("/auth/signin", async (c) => {
    const supabase = createServerClient(url, publishableKey);
    const { data, error } = await supabase.auth.signInAnonymously();

    if (error || !data.session) {
      return c.json({ error: error?.message ?? "Sign-in failed" }, 500);
    }

    // Short-lived cookie carries the Supabase session to the consent POST.
    // Production: replace with signed/encrypted session storage.
    c.header(
      "Set-Cookie",
      serializeSessionCookie({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })
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
    const authorizationId = new URL(c.req.url).searchParams.get(
      "authorization_id"
    );
    if (!authorizationId) {
      return c.json({ error: "Missing authorization_id" }, 400);
    }

    const { approve } = await c.req.json<{ approve: boolean }>();
    const session = parseSessionCookie(c.req.header("Cookie"));
    if (!session) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const supabase = createServerClient(url, publishableKey);
    await supabase.auth.setSession(session);

    // `skipBrowserRedirect: true` keeps the SDK from trying to redirect the
    // (nonexistent) browser window on the server — we hand the URL back to
    // the client-side consent page, which performs the navigation.
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        });

    if (error || !data) {
      return c.json({ error: error?.message ?? "Consent failed" }, 500);
    }

    return c.json({ redirect_url: data.redirect_url });
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
