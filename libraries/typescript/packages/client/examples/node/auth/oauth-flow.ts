/**
 * Self-contained Node OAuth flow: discovery, DCR, PKCE loopback callback,
 * authorization-code exchange, and token persistence.
 *
 * No external identity provider or credentials are required.
 *
 *   pnpm exec tsx examples/node/auth/oauth-flow.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auth,
  NodeOAuthClientProvider,
} from "@mcp-use/client";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

let issuer = "";
const authServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", issuer || "http://127.0.0.1");
  response.setHeader("content-type", "application/json");

  if (url.pathname === "/.well-known/oauth-protected-resource") {
    response.end(
      JSON.stringify({ resource: issuer, authorization_servers: [issuer] })
    );
    return;
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    response.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      })
    );
    return;
  }
  if (url.pathname === "/register" && request.method === "POST") {
    const registration = JSON.parse(await readBody(request));
    response.end(
      JSON.stringify({
        client_id: "example-client",
        redirect_uris: registration.redirect_uris,
        token_endpoint_auth_method: "none",
      })
    );
    return;
  }
  if (url.pathname === "/authorize") {
    response.end(JSON.stringify({ consent: "would be shown here" }));
    return;
  }
  if (url.pathname === "/token" && request.method === "POST") {
    response.end(
      JSON.stringify({
        access_token: "example-access-token",
        refresh_token: "example-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
      })
    );
    return;
  }

  response.statusCode = 404;
  response.end("{}");
});

await new Promise<void>((resolve) =>
  authServer.listen(0, "127.0.0.1", resolve)
);
issuer = `http://127.0.0.1:${(authServer.address() as AddressInfo).port}`;
const baseDir = mkdtempSync(join(tmpdir(), "mcp-use-oauth-example-"));
let authorizationUrl = "";

try {
  const provider = await NodeOAuthClientProvider.create(issuer, {
    baseDir,
    preferredPort: 33618,
    authTimeoutMs: 5_000,
    openBrowser: (url) => {
      authorizationUrl = url;
      console.log("authorization URL:", url);
    },
  });

  const first = await auth(provider, { serverUrl: issuer });
  if (first !== "REDIRECT") throw new Error(`Expected REDIRECT, got ${first}`);

  const state = new URL(authorizationUrl).searchParams.get("state");
  if (!state) throw new Error("Authorization URL omitted state");

  await fetch(
    `http://127.0.0.1:${provider.callbackPort}/callback?code=example-code&state=${encodeURIComponent(state)}`
  );
  const code = await provider.getAuthorizationCode();
  const second = await auth(provider, {
    serverUrl: issuer,
    authorizationCode: code,
  });
  if (second !== "AUTHORIZED") {
    throw new Error(`Expected AUTHORIZED, got ${second}`);
  }

  const tokens = await provider.tokens();
  if (tokens?.access_token !== "example-access-token") {
    throw new Error("Token exchange failed");
  }
  console.log("OAuth flow complete:", tokens.token_type, tokens.expires_in);
} finally {
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
  rmSync(baseDir, { recursive: true, force: true });
}
