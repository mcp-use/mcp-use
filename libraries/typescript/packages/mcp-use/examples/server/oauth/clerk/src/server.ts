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
    description: "Fetch full user profile from Clerk",
  },
  async (_args, ctx) => {
    try {
      const domain = process.env.MCP_USE_OAUTH_CLERK_DOMAIN;
      if (!domain) return error("MCP_USE_OAUTH_CLERK_DOMAIN is not set");

      const token = ctx.auth.accessToken as string;

      // Opaque OAuth tokens (oat_...) — issued to real MCP clients.
      // Call /oauth/userinfo directly with the token.
      if (token.startsWith("oat_")) {
        const res = await fetch(`https://${domain}/oauth/userinfo`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return error(`Clerk userinfo failed: ${res.status} ${res.statusText}`);
        return object(await res.json());
      }

      // JWT session tokens — issued in Inspector / browser flows.
      // Use Clerk Backend API to fetch full user profile by sub (user ID).
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) {
        return error(
          "CLERK_SECRET_KEY is not set. Add it to .env to fetch full user profiles in Inspector/browser flows. " +
          "Real MCP clients (Cursor, Claude Code) receive oat_ tokens which work without a secret key."
        );
      }

      const userId = ctx.auth.user.userId;
      const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) return error(`Clerk API request failed: ${res.status} ${res.statusText}`);

      const user = await res.json();
      return object({
        id:             user.id,
        email:          user.email_addresses?.[0]?.email_address,
        email_verified: user.email_addresses?.[0]?.verification?.status === "verified",
        first_name:     user.first_name,
        last_name:      user.last_name,
        name:           [user.first_name, user.last_name].filter(Boolean).join(" ") || undefined,
        username:       user.username,
        picture:        user.image_url,
        created_at:     user.created_at ? new Date(user.created_at).toISOString() : undefined,
        last_sign_in:   user.last_sign_in_at ? new Date(user.last_sign_in_at).toISOString() : undefined,
        public_metadata: user.public_metadata,
      });
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