/**
 * Sign-in aware tools example — SEP-1488 / OpenAI Apps SDK
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
 * Auth is wired up with WorkOS AuthKit. WorkOS handles Dynamic Client
 * Registration, login, consent, and token issuance; this MCP server verifies
 * WorkOS-issued bearer tokens and surfaces the decoded user info on `ctx.auth`.
 *
 * Setup:
 *   1. pnpm install
 *   2. cp .env.example .env  # set MCP_USE_OAUTH_WORKOS_SUBDOMAIN
 *   3. pnpm dev
 *   4. open http://localhost:3000/inspector
 *
 * Environment variables (see .env.example):
 *   - MCP_USE_OAUTH_WORKOS_SUBDOMAIN or WORKOS_AUTH_KIT_URL
 */

import {
  MCPServer,
  oauthWorkOSProvider,
  text,
  object,
  authenticationRequired,
} from "mcp-use/server";
import { z } from "zod";

const SIGN_IN_SCOPE = "openid";
const OAUTH_SCOPES = ["email", "offline_access", SIGN_IN_SCOPE, "profile"];

function getResourceMetadataUrl(ctx: { req?: { url: string } }): string {
  const baseUrl = normalizeLocalOrigin(
    process.env.MCP_URL ?? getRequestOrigin(ctx)
  );
  return `${baseUrl.replace(/\/+$/, "")}/.well-known/oauth-protected-resource/mcp`;
}

function getRequestOrigin(ctx: { req?: { url: string } }): string {
  if (!ctx.req) return "http://localhost:3000";
  return new URL(ctx.req.url).origin;
}

function normalizeLocalOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") {
    url.hostname = "localhost";
  }
  return url.origin;
}

function getWorkOSSubdomain(): string {
  const configured =
    process.env.MCP_USE_OAUTH_WORKOS_SUBDOMAIN ??
    process.env.WORKOS_AUTH_KIT_URL;

  if (!configured) {
    throw new Error(
      "WorkOS AuthKit domain is required. Set MCP_USE_OAUTH_WORKOS_SUBDOMAIN or WORKOS_AUTH_KIT_URL."
    );
  }

  try {
    return new URL(configured).host;
  } catch {
    return configured;
  }
}

const server = new MCPServer({
  name: "sign-in-aware-tools-example",
  version: "1.0.0",
  description:
    "Demonstrates public, optional-auth, and auth-required MCP tools",
  oauth: oauthWorkOSProvider({
    subdomain: getWorkOSSubdomain(),
    scopesSupported: OAUTH_SCOPES,
  }),
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
// 2. Optional auth — works anonymously, richer when signed in.
//    WorkOS AuthKit advertises OIDC scopes by default, so this demo uses
//    `openid` as the sign-in scope instead of custom API scopes.
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
      { type: "oauth2", scopes: [SIGN_IN_SCOPE] },
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
    securitySchemes: [{ type: "oauth2", scopes: [SIGN_IN_SCOPE] }],
  },
  async ({ title }, ctx) => {
    if (!ctx.auth) {
      return authenticationRequired({
        scopes: [SIGN_IN_SCOPE],
        resourceMetadataUrl: getResourceMetadataUrl(ctx),
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
    securitySchemes: [{ type: "oauth2", scopes: [SIGN_IN_SCOPE] }],
  },
  async (_args, ctx) => {
    if (!ctx.auth) {
      return authenticationRequired({
        scopes: [SIGN_IN_SCOPE],
        resourceMetadataUrl: getResourceMetadataUrl(ctx),
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
  console.log("Sign-in aware tools example running on http://localhost:3000");
  console.log("MCP Inspector: http://localhost:3000/inspector");
});
