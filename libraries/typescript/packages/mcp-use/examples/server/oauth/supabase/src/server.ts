/**
 * Supabase OAuth MCP Server Example
 *
 * Uses Supabase's OAuth 2.1 server — Supabase hosts /authorize, /token,
 * /register and .well-known discovery, while this example hosts the consent
 * screen (which also triggers sign-in for unauthenticated users). Configure
 * the consent URL in the Supabase Dashboard (Authentication → OAuth Server)
 * to point at /auth/consent here.
 *
 * Anonymous sign-ins are used for zero-config sign-up — enable them in the
 * Supabase dashboard under Auth → Providers. See ./auth-routes.ts.
 *
 * Token verification is automatic: new Supabase projects sign tokens with
 * ES256 and publish a JWKS endpoint, which the provider fetches and caches.
 * No JWT secret configuration is required.
 *
 * Docs: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
 *
 * Environment variables:
 * - MCP_USE_OAUTH_SUPABASE_PROJECT_ID       (required)
 * - MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY  (required — used by the consent UI
 *                                            and by tools calling Supabase)
 */

import {
  MCPServer,
  oauthSupabaseProvider,
  error,
  object,
} from "mcp-use/server";
import { createClient } from "@supabase/supabase-js";
import { mountAuthRoutes } from "./auth-routes.js";

declare const process: { env: Record<string, string> };

const SUPABASE_PROJECT_ID = process.env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_PROJECT_ID) {
  throw new Error(
    "Missing MCP_USE_OAUTH_SUPABASE_PROJECT_ID environment variable"
  );
}
if (!SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY environment variable"
  );
}

const supabaseUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

const server = new MCPServer({
  name: "supabase-oauth-example",
  version: "1.0.0",
  description: "MCP server with Supabase OAuth authentication",
  oauth: oauthSupabaseProvider(),
});

// Mount the consent page that Supabase redirects to after /authorize.
mountAuthRoutes(server, {
  projectId: SUPABASE_PROJECT_ID,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
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
    name: "list-notes",
    description:
      "Fetch the user's notes from Supabase using their access token",
  },
  async (_args, ctx) => {
    const supabase = createClient(supabaseUrl, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${ctx.auth.accessToken}` },
      },
    });

    const { data, error: queryError } = await supabase.from("notes").select();

    if (queryError) {
      return error(`Failed to fetch notes: ${queryError.message}`);
    }

    return object({ notes: data ?? [] });
  }
);

server.listen().then(() => {
  console.log("Supabase OAuth MCP Server Running");
});
