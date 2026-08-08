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

import type { FetchHandler } from "mcp-use";
import {
  createClient,
  type OAuthAuthorizationDetails,
  type SupabaseClient,
} from "@supabase/supabase-js";

export interface CreateAuthHandlerOptions {
  supabaseUrl: string;
  publishableKey: string;
}

const SESSION_COOKIE = "sb-mcp-session";

interface StoredSession {
  access_token: string;
  refresh_token: string;
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

/** Exact loopback check mirroring the package's isLocalhost semantics. */
function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL("http://" + host).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

function serializeSessionCookie(
  session: StoredSession,
  host: string | undefined
): string {
  const value = encodeURIComponent(JSON.stringify(session));
  const secureFlag = isLocalHostHeader(host) ? "" : "; Secure";
  return `${SESSION_COOKIE}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${secureFlag}`;
}

function clearSessionCookie(host: string | undefined): string {
  const secureFlag = isLocalHostHeader(host) ? "" : "; Secure";
  return `${SESSION_COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}

type RestoredSession =
  | { ok: true; setCookie?: string }
  | { ok: false; setCookie: string };

/**
 * Restores the Supabase session from the cookie, reporting the Set-Cookie
 * header the caller must apply: a cleared cookie when the stored session is
 * stale, or a refreshed cookie when Supabase rotated the tokens.
 */
async function restoreSession(
  supabase: SupabaseClient,
  session: StoredSession,
  host: string | undefined
): Promise<RestoredSession> {
  const { data, error } = await supabase.auth.setSession(session);
  if (error) {
    return { ok: false, setCookie: clearSessionCookie(host) };
  }
  if (
    data.session &&
    (data.session.access_token !== session.access_token ||
      data.session.refresh_token !== session.refresh_token)
  ) {
    return {
      ok: true,
      setCookie: serializeSessionCookie(
        {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
        host
      ),
    };
  }
  return { ok: true };
}

function withSetCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createAuthHandler({
  supabaseUrl,
  publishableKey,
}: CreateAuthHandlerOptions): FetchHandler {
  return async (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const host = request.headers.get("Host") ?? undefined;
    const cookieHeader = request.headers.get("Cookie") ?? undefined;

    if (pathname === "/auth/consent" && method === "GET") {
      const authorizationId = url.searchParams.get("authorization_id");
      if (!authorizationId) {
        return new Response("Missing authorization_id", { status: 400 });
      }

      const session = parseSessionCookie(cookieHeader);
      if (!session) {
        return new Response(renderSignInPage(), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      const supabase = createServerClient(supabaseUrl, publishableKey);
      const restored = await restoreSession(supabase, session, host);
      if (!restored.ok) {
        return withSetCookie(
          new Response(renderSignInPage(), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
          restored.setCookie
        );
      }

      const { data, error } =
        await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

      if (error || !data) {
        return new Response(
          `Failed to fetch authorization details: ${error?.message ?? "unknown error"}`,
          { status: 500 }
        );
      }

      if ("redirect_url" in data) {
        const response = Response.redirect(data.redirect_url, 302);
        return restored.setCookie === undefined
          ? response
          : withSetCookie(response, restored.setCookie);
      }

      const response = new Response(renderConsentPage(data), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      return restored.setCookie === undefined
        ? response
        : withSetCookie(response, restored.setCookie);
    }

    if (pathname === "/auth/signin" && method === "POST") {
      const supabase = createServerClient(supabaseUrl, publishableKey);
      const { data, error } = await supabase.auth.signInAnonymously();

      if (error || !data.session) {
        return Response.json(
          { error: error?.message ?? "Sign-in failed" },
          { status: 500 }
        );
      }

      return withSetCookie(
        Response.json({ ok: true }),
        serializeSessionCookie(
          {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          },
          host
        )
      );
    }

    if (pathname === "/auth/consent" && method === "POST") {
      const authorizationId = url.searchParams.get("authorization_id");
      if (!authorizationId) {
        return Response.json(
          { error: "Missing authorization_id" },
          { status: 400 }
        );
      }

      let approve: unknown;
      try {
        const body = (await request.json()) as { approve: unknown };
        approve = body.approve;
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      if (typeof approve !== "boolean") {
        return Response.json(
          { error: "approve must be a boolean" },
          { status: 400 }
        );
      }

      const session = parseSessionCookie(cookieHeader);
      if (!session) {
        return Response.json({ error: "not_authenticated" }, { status: 401 });
      }

      const supabase = createServerClient(supabaseUrl, publishableKey);
      const restored = await restoreSession(supabase, session, host);
      if (!restored.ok) {
        return withSetCookie(
          Response.json({ error: "not_authenticated" }, { status: 401 }),
          restored.setCookie
        );
      }

      const { data, error } = approve
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          })
        : await supabase.auth.oauth.denyAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          });

      if (error || !data) {
        const response = Response.json(
          { error: error?.message ?? "Consent failed" },
          { status: 500 }
        );
        return restored.setCookie === undefined
          ? response
          : withSetCookie(response, restored.setCookie);
      }

      const response = Response.json({ redirect_url: data.redirect_url });
      return restored.setCookie === undefined
        ? response
        : withSetCookie(response, restored.setCookie);
    }

    return new Response("Not Found", { status: 404 });
  };
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

function renderSignInPage(): string {
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
      const authorizationId = new URLSearchParams(location.search).get('authorization_id') ?? '';
      const res = await fetch('/auth/signin', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/auth/consent?authorization_id=' + encodeURIComponent(authorizationId);
      } else {
        document.getElementById('msg').textContent =
          'Sign-in failed. Enable anonymous sign-ins in the Supabase dashboard.';
      }
    }
  </script>
</body>
</html>`;
}

function renderConsentPage(details: OAuthAuthorizationDetails): string {
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
      const authorizationId = new URLSearchParams(location.search).get('authorization_id') ?? '';
      const res = await fetch(
        '/auth/consent?authorization_id=' + encodeURIComponent(authorizationId),
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
