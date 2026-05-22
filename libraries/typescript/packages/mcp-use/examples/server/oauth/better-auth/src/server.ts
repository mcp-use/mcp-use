/**
 * Better Auth OAuth MCP Server Example
 *
 * Demonstrates running Better Auth and an MCP server on a single Hono app.
 * The auth server and MCP resource server share one port — no separate
 * processes. Passing the `auth` instance directly to `oauthBetterAuthProvider`
 * is enough; the SDK mounts Better Auth's handler under MCPServer's basePath
 * and registers OAuth discovery (`.well-known/*`) at the host root.
 *
 * Setup:
 * 1. Copy .env.example to .env and fill in GitHub OAuth credentials
 * 2. Run: pnpx auth@latest migrate (creates the database tables)
 * 3. Run: pnpm dev
 * 4. Open MCP Inspector at http://localhost:3000/mcp-server/inspector
 *
 * Environment variables:
 * - BETTER_AUTH_SECRET (required)
 * - GITHUB_CLIENT_ID (required)
 * - GITHUB_CLIENT_SECRET (required)
 */

// @ts-nocheck
import { MCPServer, oauthBetterAuthProvider, object } from "mcp-use/server";
import { auth } from "./auth.js";

declare const process: { env: Record<string, string | undefined> };

const server = new MCPServer({
  name: "better-auth-oauth-example",
  version: "1.0.0",
  description: "MCP server with Better Auth OAuth authentication",
  basePath: "/mcp-server",
  oauth: oauthBetterAuthProvider(auth),
});

// ---------------------------------------------------------------------------
// Login page — redirects to GitHub OAuth
// ---------------------------------------------------------------------------
server.app.get("/sign-in", (c) => {
  // Extract the OAuth query params so we can pass them back after login
  const queryString = new URL(c.req.url).search;

  return c.html(`<!DOCTYPE html>
<html>
<head>
  <title>Sign In</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
    h1 { margin-top: 0; }
    button.btn { padding: 12px 24px; background: #24292e; color: white; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; }
    button.btn:hover { background: #1b1f23; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign In</h1>
    <p>Sign in to authorize the MCP client.</p>
    <button class="btn" onclick="signIn()">Sign in with GitHub</button>
  </div>
  <script>
    async function signIn() {
      const res = await fetch('/mcp-server/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider: 'github',
          callbackURL: '/mcp-server/api/auth/oauth2/authorize${queryString}',
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    }
  </script>
</body>
</html>`);
});

// ---------------------------------------------------------------------------
// Consent page — allows user to approve requested scopes
// ---------------------------------------------------------------------------
server.app.get("/consent", (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id") || "Unknown client";
  const scope = url.searchParams.get("scope") || "openid";
  const scopes = scope.split(" ");

  return c.html(`<!DOCTYPE html>
<html>
<head>
  <title>Authorize Application</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { margin-top: 0; }
    .scopes { list-style: none; padding: 0; }
    .scopes li { padding: 8px 0; border-bottom: 1px solid #eee; }
    .scopes li:last-child { border-bottom: none; }
    .buttons { display: flex; gap: 12px; margin-top: 1.5rem; }
    button { padding: 12px 24px; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; flex: 1; }
    .allow { background: #2ea043; color: white; }
    .allow:hover { background: #238636; }
    .deny { background: #f0f0f0; color: #333; }
    .deny:hover { background: #e0e0e0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize Application</h1>
    <p><strong>${clientId}</strong> is requesting access to:</p>
    <ul class="scopes">
      ${scopes.map((s) => `<li>${s}</li>`).join("")}
    </ul>
    <div class="buttons">
      <button class="deny" onclick="handleConsent(false)">Deny</button>
      <button class="allow" onclick="handleConsent(true)">Allow</button>
    </div>
  </div>
  <script>
    async function handleConsent(accept) {
      const oauthQuery = window.location.search.slice(1); // strip leading '?'
      const res = await fetch('/mcp-server/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accept,
          oauth_query: oauthQuery,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    }
  </script>
</body>
</html>`);
});

// ---------------------------------------------------------------------------
// MCP Tools
// ---------------------------------------------------------------------------

/**
 * Tool that returns authenticated user information from the JWT
 */
server.tool(
  {
    name: "get-user-info",
    description: "Get information about the authenticated user",
  },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
      scopes: ctx.auth.scopes,
      permissions: ctx.auth.permissions,
    })
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen({ port: 3000 }).then(() => {
  console.log("Better Auth OAuth MCP Server running on http://localhost:3000");
  console.log("MCP Inspector: http://localhost:3000/mcp-server/inspector");
  console.log("MCP transport: http://localhost:3000/mcp-server/mcp");
  console.log("Auth API: http://localhost:3000/mcp-server/api/auth");
});
