import { MCPServer, oauthCustomProvider, text } from "mcp-use/server";
import { z } from "zod";

const ACCEPTED_TOKEN = process.env.MCP_AUTH_TOKEN || "dev-token";
const TOKEN_USER = "agent@example.com";

const server = new MCPServer({
  name: "authenticated-server",
  version: "1.0.0",
  description: "Golden solution for the bearer-authenticated server eval task",
  oauth: oauthCustomProvider({
    // Static-token verification: no OAuth flow is exercised, so the endpoint
    // URLs only need to satisfy the provider metadata.
    issuer: "http://localhost",
    authEndpoint: "http://localhost/authorize",
    tokenEndpoint: "http://localhost/token",
    verifyToken: async (token) => {
      if (token !== ACCEPTED_TOKEN) throw new Error("invalid bearer token");
      return { payload: { sub: TOKEN_USER, email: TOKEN_USER } };
    },
  }),
});

server.tool(
  {
    name: "whoami",
    description: "Return the authenticated user's identity",
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
