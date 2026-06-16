import {
  MCPServer,
  jwksVerifier,
  oauthCustomProvider,
  text,
} from "mcp-use/server";
import { z } from "zod";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

const issuer = env("OAUTH_ISSUER");
const jwksUrl = env("OAUTH_JWKS_URL");
const audience = env("OAUTH_AUDIENCE");

const server = new MCPServer({
  name: "custom-idp-server",
  version: "1.0.0",
  description: "Golden solution for the custom OIDC IdP eval task",
  oauth: oauthCustomProvider({
    issuer,
    authEndpoint: env("OAUTH_AUTH_ENDPOINT"),
    tokenEndpoint: env("OAUTH_TOKEN_ENDPOINT"),
    jwksUrl,
    audience,
    // RS256 signature against the IdP's JWKS + iss/aud claim checks
    verifyToken: jwksVerifier({ jwksUrl, issuer, audience }),
  }),
});

server.tool(
  {
    name: "whoami",
    description: "Return the authenticated user's user id",
    schema: z.object({}),
  },
  async (_params, ctx) =>
    text(`You are ${ctx.auth?.user?.userId ?? "unauthenticated"}`)
);

server.tool(
  {
    name: "add",
    description: "Add two numbers and return the sum",
    schema: z.object({
      a: z.number().describe("First addend"),
      b: z.number().describe("Second addend"),
    }),
  },
  async ({ a, b }) => text(String(a + b))
);

// listen() resolves the port from PORT env (default 3000)
await server.listen();
