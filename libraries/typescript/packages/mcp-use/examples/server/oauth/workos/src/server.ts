/**
 * WorkOS AuthKit OAuth MCP Server Example
 *
 * This example demonstrates the OAuth integration with WorkOS AuthKit using mcp-use.
 * Learn more:
 * - WorkOS MCP: https://workos.com/docs/authkit/mcp
 * - WorkOS AuthKit: https://workos.com/docs/authkit
 *
 * Environment variables (zero-config setup):
 * - MCP_USE_OAUTH_WORKOS_SUBDOMAIN (required)
 * - MCP_USE_OAUTH_WORKOS_CLIENT_ID (optional)
 * - MCP_USE_OAUTH_WORKOS_API_KEY (optional, but needed for API calls)
 */

import {
  createMCPServer,
  oauthWorkOSProvider,
  error,
  object,
} from "mcp-use/server";

declare const process: { env: Record<string, string> };

// WorkOS API key for making API calls (not used for OAuth configuration)
const WORKOS_API_KEY = process.env.MCP_USE_OAUTH_WORKOS_API_KEY;

if (!WORKOS_API_KEY) {
  console.warn(
    "Warning: MCP_USE_OAUTH_WORKOS_API_KEY not set. API calls will fail."
  );
}

// Create MCP server with OAuth auto-configured from environment variables!
const server = createMCPServer("workos-oauth-example", {
  version: "1.0.0",
  description: "MCP server with WorkOS AuthKit OAuth authentication",
  // 🎉 Zero-config! OAuth is fully configured via MCP_USE_OAUTH_* environment variables
  oauth: oauthWorkOSProvider(),
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
      organizationId: ctx.auth.user.organization_id,
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
 * Tool that demonstrates making authenticated API calls to WorkOS
 */
server.tool(
  {
    name: "get-workos-user",
    description: "Fetch user profile from WorkOS using the authenticated token",
  },
  async (_args, ctx) => {
    try {
      const res = await fetch(
        `https://api.workos.com/user_management/users/${ctx.auth.user.userId}`,
        {
          headers: {
            Authorization: `Bearer ${WORKOS_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!res.ok) {
        return error(
          `Failed to fetch user from WorkOS: ${res.status} ${res.statusText}`
        );
      }

      return object(await res.json());
    } catch (err) {
      return error(`Failed to fetch user profile: ${err}`);
    }
  }
);

server.listen().then(() => {
  const subdomain = process.env.MCP_USE_OAUTH_WORKOS_SUBDOMAIN;
  console.log("WorkOS OAuth MCP Server Running");
  if (subdomain) {
    // [SECURITY] Subdomain value is not logged to avoid leaking sensitive information.
  }
});
