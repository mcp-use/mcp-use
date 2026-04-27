/**
 * Keycloak OAuth MCP Server Example
 *
 * Uses Keycloak's native Dynamic Client Registration (RFC 7591). MCP clients
 * discover Keycloak via /.well-known metadata, register themselves, complete
 * the PKCE authorization flow, and send the resulting access token as a
 * bearer token on MCP requests — the MCP server only verifies the JWT.
 */

import { MCPServer, oauthKeycloakProvider, object } from "mcp-use/server";

declare const process: { env: Record<string, string | undefined> };

const serverUrl =
  process.env.MCP_USE_OAUTH_KEYCLOAK_SERVER_URL ?? "http://localhost:8080";
const realm = process.env.MCP_USE_OAUTH_KEYCLOAK_REALM ?? "demo";

const server = new MCPServer({
  name: "keycloak-oauth-example",
  version: "1.0.0",
  description: "MCP server with Keycloak OAuth authentication (DCR)",
  oauth: oauthKeycloakProvider({ serverUrl, realm }),
});

server.tool(
  {
    name: "get-user-info",
    description:
      "Return identity info extracted from the Keycloak access token",
  },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      username: ctx.auth.user.username,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
      roles: ctx.auth.user.roles,
      permissions: ctx.auth.permissions,
      scopes: ctx.auth.scopes,
    })
);

server.tool(
  {
    name: "get-keycloak-userinfo",
    description:
      "Fetch the full userinfo document from Keycloak using the token",
  },
  async (_args, ctx) => {
    const res = await fetch(
      `${serverUrl}/realms/${realm}/protocol/openid-connect/userinfo`,
      { headers: { Authorization: `Bearer ${ctx.auth.accessToken}` } }
    );
    return object(await res.json());
  }
);

server.listen().then(() => {
  console.log(
    `Keycloak OAuth MCP Server running (issuer: ${serverUrl}/realms/${realm})`
  );
});
