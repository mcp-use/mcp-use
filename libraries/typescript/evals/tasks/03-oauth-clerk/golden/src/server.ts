import { MCPServer, oauthClerkProvider, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "clerk-protected-server",
  version: "1.0.0",
  description: "Golden solution for the Clerk-protected server eval task",
  // Zero-config: reads MCP_USE_OAUTH_CLERK_FRONTEND_API_URL and verifies
  // bearer JWTs against the instance's JWKS with an issuer check.
  oauth: oauthClerkProvider(),
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
