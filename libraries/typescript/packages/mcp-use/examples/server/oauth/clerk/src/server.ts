/**
 * Clerk OAuth MCP Server Example
 *
 * This example demonstrates the OAuth integration with mcp-use using Clerk.
 * Learn more:
 * - Clerk JWT Verification: https://clerk.com/docs/backend-requests/handling/manual-jwt
 *
 * Environment variables:
 * - MCP_USE_OAUTH_CLERK_DOMAIN    (required) — e.g. my-app.clerk.accounts.dev
 */
import { MCPServer, error, object, oauthClerkProvider } from "mcp-use/server";

// Create MCP server with OAuth auto-configured from environment variables
const server = new MCPServer({
  name: "clerk-oauth-example",
  version: "1.0.0",
  description: "MCP server with Clerk OAuth authentication",
  // Zero-config: OAuth is fully configured via MCP_USE_OAUTH_* environment variables
  oauth: oauthClerkProvider(),
});

// Returns authenticated user information populated by the Clerk provider.
// Demonstrates reading standard claims and Clerk org claims from ctx.auth.user.

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
// Returns a personalized greeting for the authenticated user.
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

server.tool(
  {
    name: "require-email-scope",
    description: "Verify that the authenticated user has the email scope",
  },
  async (_args, ctx) => {
    if (!ctx.auth.scopes.includes("email")) {
      return error(
        `Missing required scope: email. Granted scopes: ${JSON.stringify(ctx.auth.scopes)}`
      );
    }

    return object({
      ok: true,
      scopes: ctx.auth.scopes,
      email: ctx.auth.user.email,
      userId: ctx.auth.user.userId,
    });
  }
);

server.listen().then(() => {
  console.log("Clerk OAuth MCP Server Running");
});
