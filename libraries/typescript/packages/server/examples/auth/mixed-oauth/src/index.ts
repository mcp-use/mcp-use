import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { MCPServer } from "mcp-use";
import { oauthBetterAuthProvider } from "mcp-use/oauth/better-auth";

import { createDemoAuth, demoScopes } from "./auth.js";

const port = Number(process.env["PORT"] ?? 3000);
const origin = resolveOrigin(
  process.env["MIXED_OAUTH_ORIGIN"] ?? `http://localhost:${port}`
);
const resource = new URL("/mcp", origin);
const authURL = new URL("/api/auth", origin);
const protectedScope = "demo:protected";

const provider = oauthBetterAuthProvider({
  authURL,
  resource,
  // Baseline scope every protected call must carry. Tool-level `oauth2`
  // scopes add to it.
  requiredScopes: [protectedScope],
  scopesSupported: [...demoScopes],
  resourceName: "mcp-use mixed OAuth demo",
});
const auth = createDemoAuth({ origin: origin.origin, resource: resource.href });

// `oauth` publishes RFC 9728 discovery metadata and verifies bearer tokens.
// `allowAnonymous` keeps initialize, tools/list, and `noauth` tools open, so
// a client can connect and browse before it ever signs in. Every tool's
// `securitySchemes` is both the enforced policy and the metadata clients see.
const server = new MCPServer({
  name: "mixed-oauth-demo",
  version: "1.0.0",
  description:
    "A local mcp-use v2 server with public discovery and one OAuth-protected tool.",
  oauth: provider,
  allowAnonymous: true,
  cors: {
    origin: [origin.origin, "http://localhost:4173", "http://127.0.0.1:4173"],
    credentials: true,
  },
});

// Public: runs without a token. A supplied token is still verified.
server.tool(
  {
    name: "public_ping",
    description: "Public tool that works before and after authentication.",
    securitySchemes: [{ type: "noauth" }],
  },
  async (_args, ctx) => ({
    content: [
      {
        type: "text",
        text: ctx.auth
          ? `Public pong for ${ctx.auth.user.id}. This request carried a token but did not require one.`
          : "Public pong. This request did not require OAuth.",
      },
    ],
  })
);

// Protected: without a token the server answers 401 + WWW-Authenticate (or a
// ChatGPT-style tool-result challenge), the client signs in, and the retry
// reaches this callback with `ctx.auth` populated.
server.tool(
  {
    name: "protected_profile",
    description:
      "Protected tool that triggers OAuth and succeeds when the client retries with a bearer token.",
    securitySchemes: [{ type: "oauth2", scopes: [protectedScope] }],
    authErrorMessage: "Sign in to view your profile.",
  },
  async (_args, ctx) => ({
    content: [
      {
        type: "text",
        text: `Authenticated profile unlocked for ${ctx.auth?.user.id}. Scopes: ${ctx.auth?.scopes.join(" ")}.`,
      },
    ],
  })
);

// Optional: public behavior with an authenticated upgrade. The gate never
// challenges this tool; the callback decides what a token unlocks.
server.tool(
  {
    name: "welcome",
    description: "Greets anonymous visitors and welcomes back signed-in users.",
    securitySchemes: [
      { type: "noauth" },
      { type: "oauth2", scopes: ["profile"] },
    ],
  },
  async (_args, ctx) => ({
    content: [
      {
        type: "text",
        text: ctx.auth?.scopes.includes("profile")
          ? `Welcome back, ${ctx.auth.user.name ?? ctx.auth.user.id}!`
          : "Welcome! Sign in to personalize this greeting.",
      },
    ],
  })
);

const authServerMetadata = oauthProviderAuthServerMetadata(auth);
const openIdConfiguration = oauthProviderOpenIdConfigMetadata(auth);

// Better Auth uses a pathful issuer. Expose both RFC 8414 discovery forms and
// its issuer-appended OIDC form so SDK discovery works in every supported era.
server.get("/.well-known/oauth-authorization-server/api/auth", (context) =>
  authServerMetadata(context.req.raw)
);
server.get("/api/auth/.well-known/oauth-authorization-server", (context) =>
  authServerMetadata(context.req.raw)
);
server.get("/api/auth/.well-known/openid-configuration", (context) =>
  openIdConfiguration(context.req.raw)
);
server.all("/api/auth/*", (context) => auth.handler(context.req.raw));

server.get("/sign-in", (context) => context.html(signInPage));
server.get("/consent", (context) => context.html(consentPage));
server.get("/", (context) =>
  context.html(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Mixed OAuth demo</title></head>
  <body>
    <main>
      <h1>mcp-use mixed OAuth demo</h1>
      <p>MCP endpoint: <code>${resource.href}</code></p>
      <p><code>public_ping</code> is anonymous, <code>welcome</code> upgrades with a token, and <code>protected_profile</code> requires <code>${protectedScope}</code>.</p>
      <p><a href="/mcp/inspector">Open the Inspector</a></p>
    </main>
  </body>
</html>`)
);

export default server;

function resolveOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      "MIXED_OAUTH_ORIGIN must be a localhost origin without a path, query, or fragment"
    );
  }
  return url;
}

const signInPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in to the mixed OAuth demo</title>
  </head>
  <body>
    <main>
      <h1>Continue to the mixed OAuth demo</h1>
      <p>This local demo uses an anonymous, in-memory account. No credentials are required.</p>
      <button id="sign-in">Continue</button>
      <p id="error" role="alert"></p>
    </main>
    <script>
      const button = document.querySelector('#sign-in');
      const error = document.querySelector('#error');

      button.addEventListener('click', async () => {
        button.disabled = true;
        error.textContent = '';
        try {
          const response = await fetch('/api/auth/sign-in/anonymous', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ oauth_query: location.search.slice(1) }),
          });
          const data = await response.json();
          if (response.ok && data.url) {
            location.replace(data.url);
            return;
          }
          error.textContent = data.message || 'Anonymous sign-in failed';
        } catch (cause) {
          error.textContent = cause instanceof Error ? cause.message : 'Anonymous sign-in failed';
        } finally {
          button.disabled = false;
        }
      });
    </script>
  </body>
</html>`;

const consentPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize the mixed OAuth demo</title>
  </head>
  <body>
    <main>
      <h1>Authorize protected tools</h1>
      <p>The MCP client is requesting <code>${protectedScope}</code> so it can call <code>protected_profile</code>.</p>
      <button data-accept="false">Deny</button>
      <button data-accept="true">Allow</button>
      <p id="error" role="alert"></p>
    </main>
    <script>
      document.querySelectorAll('[data-accept]').forEach((button) => {
        button.addEventListener('click', async () => {
          const response = await fetch('/api/auth/oauth2/consent', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              accept: button.dataset.accept === 'true',
              oauth_query: location.search.slice(1),
            }),
          });
          const data = await response.json();
          if (response.ok && data.url) {
            location.href = data.url;
            return;
          }
          document.querySelector('#error').textContent = data.message || 'Authorization failed';
        });
      });
    </script>
  </body>
</html>`;
