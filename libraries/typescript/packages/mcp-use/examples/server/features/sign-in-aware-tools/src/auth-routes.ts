import type { MCPServer } from "mcp-use/server";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { auth } from "./auth.js";

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

export function mountAuthRoutes(server: MCPServer): void {
  server.app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
  };

  const authServerMetadataHandler = oauthProviderAuthServerMetadata(auth, {
    headers: corsHeaders,
  });
  server.app.get("/.well-known/oauth-authorization-server", async (c) =>
    authServerMetadataHandler(c.req.raw)
  );
  server.app.get(
    "/.well-known/oauth-authorization-server/api/auth",
    async (c) => authServerMetadataHandler(c.req.raw)
  );

  const openIdConfigHandler = oauthProviderOpenIdConfigMetadata(auth, {
    headers: corsHeaders,
  });
  server.app.get("/.well-known/openid-configuration", async (c) =>
    openIdConfigHandler(c.req.raw)
  );
  server.app.get("/.well-known/openid-configuration/api/auth", async (c) =>
    openIdConfigHandler(c.req.raw)
  );

  server.app.get("/sign-in", (c) => {
    const queryString = new URL(c.req.url).search;
    return c.html(renderSignInPage(queryString));
  });

  server.app.get("/consent", (c) => {
    const url = new URL(c.req.url);
    const clientId = url.searchParams.get("client_id") || "Unknown client";
    const scope = url.searchParams.get("scope") || "openid";
    return c.html(renderConsentPage(clientId, scope));
  });
}

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
    .primary { background: #2563eb; color: white; }
    .primary:hover { background: #1d4ed8; }
    .secondary { background: #f0f0f0; color: #333; }
    .secondary:hover { background: #e0e0e0; }
    .signin { text-align: center; }
    .msg { margin-top: 1rem; font-size: 14px; color: #c00; min-height: 1em; }
  `;
}

function renderSignInPage(queryString: string): string {
  const authorizePath = `/api/auth/oauth2/authorize${queryString}`;
  const authorizePathJson = JSON.stringify(authorizePath);
  return `<!DOCTYPE html>
<html>
<head>
  <title>Sign In</title>
  <style>${commonStyles()}</style>
</head>
<body>
  <div class="card">
    <h1>Sign in</h1>
    <p>Continue as a guest to authorize this MCP client.</p>
    <div class="signin">
      <button class="primary" onclick="signIn()">Continue as guest</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>
  <script>
    async function signIn() {
      const res = await fetch('/api/auth/sign-in/anonymous', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        window.location.href = ${authorizePathJson};
      } else {
        const data = await res.json().catch(() => ({}));
        document.getElementById('msg').textContent =
          data.message || data.error || 'Guest sign-in failed.';
      }
    }
  </script>
</body>
</html>`;
}

function renderConsentPage(clientId: string, scope: string): string {
  const clientName = escapeHtml(clientId);
  const scopes = scope
    ? scope.split(" ").map(escapeHtml)
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
      <button class="secondary" onclick="handleConsent(false)">Deny</button>
      <button class="primary" onclick="handleConsent(true)">Allow</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>
  <script>
    async function handleConsent(accept) {
      const oauthQuery = window.location.search.slice(1);
      const res = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accept,
          oauth_query: oauthQuery,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
      } else {
        document.getElementById('msg').textContent =
          data.message || data.error || 'Consent submission failed.';
      }
    }
  </script>
</body>
</html>`;
}
