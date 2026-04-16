/**
 * Supabase OAuth MCP Server Example
 *
 * Uses Supabase's OAuth 2.1 server — Supabase hosts /authorize, /token,
 * /register and discovery, while this example hosts the consent screen
 * (which also triggers sign-in for unauthenticated users). Configure the
 * consent URL in the Supabase Dashboard to point to /auth/consent here.
 *
 * Anonymous sign-ins are used for zero-config sign-up — enable them in the
 * Supabase dashboard under Auth → Providers. See ./auth-routes.ts.
 *
 * Docs: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
 *
 * Environment variables:
 * - MCP_USE_OAUTH_SUPABASE_PROJECT_ID (required)
 * - MCP_USE_OAUTH_SUPABASE_JWT_SECRET (optional, recommended)
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY (required — used for auth and API calls)
 */

import {
  MCPServer,
  oauthSupabaseProvider,
  error,
  object,
} from "mcp-use/server";
import { mountAuthRoutes } from "./auth-routes.js";

declare const process: { env: Record<string, string> };

const SUPABASE_PROJECT_ID = process.env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_PROJECT_ID) {
  throw new Error(
    "Missing MCP_USE_OAUTH_SUPABASE_PROJECT_ID environment variable"
  );
}
if (!SUPABASE_ANON_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable");
}

const server = new MCPServer({
  name: "supabase-oauth-example",
  version: "1.0.0",
  description: "MCP server with Supabase OAuth authentication",
  oauth: oauthSupabaseProvider(),
});

// Mount the consent page that Supabase redirects to after /authorize.
mountAuthRoutes(server, {
  projectId: SUPABASE_PROJECT_ID,
  anonKey: SUPABASE_ANON_KEY,
});

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

server.tool(
  {
    name: "get-supabase-data",
    description:
      "Fetch user profile from Supabase using the authenticated token",
  },
  async (_args, ctx) => {
    try {
      const res = await fetch(
        `https://${SUPABASE_PROJECT_ID}.supabase.co/rest/v1/notes`,
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
