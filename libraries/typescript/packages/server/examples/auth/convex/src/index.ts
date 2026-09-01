import { MCPServer } from "mcp-use";
import { oauthConvexProvider } from "mcp-use/oauth/convex";

const authURL = requireEnv("MCP_USE_OAUTH_CONVEX_AUTH_URL");

const server = new MCPServer({
  name: "convex-oauth-example",
  version: "1.0.0",
  publicLandingPage: true,
  oauth: oauthConvexProvider({ authURL }),
});

server.tool(
  {
    name: "whoami",
    description: "Return the verified Convex identity for this request.",
  },
  async (_params, ctx) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            id: ctx.auth.user.id,
            clientId: ctx.auth.user.clientId,
            scopes: ctx.auth.scopes,
            permissions: ctx.auth.permissions,
            expiresAt: ctx.auth.expiresAt,
            resource: ctx.auth.resource?.href ?? null,
          },
          null,
          2
        ),
      },
    ],
  })
);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// The mcp-use CLI imports this server and owns the MCP socket.
export default server;
