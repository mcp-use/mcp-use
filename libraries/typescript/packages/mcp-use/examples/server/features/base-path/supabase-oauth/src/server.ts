/**
 * basePath + Supabase OAuth example.
 *
 * Identical to `examples/server/oauth/supabase`, but with `basePath: "/api"`.
 * The point of this example is to show that every OAuth surface — the bearer-
 * protected `/mcp` endpoint, the `/authorize`, `/token`, `/register` endpoints,
 * and the `/.well-known/oauth-protected-resource` / `oauth-authorization-server`
 * discovery documents — moves under the basePath automatically, with no extra
 * configuration on the server side.
 *
 * Routes exposed by this server:
 *   /api/mcp                                 - MCP transport (bearer-protected)
 *   /api/authorize, /api/token, /api/register - OAuth proxy endpoints
 *   /api/auth/consent                         - Consent UI (configure in Supabase)
 *   /api/auth/signin                          - Anonymous sign-in (demo)
 *   /.well-known/oauth-authorization-server/api   - RFC 8414 §3.1 path-aware
 *   /.well-known/oauth-protected-resource/api/mcp - RFC 9728 §3.1 path-aware
 *
 * Configure Supabase Dashboard → Authentication → OAuth Server → consent URL:
 *   http://localhost:3000/api/auth/consent
 *
 * Environment variables:
 * - MCP_USE_OAUTH_SUPABASE_PROJECT_ID       (required)
 * - MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY  (required)
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
  name: "base-path-supabase-oauth-example",
  version: "1.0.0",
  description: "Supabase OAuth MCP server mounted under /api",
  basePath: "/api",
  oauth: oauthSupabaseProvider(),
});

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

await server.listen();
