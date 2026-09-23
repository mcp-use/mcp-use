import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { MCPServer, type OAuthAuth } from "mcp-use";
import {
  oauthBetterAuthProvider,
  type BetterAuthOAuthUser,
} from "mcp-use/oauth/better-auth";
import { z } from "zod";

import { createDemoAuth, demoScopes } from "./auth.js";
import { consentPage, homePage, signInPage } from "./pages.js";

// Set MCP_URL to a public origin, such as the `mcp-use dev --tunnel` URL, to
// test in Claude or ChatGPT. The authorization server and the MCP resource
// both live on this origin.
const port = Number(process.env["PORT"] ?? 3000);
const origin = new URL(process.env["MCP_URL"] ?? `http://localhost:${port}`);
const resource = new URL("/mcp", origin);
const authURL = new URL("/api/auth", origin);

// The provider baseline every sign-in call must carry. Set REQUIRED_SCOPES to
// an empty string to run without one, or to a space- or comma-separated list.
const requiredScopes = (process.env["REQUIRED_SCOPES"] ?? "demo:protected")
  .split(/[\s,]+/)
  .filter(Boolean);

const provider = oauthBetterAuthProvider({
  authURL,
  resource,
  requiredScopes,
  scopesSupported: [...demoScopes],
  resourceName: "mcp-use mixed OAuth demo",
});
const auth = createDemoAuth({ origin: origin.origin, resource: resource.href });

// `oauth` publishes RFC 9728 discovery metadata and verifies bearer tokens.
// `mixedAuth` lets anyone connect and list tools, resources, and prompts
// before signing in. It does not make anything public: each item's `auth`
// decides who can use it.
const server = new MCPServer({
  name: "mixed-oauth-demo",
  version: "1.0.0",
  description:
    "A local mcp-use server with public, optional, and sign-in tools, resources, and prompts.",
  oauth: provider,
  mixedAuth: true,
  cors: {
    origin: [origin.origin, "http://localhost:4173", "http://127.0.0.1:4173"],
    credentials: true,
  },
});

type DemoAuth = OAuthAuth<BetterAuthOAuthUser> | undefined;

/** Describe the caller so every response shows what the server saw. */
function caller(auth: DemoAuth): string {
  if (auth === undefined) return "signed out";
  const scopes = auth.scopes.length > 0 ? auth.scopes.join(" ") : "none";
  return `signed in as ${auth.user.id} (token scopes: ${scopes})`;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

const cardSchema = z.object({
  title: z.string(),
  caller: z.string(),
  scopes: z.array(z.string()),
});

// --- Tools: one per `auth` value, plus a view-bound tool on each side. ----

server.tool(
  {
    name: "public_ping",
    description: "Public tool. Works before and after sign-in.",
    auth: "public",
  },
  async (_args, ctx) => text(`public_ping: ${caller(ctx.auth)}`)
);

server.tool(
  {
    name: "optional_whoami",
    description:
      "Optional tool. Runs for everyone and reports who the server thinks is calling and which scopes the token carries.",
    auth: "optional",
  },
  async (_args, ctx) => text(`optional_whoami: ${caller(ctx.auth)}`)
);

server.tool(
  {
    name: "optional_welcome",
    description:
      "Optional tool that advertises the profile scope. Personalized only when the token carries profile; never refused for a missing scope.",
    auth: { optional: true, scopes: ["profile"] },
  },
  async (_args, ctx) =>
    text(
      ctx.auth?.scopes.includes("profile")
        ? `optional_welcome: welcome back, ${ctx.auth.user.name ?? ctx.auth.user.id}`
        : `optional_welcome: generic greeting (${caller(ctx.auth)})`
    )
);

server.tool(
  {
    name: "protected_profile",
    description:
      "Sign-in tool. Omits auth, so it needs a token with the provider's required scopes.",
  },
  async (_args, ctx) => text(`protected_profile: ${caller(ctx.auth)}`)
);

server.tool(
  {
    name: "protected_update_profile",
    description:
      "Sign-in tool that also needs the profile scope. A token without it gets a scope step-up challenge.",
    auth: { scopes: ["profile"] },
  },
  async (_args, ctx) => text(`protected_update_profile: ${caller(ctx.auth)}`)
);

export const publicCard = server.tool(
  {
    name: "public_card",
    description:
      "Public tool with a view. The view resource can be read signed out.",
    auth: "public",
    outputSchema: cardSchema,
    view: { name: "public-card", description: "Card from a public tool" },
  },
  async (_args, ctx) => ({
    ...text(`public_card: ${caller(ctx.auth)}`),
    structuredContent: {
      title: "Public card",
      caller: caller(ctx.auth),
      scopes: ctx.auth?.scopes ?? [],
    },
  })
);

export const protectedCard = server.tool(
  {
    name: "protected_card",
    description:
      "Sign-in tool with a view. Reading the view resource needs the provider's required scopes.",
    outputSchema: cardSchema,
    view: { name: "protected-card", description: "Card from a sign-in tool" },
  },
  async (_args, ctx) => ({
    ...text(`protected_card: ${caller(ctx.auth)}`),
    structuredContent: {
      title: "Protected card",
      caller: caller(ctx.auth),
      scopes: ctx.auth.scopes,
    },
  })
);

// --- Resources and resource templates. ------------------------------------

server.resource(
  { name: "public_catalog", uri: "demo://public/catalog", auth: "public" },
  async (uri, ctx) => ({
    contents: [{ uri: uri.href, text: `public_catalog: ${caller(ctx.auth)}` }],
  })
);

server.resource(
  {
    name: "optional_greeting",
    uri: "demo://optional/greeting",
    auth: "optional",
  },
  async (uri, ctx) => ({
    contents: [
      { uri: uri.href, text: `optional_greeting: ${caller(ctx.auth)}` },
    ],
  })
);

server.resource(
  { name: "protected_profile", uri: "demo://protected/profile" },
  async (uri, ctx) => ({
    contents: [
      { uri: uri.href, text: `protected_profile: ${caller(ctx.auth)}` },
    ],
  })
);

server.resourceTemplate(
  {
    name: "public_item",
    uriTemplate: "demo://public/items/{id}",
    auth: "public",
    complete: { id: ["1", "2", "3"] },
  },
  async (uri, { id }, ctx) => ({
    contents: [
      { uri: uri.href, text: `public_item ${String(id)}: ${caller(ctx.auth)}` },
    ],
  })
);

server.resourceTemplate(
  {
    name: "protected_note",
    uriTemplate: "demo://protected/notes/{id}",
    auth: { scopes: ["email"] },
    complete: { id: ["1", "2", "3"] },
  },
  async (uri, { id }, ctx) => ({
    contents: [
      {
        uri: uri.href,
        text: `protected_note ${String(id)}: ${caller(ctx.auth)}`,
      },
    ],
  })
);

// --- Prompts. -------------------------------------------------------------

function prompt(value: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: value },
      },
    ],
  };
}

