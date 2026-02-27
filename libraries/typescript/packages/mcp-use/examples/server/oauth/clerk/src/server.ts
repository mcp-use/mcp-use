/**
 * Clerk OAuth MCP Server Example
 *
 * This example demonstrates the OAuth integration with mcp-use using Clerk.
 * Learn more:
 * - Clerk OIDC Discovery: https://clerk.com/docs/backend-requests/making/jwt-templates#oidc-discovery
 * - Clerk JWT Verification: https://clerk.com/docs/backend-requests/handling/manual-jwt
 *
 * Environment variables (zero-config setup):
 * - MCP_USE_OAUTH_CLERK_DOMAIN (required) — e.g. my-app.clerk.accounts.dev
 */

// @ts-nocheck
import { MCPServer, oauthClerkProvider, error, object } from "mcp-use/server";

// Create MCP server with OAuth auto-configured from environment variables!
const server = new MCPServer({
  name: "clerk-oauth-example",
  version: "1.0.0",
  description: "MCP server with Clerk OAuth authentication",
  // 🎉 Zero-config! OAuth is fully configured via MCP_USE_OAUTH_* environment variables
  oauth: oauthClerkProvider(),
});

// returns authenticated user information from the Clerk JWT.
//  Demonstrates reading standard claims (userId, email) as well as
//  Clerk-specific claims (org_id, org_role, org_permissions).

server.tool(
  {
    name: "get-user-info",
    description: "Get information about the authenticated Clerk user",
  },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
      picture: ctx.auth.user.picture,
      // present only if user belongs to an organization
      org_id: ctx.auth.user.org_id,
      org_role: ctx.auth.user.org_role,
      org_permissions: ctx.auth.user.org_permissions,

      permissions: ctx.auth.permissions,
      scopes: ctx.auth.scopes,
    })
);

// fetches the full user profile from Clerk's userinfo endpoint
// using the authenticated access token.
 
server.tool(
  {
    name: "get-clerk-user-profile",
    description: "Fetch user profile from Clerk using the authenticated token",
  },
  async (_args, ctx) => {
    try {
      const domain = process.env.MCP_USE_OAUTH_CLERK_DOMAIN;
      if (!domain) {
        return error("Clerk domain not configured");
      }

      const res = await fetch(`https://${domain}/oauth/userinfo`, {
        headers: {
          Authorization: `Bearer ${ctx.auth.accessToken}`,
        },
      });

      if (!res.ok) {
        return error(`Clerk userinfo request failed: ${res.status} ${res.statusText}`);
      }

      return object(await res.json());
    } catch (err) {
      return error(`Failed to fetch Clerk user profile: ${err}`);
    }
  }
);


// returns a personalized greeting for the authenticated user.
// Demonstrates a simple real-world use case for an authenticated MCP tool.
server.tool(
  {
    name: "get-user-greeting",
    description: "Get a personalized greeting for the authenticated user",
  },
  async (_args, ctx) => {
    const name = ctx.auth.user.name ?? ctx.auth.user.email ?? "there";
    return object({
      greeting: `Hello, ${name}! You are authenticated via Clerk.`,
      userId: ctx.auth.user.userId,
    });
  }
);

server.listen().then(() => {
  console.log("Clerk OAuth MCP Server Running");
});