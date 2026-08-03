/**
 * Direct OAuth resource-server acceptance coverage using the official
 * @modelcontextprotocol/client transport against real local HTTP listeners.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
import { oauthWorkOSProvider } from "../src/oauth/workos.js";
import { listenFetch } from "./helpers/listen-fetch.js";

describe("direct OAuth authorization (official client e2e)", () => {
  it("completes WorkOS-style resource authorization and rejects its default audience", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const keyId = "direct-oauth-test-key";
    jwk.kid = keyId;

    let authorizationRequest: URL | undefined;
    let tokenRequest: URLSearchParams | undefined;
    const authorizationCode = "deterministic-authorization-code";
    const clientRedirectUrl = "http://client.localhost/callback";
    let resourceUrl = "";
    let authorizationIssuer = "";

    const authorizationFetch = async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname === "/oauth2/jwks" && request.method === "GET") {
        return Response.json({ keys: [jwk] });
      }
      if (url.pathname === "/oauth2/authorize" && request.method === "GET") {
        authorizationRequest = url;
        if (
          authorizationRequest.searchParams.get("client_id") !==
            "official-client" ||
          authorizationRequest.searchParams.get("resource") !== resourceUrl
        ) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
        const redirect = new URL(
          authorizationRequest.searchParams.get("redirect_uri") ??
            clientRedirectUrl
        );
        redirect.searchParams.set("code", authorizationCode);
        return Response.redirect(redirect.toString(), 302);
      }
      if (url.pathname === "/oauth2/token" && request.method === "POST") {
        tokenRequest = new URLSearchParams(await request.text());
        if (
          tokenRequest.get("grant_type") !== "authorization_code" ||
          tokenRequest.get("code") !== authorizationCode ||
          tokenRequest.get("client_id") !== "official-client" ||
          tokenRequest.get("resource") !== resourceUrl
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        const token = await new SignJWT({
          sub: "user_ada",
          client_id: "official-client",
          scope: "mcp tools:call",
        })
          .setProtectedHeader({ alg: "RS256", kid: keyId })
          .setIssuer(authorizationIssuer)
          .setAudience(resourceUrl)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        return Response.json({
          access_token: token,
          token_type: "Bearer",
          expires_in: 300,
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    const authorizationServer = await listenFetch(authorizationFetch);
    const authorizationUrl = authorizationServer.url;
    authorizationIssuer = new URL(authorizationUrl).href.replace(/\/$/, "");

    let mcpHandler: (request: Request) => Promise<Response> = async () =>
      new Response("starting", { status: 503 });
    const mcpHost = await listenFetch((request) => mcpHandler(request));
    resourceUrl = `${mcpHost.url}/mcp`;

    const server = new MCPServer({
      name: "direct-oauth-test",
      version: "1.0.0",
      oauth: oauthWorkOSProvider({
        subdomain: authorizationIssuer,
        resource: resourceUrl,
        scopesSupported: ["mcp", "tools:call"],
      }),
    });
    server.tool({ name: "whoami" }, async (_params, ctx) => ({
      content: [
        {
          type: "text",
          text: `${ctx.auth.user.id}:${ctx.auth.resource?.href ?? "unbound"}`,
        },
      ],
    }));
    mcpHandler = server.fetch;

    let client: Client | undefined;
    try {
      const challenge = await fetch(resourceUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(challenge.status).toBe(401);
      const challengeHeader = challenge.headers.get("www-authenticate");
      expect(challengeHeader).toContain("Bearer");
      const metadataUrl = new URL(
        challengeHeader?.match(/resource_metadata="([^"]+)"/)?.[1] ??
          (() => {
            throw new Error("missing resource_metadata challenge parameter");
          })()
      );
      expect(metadataUrl).toEqual(
        new URL(`${mcpHost.url}/.well-known/oauth-protected-resource/mcp`)
      );

      const metadataResponse = await fetch(metadataUrl);
      expect(metadataResponse.status).toBe(200);
      const metadata = (await metadataResponse.json()) as {
        authorization_servers: string[];
        resource: string;
      };
      expect(metadata.resource).toBe(resourceUrl);
      expect(metadata.authorization_servers).toEqual([authorizationIssuer]);

      const authorize = new URL("/oauth2/authorize", authorizationUrl);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: "official-client",
        redirect_uri: clientRedirectUrl,
        resource: metadata.resource,
        scope: "mcp tools:call",
      }).toString();
      const authorizationResponse = await fetch(authorize, {
        redirect: "manual",
      });
      expect(authorizationResponse.status).toBe(302);
      const code = new URL(
        authorizationResponse.headers.get("location") ?? ""
      ).searchParams.get("code");
      expect(code).toBe(authorizationCode);
      expect(authorizationRequest?.searchParams.get("resource")).toBe(
        resourceUrl
      );

      const exchange = await fetch(new URL("/oauth2/token", authorizationUrl), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code!,
          client_id: "official-client",
          redirect_uri: clientRedirectUrl,
          resource: metadata.resource,
        }),
      });
      expect(exchange.status).toBe(200);
      const { access_token: accessToken } = (await exchange.json()) as {
        access_token: string;
      };
      expect(tokenRequest?.get("resource")).toBe(resourceUrl);

      const defaultAudienceToken = await new SignJWT({
        sub: "user_ada",
        client_id: "official-client",
        scope: "mcp tools:call",
      })
        .setProtectedHeader({ alg: "RS256", kid: keyId })
        .setIssuer(authorizationIssuer)
        .setAudience(authorizationIssuer)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      const wrongAudience = await fetch(resourceUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${defaultAudienceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });
      expect(wrongAudience.status).toBe(401);
      expect(wrongAudience.headers.get("www-authenticate")).toContain(
        'error="invalid_token"'
      );

      client = new Client(
        { name: "official-client", version: "2.0.0-beta.3" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } }
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(resourceUrl), {
          authProvider: { token: async () => accessToken },
        })
      );
      expect(
        (await client.listTools()).tools.map((tool) => tool.name)
      ).toContain("whoami");
      const result = await client.callTool({ name: "whoami", arguments: {} });
      expect(result.content).toEqual([
        { type: "text", text: `user_ada:${resourceUrl}` },
      ]);
    } finally {
      await client?.close();
      await server.close();
      await mcpHost.close();
      await authorizationServer.close();
    }
  });
});