server.prompt(
  { name: "public_tips", description: "Public prompt.", auth: "public" },
  async (_args, ctx) => prompt(`public_tips: ${caller(ctx.auth)}`)
);

server.prompt(
  {
    name: "optional_greeting",
    description: "Optional prompt, personalized when signed in.",
    auth: "optional",
  },
  async (_args, ctx) => prompt(`optional_greeting: ${caller(ctx.auth)}`)
);

server.prompt(
  {
    name: "protected_summary",
    description: "Sign-in prompt with the provider's required scopes.",
  },
  async (_args, ctx) => prompt(`protected_summary: ${caller(ctx.auth)}`)
);

// --- Authorization server routes. -----------------------------------------

const authServerMetadata = oauthProviderAuthServerMetadata(auth);
const openIdConfiguration = oauthProviderOpenIdConfigMetadata(auth);

// Better Auth uses a pathful issuer. Expose both RFC 8414 discovery forms and
// its issuer-appended OIDC form so SDK discovery works in every supported era.
server.get("/.well-known/oauth-authorization-server/api/auth", (context) =>
  authServerMetadata(context.req.raw)
);
server.get("/api/auth/.well-known/oauth-authorization-server", (context) =>
  authServerMetadata(context.req.raw)
);
server.get("/api/auth/.well-known/openid-configuration", (context) =>
  openIdConfiguration(context.req.raw)
);

// Better Auth only lets a client request scopes it registered with. Hosts
// often register with the first challenge's scopes, which would make every
// later scope step-up fail with invalid_scope. Register every client for all
// demo scopes so step-up always works; the consent page still decides what
// each token gets.
server.post("/api/auth/oauth2/register", async (context) => {
  const request = context.req.raw;
  const body = (await request.json()) as Record<string, unknown>;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return auth.handler(
    new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, scope: demoScopes.join(" ") }),
    })
  );
});
server.all("/api/auth/*", (context) => auth.handler(context.req.raw));

server.get("/sign-in", (context) => context.html(signInPage));
server.get("/consent", (context) => context.html(consentPage));
server.get("/", (context) =>
  context.html(homePage({ endpoint: resource.href, requiredScopes }))
);

export default server;
