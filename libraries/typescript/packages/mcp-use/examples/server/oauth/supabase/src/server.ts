/**
 * Supabase OAuth MCP Server Example
 *
 * This example demonstrates the OAuth integration with mcp-use.
 * Learn more:
 * - Supabase OAuth: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
 *
 * Environment variables (zero-config setup):
 * - MCP_USE_OAUTH_SUPABASE_PROJECT_ID (required)
 * - MCP_USE_OAUTH_SUPABASE_JWT_SECRET (optional, but recommended)
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY (for API calls)
 */

import {
  createMCPServer,
  oauthSupabaseProvider,
  error,
  object,
} from "mcp-use/server";

declare const process: { env: Record<string, string> };

// Anon key for Supabase API calls (not used for OAuth configuration)
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable");
}

// Create MCP server with OAuth auto-configured from environment variables!
const server = createMCPServer("supabase-oauth-example", {
  version: "1.0.0",
  description: "MCP server with Supabase OAuth authentication",
  // 🎉 Zero-config! OAuth is fully configured via MCP_USE_OAUTH_* environment variables
  oauth: oauthSupabaseProvider(),
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
    })
);

/**
 * Tool that demonstrates making authenticated API calls to Supabase
 */
server.tool(
  {
    name: "get-supabase-data",
    description:
      "Fetch user profile from Supabase using the authenticated token",
  },
  async (_args, ctx) => {
    try {
      // Extract project ID from the authenticated user context or environment
      const projectId = process.env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID;

      if (!projectId) {
        return error("Project ID not configured");
      }

      const res = await fetch(
        `https://${projectId}.supabase.co/rest/v1/notes`,
        {
          headers: {
            Authorization: `Bearer ${ctx.auth.accessToken}`,
            apikey: SUPABASE_ANON_KEY,
          },
        }
      );
      return object(await res.json());
    } catch (err) {
      return error(`Failed to fetch notes: ${err}`);
    }
  }
);

server.listen().then(() => {
  console.log("Supabase OAuth MCP Server Running");
});
