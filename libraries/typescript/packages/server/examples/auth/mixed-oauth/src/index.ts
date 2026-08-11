import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import type { MiddlewareHandler } from "hono";
import { MCPServer, getRequestBag, type FetchMiddleware } from "mcp-use";
import { bearerAuth, oauthMetadata } from "mcp-use/oauth";
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
  requiredScopes: [protectedScope],
  scopesSupported: [...demoScopes],
  resourceName: "mcp-use mixed OAuth demo",
});
const auth = createDemoAuth({ origin: origin.origin, resource: resource.href });

const server = new MCPServer({
  name: "mixed-oauth-demo",
  version: "1.0.0",
  description:
    "A local mcp-use v2 server with public discovery and one OAuth-protected tool.",
  cors: {
    origin: [origin.origin, "http://localhost:4173", "http://127.0.0.1:4173"],
    credentials: true,
  },
});

// Advertise RFC 9728 protected-resource metadata without installing the
// endpoint-wide OAuth gate from MCPServer({ oauth }). This distinction is what
// keeps initialize, tools/list, and public_ping anonymous.
server.use("*", honoAdapter(oauthMetadata(provider, resource)));

// Apply the official SDK bearer verifier only to the protected tools/call.
// A missing token therefore becomes a real HTTP 401 with resource_metadata in
// WWW-Authenticate, which lets an OAuth-capable client authenticate and retry.
server.use("/mcp", async (context, next) => {
  if (!(await isProtectedToolCall(context.req.raw))) {
    await next();
    return;
  }

  return bearerAuth(provider, resource)(context.req.raw, async () => {
    await next();
    return context.res;
  });
});

server.tool(
  {
    name: "public_ping",
    description: "Public tool that works before and after authentication.",
  },
  async () => ({
    content: [
      {
        type: "text",
        text: "Public pong. This request did not require OAuth.",
      },
    ],
  })
);

server.tool(
  {
    name: "protected_profile",
    description:
      "Protected tool that triggers OAuth and succeeds when the client retries with a bearer token.",
  },
  async () => ({
    content: [
      {
        type: "text",
        text: "Authenticated profile unlocked. The protected tool call resumed after OAuth.",
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
      <p><code>public_ping</code> is anonymous; <code>protected_profile</code> requires <code>${protectedScope}</code>.</p>
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

function honoAdapter(middleware: FetchMiddleware): MiddlewareHandler {
  return async (context, next) =>
    middleware(context.req.raw, async () => {
      await next();
      return context.res;
    });
}

async function isProtectedToolCall(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  let parsedBody = getRequestBag(request).parsedBody;
  if (parsedBody === undefined) {
    try {
      parsedBody = await request.clone().json();
    } catch {
      return false;
    }
  }
  const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
  return messages.some((message) => {
    if (message === null || typeof message !== "object") return false;
    const record = message as Record<string, unknown>;
    if (record["method"] !== "tools/call") return false;
    const params = record["params"];
    return (
      params !== null &&
      typeof params === "object" &&
      (params as Record<string, unknown>)["name"] === "protected_profile"
    );
  });
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
