import { MCPServer, markdown, object, oauthProxy, text } from "mcp-use/server";
import { z } from "zod";

const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.MCP_URL || `http://localhost:${port}`;
const demoToken = process.env.DEMO_ACCESS_TOKEN || "demo-token";

const server = new MCPServer({
  name: "public-landing-page-example",
  title: "Public Landing Page Example",
  version: "1.0.0",
  description:
    "An OAuth-protected MCP server whose browser landing page remains public.",
  baseUrl,
  publicLandingPage: true,
  oauth: oauthProxy({
    issuer: "https://example.com/demo-oauth",
    authEndpoint: "https://example.com/demo-oauth/authorize",
    tokenEndpoint: "https://example.com/demo-oauth/token",
    clientId: "public-landing-page-example",
    scopes: ["openid", "profile", "read:demo"],
    verifyToken: async (token: string) => {
      if (token !== demoToken) {
        throw new Error("Invalid demo token");
      }

      return {
        payload: {
          sub: "demo-user",
          name: "Demo User",
          scope: "openid profile read:demo",
        },
      };
    },
  }),
});

server.tool(
  {
    name: "landing-status",
    description: "Show whether the protected MCP API is reachable.",
  },
  async () =>
    object({
      ok: true,
      message: "Authenticated MCP protocol traffic can reach this tool.",
    })
);

server.resource(
  {
    name: "landing-guide",
    uri: "app://public-landing-page/guide",
    title: "Public Landing Page Guide",
    description: "Explains what is public and what remains protected.",
  },
  async () =>
    markdown(`# Public landing page

Open ${baseUrl}/mcp in a browser to see this server's landing page without a bearer token.

MCP JSON, SSE, and tool calls still require Authorization: Bearer ${demoToken}.`)
);

server.prompt(
  {
    name: "explain-public-landing",
    description: "Draft a short explanation of the public landing page setup.",
    schema: z.object({
      audience: z.string().default("developer"),
    }),
  },
  async ({ audience }: { audience: string }) =>
    text(
      `Explain to a ${audience} that the HTML landing page is public, while MCP protocol requests require OAuth.`
    )
);

console.log(`Landing page: ${baseUrl}/mcp`);
console.log(`Demo bearer token: ${demoToken}`);

await server.listen(port);
