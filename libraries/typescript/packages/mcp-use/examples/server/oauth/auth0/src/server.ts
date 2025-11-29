/**
 * Auth0 OAuth MCP Server Example
 *
 * This example demonstrates the OAuth integration with mcp-use.
 * Learn more:
 * - Auth0 MCP Setup: https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server
 * 
 * Environment variables (zero-config setup):
 * - MCP_USE_OAUTH_AUTH0_DOMAIN (required)
 * - MCP_USE_OAUTH_AUTH0_AUDIENCE (required)
 */

// @ts-nocheck
import { createMCPServer, oauthAuth0Provider, error, object } from "mcp-use/server";

declare const process: { env: Record<string, string> };

// Create MCP server with OAuth auto-configured from environment variables!
const server = createMCPServer("auth0-oauth-example", {
  version: "1.0.0",
  description: "MCP server with Auth0 OAuth authentication",
  // 🎉 Zero-config! OAuth is fully configured via MCP_USE_OAUTH_* environment variables
  oauth: oauthAuth0Provider()
});

/**
 * Tool that returns authenticated user information from JWT
 */
server.tool({
  name: "get-user-info",
  description: "Get information about the authenticated user",
}, async (_args, ctx) => object({
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
server.tool({
  name: "get-auth0-user-profile",
  description: "Fetch user profile from Auth0 using the authenticated token",
}, async (_args, ctx) => {
  try {
    const domain = process.env.MCP_USE_OAUTH_AUTH0_DOMAIN;
    
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
});

server.listen().then(() => {
  console.log("Auth0 OAuth MCP Server Running");
});
