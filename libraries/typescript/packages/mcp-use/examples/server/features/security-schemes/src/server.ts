/**
 * securitySchemes example — SEP-1488 / OpenAI Apps SDK
 *
 * Each tool advertises its auth policy via `securitySchemes`, which lands as
 * a top-level field on the Tool object in `tools/list`. ChatGPT and other
 * SEP-1488–aware clients use this to decide which sign-in UI (if any) to
 * show before invoking the tool.
 *
 * Four tools cover the practical patterns:
 *   1. public_search   — `noauth` only (always anonymous).
 *   2. browse_catalog  — `noauth` + `oauth2` (works anonymously, richer when
 *                        signed in).
 *   3. create_doc      — `oauth2` required, returns authenticationRequired()
 *                        when called without a token.
 *   4. whoami          — `oauth2` required, returns the live token claims so
 *                        you can verify the anonymous sign-in worked.
 *
 * Auth is wired up with Supabase's OAuth 2.1 server. Supabase hosts
 * /authorize, /token, /register and .well-known discovery; this server hosts
 * the consent screen (and the anonymous sign-in that backs it). Configure the
 * consent URL in the Supabase Dashboard (Authentication → OAuth Server) to
 * point at http://localhost:3000/auth/consent and enable anonymous sign-ins
 * under Auth → Providers → Anonymous.
 *
 * Setup:
 *   1. pnpm install
 *   2. cp .env.example .env  # then fill in your Supabase project id + publishable key
 *   3. pnpm dev
 *   4. open http://localhost:3000/inspector
 *
 * Environment variables (see .env.example):
 *   - MCP_USE_OAUTH_SUPABASE_PROJECT_ID
 *   - MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY
 */

import {
  MCPServer,
  oauthSupabaseProvider,
  text,
  object,
  authenticationRequired,
} from "mcp-use/server";
import { z } from "zod";
import { mountAuthRoutes } from "./auth-routes.js";

declare const process: { env: Record<string, string | undefined> };

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

const RESOURCE_METADATA_URL =
  "http://localhost:3000/.well-known/oauth-protected-resource";

const server = new MCPServer({
  name: "security-schemes-example",
  version: "1.0.0",
  description:
    "Demonstrates tool-level securitySchemes (SEP-1488) with Supabase OAuth + anonymous sign-in",
  oauth: oauthSupabaseProvider(),
});

// Mount the consent + anonymous sign-in pages that Supabase redirects to
// after /authorize.
mountAuthRoutes(server, {
  projectId: SUPABASE_PROJECT_ID,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
});

// ---------------------------------------------------------------------------
// 1. Anonymous tool — securitySchemes: [{ type: "noauth" }]
// ---------------------------------------------------------------------------
server.tool(
  {
    name: "public_search",
    description: "Search public content (no sign-in required)",
    schema: z.object({ q: z.string().describe("Search query") }),
    securitySchemes: [{ type: "noauth" }],
  },
  async ({ q }) =>
    text(`public results for "${q}": [result-1, result-2, result-3]`)
);

// ---------------------------------------------------------------------------
// 2. Optional auth — works anonymously, richer when signed in
//    securitySchemes: [{ type: "noauth" }, { type: "oauth2", scopes: [...] }]
// ---------------------------------------------------------------------------
server.tool(
  {
    name: "browse_catalog",
    description:
      "Browse the catalog. Returns personalised picks when signed in, public listings otherwise.",
    schema: z.object({ q: z.string().describe("Catalog filter") }),
    securitySchemes: [
      { type: "noauth" },
      { type: "oauth2", scopes: ["catalog.read"] },
    ],
  },
  async ({ q }, ctx) => {
    if (ctx.auth) {
      return text(
        `personalised catalog for ${ctx.auth.user.email ?? ctx.auth.user.userId}: ${q} → [premium-A, premium-B]`
      );
    }
    return text(`anonymous catalog: ${q} → [public-X, public-Y]`);
  }
);

// ---------------------------------------------------------------------------
// 3. Auth-required tool — returns the SEP-1488 sign-in challenge when called
//    without a token. ChatGPT-style clients use this to launch their OAuth UI.
// ---------------------------------------------------------------------------
server.tool(
  {
    name: "create_doc",
    description: "Create a document (sign-in required)",
    schema: z.object({ title: z.string().describe("Document title") }),
    securitySchemes: [{ type: "oauth2", scopes: ["docs.write"] }],
  },
  async ({ title }, ctx) => {
    if (!ctx.auth) {
      return authenticationRequired({
        scopes: ["docs.write"],
        resourceMetadataUrl: RESOURCE_METADATA_URL,
        errorDescription: "Sign in to create documents",
      });
    }
    return text(
      `created doc "${title}" for ${ctx.auth.user.email ?? ctx.auth.user.userId}`
    );
  }
);

// ---------------------------------------------------------------------------
// 4. Whoami — handy for verifying the anonymous flow end-to-end
// ---------------------------------------------------------------------------
server.tool(
  {
    name: "whoami",
    description: "Return the authenticated user's token claims",
    schema: z.object({}),
    securitySchemes: [{ type: "oauth2", scopes: ["openid"] }],
  },
  async (_args, ctx) => {
    if (!ctx.auth) {
      return authenticationRequired({
        scopes: ["openid"],
        resourceMetadataUrl: RESOURCE_METADATA_URL,
      });
    }
    return object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
      scopes: ctx.auth.scopes,
    });
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen().then(() => {
  console.log("securitySchemes example running on http://localhost:3000");
  console.log("MCP Inspector: http://localhost:3000/inspector");
});
