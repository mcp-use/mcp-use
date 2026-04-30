/**
 * Clerk OAuth MCP Server Example
 *
 * This example demonstrates the OAuth integration with Clerk using mcp-use.
 * Learn more:
 * - Clerk OAuth: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth
 * - Clerk Organizations: https://clerk.com/docs/organizations/overview
 *
 * Environment variables:
 * - MCP_USE_OAUTH_CLERK_FRONTEND_API_URL (required) — your Clerk Frontend API URL
 */

import { MCPServer, oauthClerkProvider, error, object } from "mcp-use/server";

declare const process: { env: Record<string, string> };

// Create MCP server with OAuth auto-configured from environment variables!
const server = new MCPServer({
  name: "clerk-oauth-example",
  version: "1.0.0",
  description: "MCP server with Clerk OAuth authentication",
  // 🎉 Zero-config! OAuth is fully configured via MCP_USE_OAUTH_* environment variables
  oauth: oauthClerkProvider(),
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
    })
);

/**
 * Tool that demonstrates accessing authenticated user's roles and permissions
 */
server.tool(
  {
    name: "get-user-permissions",
    description: "Get the authenticated user's roles and permissions",
  },
  async (_args, ctx) =>
    object({
      roles: ctx.auth.user.roles || [],
      permissions: ctx.auth.user.permissions || [],
      scopes: ctx.auth.user.scopes || [],
    })
);

/**
 * Tool that demonstrates accessing Clerk organization context
 */
server.tool(
  {
    name: "get-organization-info",
    description: "Get the active organization for the authenticated user",
  },
  async (_args, ctx) => {
    const { org_id, org_role, org_slug } = ctx.auth.user as {
      org_id?: string;
      org_role?: string;
      org_slug?: string;
    };

    if (!org_id) {
      return error(
        "No active organization found. Ensure an organization is selected in Clerk."
      );
    }

    return object({ org_id, org_role, org_slug });
  }
);

server.listen().then(() => {
  console.log("Clerk OAuth MCP Server running");
});
