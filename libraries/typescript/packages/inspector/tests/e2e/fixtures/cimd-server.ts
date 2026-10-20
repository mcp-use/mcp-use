import { serve } from "@hono/node-server";
import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mountInspector } from "@mcp-use/inspector";
import { registerInspectorOAuthMetadata } from "../../../src/server/oauth-metadata.js";

/**
 * An OAuth/MCP fixture with strict redirect matching and PKCE validation.
 * Public metadata fetches are dispatched to the real Inspector route in
 * process, so the suite does not depend on a deployed metadata host.
 */
export async function startCimdFixture(
  mode: "cimd" | "dcr" | "static" = "cimd"
) {
  const app = new Hono();
  const metadataApp = new Hono();
  registerInspectorOAuthMetadata(metadataApp);
  registerInspectorOAuthMetadata(metadataApp, "/custom/mcp");
  const codes = new Map<
    string,
    { clientId: string; redirectUri: string; challenge: string }
  >();
  const clients = new Map<string, string[]>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Map<string, string>();
  const observations = {
    registrations: 0,
    metadataFetches: 0,
    tokenExchanges: 0,
    refreshes: 0,
    toolCalls: 0,
    clientId: "",
    redirectUri: "",
    scope: "",
  };

  app.use("*", cors({ origin: "*", exposeHeaders: ["WWW-Authenticate"] }));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
    c.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["read"],
    })
  );
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read"],
      // Static tests deliberately advertise CIMD too: the explicit ID must win.
      client_id_metadata_document_supported: mode !== "dcr",
      ...(mode === "dcr"
        ? { registration_endpoint: `${origin}/register` }
        : {}),
    })
  );
  app.post("/register", async (c) => {
    if (mode !== "dcr")
      return c.json({ error: "registration_not_supported" }, 404);
    const body = await c.req.json();
    observations.registrations++;
    clients.set("dcr-client", body.redirect_uris);
    return c.json({ ...body, client_id: "dcr-client" }, 201);
  });
  app.get("/authorize", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const clientId = params.get("client_id") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    let redirects = clients.get(clientId);
    if (clientId.startsWith("https://")) {
      observations.metadataFetches++;
      const response = await metadataApp.request(clientId);
      if (!response.ok) return c.text("Invalid metadata", 400);
      const document = await response.json();
      if (
        document.client_id !== clientId ||
        document.token_endpoint_auth_method !== "none"
      ) {
        return c.text("Invalid client identity", 400);
      }
      redirects = document.redirect_uris;
    }
    if (mode === "static" && clientId === "static-client")
      redirects = [redirectUri];
    if (
      !redirects?.includes(redirectUri) ||
      params.get("code_challenge_method") !== "S256" ||
      !params.get("code_challenge") ||
      !params.get("state")
    )
      return c.text("Invalid authorization request", 400);

    observations.clientId = clientId;
    observations.redirectUri = redirectUri;
    observations.scope = params.get("scope") ?? "";
    const code = randomUUID();
    codes.set(code, {
      clientId,
      redirectUri,
      challenge: params.get("code_challenge")!,
    });
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", params.get("state")!);
    callback.searchParams.set("iss", origin);
    return c.redirect(callback.href);
  });
  app.post("/token", async (c) => {
    const params = new URLSearchParams(await c.req.text());
    const clientId = params.get("client_id") ?? "";
    if (params.has("client_secret"))
      return c.json({ error: "invalid_client" }, 400);
    if (params.get("grant_type") === "refresh_token") {
      if (refreshTokens.get(params.get("refresh_token") ?? "") !== clientId) {
        return c.json({ error: "invalid_grant" }, 400);
      }
      observations.refreshes++;
    } else {
      const code = params.get("code") ?? "";
      const grant = codes.get(code);
      const challenge = createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !grant ||
        grant.clientId !== clientId ||
        grant.redirectUri !== params.get("redirect_uri") ||
        grant.challenge !== challenge
      )
        return c.json({ error: "invalid_grant" }, 400);
      codes.delete(code);
      observations.tokenExchanges++;
    }
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    accessTokens.add(accessToken);
    refreshTokens.set(refreshToken, clientId);
    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: "read",
    });
  });
  app.all("/mcp", async (c) => {
    if (
      !accessTokens.has(
        c.req.header("authorization")?.replace(/^Bearer /, "") ?? ""
      )
    ) {
      c.header(
        "WWW-Authenticate",
        `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
      );
      return c.json({ error: "unauthorized" }, 401);
    }
    if (c.req.method !== "POST") return c.body(null, 405);
    const request = await c.req.json();
    if (request.id === undefined) return c.body(null, 202);
    let result: unknown = {};
    if (request.method === "initialize") {
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "CIMD test server", version: "1.0.0" },
      };
    } else if (request.method === "tools/list") {
      result = {
        tools: [
          {
            name: "verify_auth",
            description: "Verify authentication",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };
    } else if (request.method === "tools/call") {
      observations.toolCalls++;
      result = {
        content: [{ type: "text", text: "Authenticated tool call succeeded" }],
      };
    }
    return c.json({ jsonrpc: "2.0", id: request.id, result });
  });

  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    mcpUrl: `${origin}/mcp`,
    observations,
    expireAccessTokens: () => accessTokens.clear(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Serve the installed package on an ephemeral port with a custom mount path. */
export async function startInspectorFixture(basePath: string) {
  const server = serve({
    fetch: mountInspector({
      basePath,
      autoConnectUrl: null,
      oauthProxyAllowLoopback: true,
    }),
    port: 0,
    hostname: "127.0.0.1",
  });
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No Inspector port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
