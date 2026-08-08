import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createAuth } from "./auth.js";

if (process.env["NODE_ENV"] !== "production") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // The example also runs without an .env file.
  }
}

const authURL = new URL(
  process.env["BETTER_AUTH_URL"] ?? "http://localhost:61843/api/auth"
);
if (authURL.pathname.replace(/\/$/, "") !== "/api/auth") {
  throw new Error("BETTER_AUTH_URL must use the /api/auth path");
}

const port = Number(
  authURL.port !== "" ? authURL.port : authURL.protocol === "https:" ? 443 : 80
);
const origin = authURL.origin;
const mcpURL = new URL(process.env["MCP_URL"] ?? "http://localhost:43127");
if (mcpURL.pathname !== "/" || mcpURL.search !== "" || mcpURL.hash !== "") {
  throw new Error("MCP_URL must be an origin without a path, query, or hash");
}
const resource = new URL("/mcp", mcpURL).href;
const resourceOrigin = mcpURL.origin;

const auth = createAuth({ origin, resource });
const app = new Hono();

// Browser-based MCP clients call registration and token endpoints from the
// MCP server's origin, so the standalone authorization server allows it.
app.use(
  "*",
  cors({
    origin: resourceOrigin,
    allowHeaders: ["Authorization", "Content-Type", "MCP-Protocol-Version"],
    allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
    credentials: true,
  })
);

const metadataHeaders = {
  "Access-Control-Allow-Origin": resourceOrigin,
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};
const authServerMetadata = oauthProviderAuthServerMetadata(auth, {
  headers: metadataHeaders,
});
const openIdConfiguration = oauthProviderOpenIdConfigMetadata(auth, {
  headers: metadataHeaders,
});

app.get("/", (c) =>
  c.text(
    `Better Auth authorization server\nIssuer: ${authURL.href}\nMCP resource: ${resource}\n`
  )
);

// Better Auth's issuer contains a path, so expose both RFC 8414 discovery
// forms and the OIDC issuer-appended form before mounting its catch-all API.
app.get("/.well-known/oauth-authorization-server/api/auth", (c) =>
  authServerMetadata(c.req.raw)
);
app.get("/api/auth/.well-known/oauth-authorization-server", (c) =>
  authServerMetadata(c.req.raw)
);
app.get("/api/auth/.well-known/openid-configuration", (c) =>
  openIdConfiguration(c.req.raw)
);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/sign-in", (c) => c.html(signInPage));
app.get("/consent", (c) => c.html(consentPage));

serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
  console.log(`Better Auth: http://localhost:${boundPort}/api/auth`);
  console.log(`MCP resource: ${resource}`);
});

const signInPage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Anonymous sign in</title></head>
  <body>
    <main>
      <h1>Sign in anonymously</h1>
      <p>No email, password, or social provider is required.</p>
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
            body: JSON.stringify({
              oauth_query: window.location.search.slice(1),
            }),
          });
          const data = await response.json();

          if (response.ok && data.url) {
            window.location.replace(data.url);
            return;
          }

          error.textContent = data.message || 'Anonymous sign-in failed';
        } catch (cause) {
          error.textContent = cause instanceof Error
            ? cause.message
            : 'Anonymous sign-in failed';
        } finally {
          button.disabled = false;
        }
      });
    </script>
  </body>
</html>`;

const consentPage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Authorize MCP client</title></head>
  <body>
    <main>
      <h1>Authorize MCP client</h1>
      <p>The client is requesting access to this MCP server.</p>
      <button data-accept="false">Deny</button>
      <button data-accept="true">Allow</button>
      <p id="error" role="alert"></p>
    </main>
    <script>
      document.querySelectorAll('[data-accept]').forEach((button) => {
        button.addEventListener('click', async () => {
          const oauthQuery = window.location.search.slice(1);
          const response = await fetch('/api/auth/oauth2/consent', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              accept: button.dataset.accept === 'true',
              oauth_query: oauthQuery,
            }),
          });
          const data = await response.json();
          if (response.ok && data.url) {
            window.location.href = data.url;
            return;
          }
          document.querySelector('#error').textContent = data.message || 'Authorization failed';
        });
      });
    </script>
  </body>
</html>`;
