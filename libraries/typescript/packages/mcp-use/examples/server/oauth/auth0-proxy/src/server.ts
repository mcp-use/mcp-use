/**
 * Auth0 OAuth Proxy MCP Server Example
 *
 * This example demonstrates OAuth proxy mode where the MCP server
 * proxies OAuth requests to Auth0, injecting the client credentials
 * server-side. The client never sees the client secret.
 *
 * Environment variables:
 * - AUTH0_DOMAIN (required) - Your Auth0 tenant domain
 * - AUTH0_AUDIENCE (required) - Your Auth0 API audience
 * - AUTH0_CLIENT_ID (required) - OAuth client ID from Auth0 dashboard
 * - AUTH0_CLIENT_SECRET (required) - OAuth client secret from Auth0 dashboard
 */

// @ts-nocheck
import { MCPServer, oauthAuth0Provider, error, object } from "mcp-use/server";

declare const process: { env: Record<string, string> };

const server = new MCPServer({
  name: "auth0-proxy-example",
  version: "1.0.0",
  description: "MCP server with Auth0 OAuth proxy authentication",
  oauth: oauthAuth0Provider({
    domain: process.env.AUTH0_DOMAIN,
    audience: process.env.AUTH0_AUDIENCE,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    mode: "proxy",
  }),
});

/**
 * Tool that returns authenticated user information from JWT
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
      nickname: ctx.auth.user.nickname,
      picture: ctx.auth.user.picture,
      permissions: ctx.auth.permissions,
      scopes: ctx.auth.scopes,
    })
);

/**
 * Tool that demonstrates making authenticated API calls to Auth0
 */
server.tool(
  {
    name: "get-auth0-user-profile",
    description: "Fetch user profile from Auth0 using the authenticated token",
  },
  async (_args, ctx) => {
    try {
      const domain = process.env.AUTH0_DOMAIN;

      if (!domain) {
        return error("Auth0 domain not configured");
      }

      const res = await fetch(`https://${domain}/userinfo`, {
        headers: {
          Authorization: `Bearer ${ctx.auth.accessToken}`,
        },
      });
      return object(await res.json());
    } catch (err) {
      return error(`Failed to fetch user profile: ${err}`);
    }
  }
);

server.listen().then(() => {
  console.log("Auth0 OAuth Proxy MCP Server Running");
});
