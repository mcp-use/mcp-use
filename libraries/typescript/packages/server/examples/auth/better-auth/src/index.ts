import { MCPServer } from "mcp-use";
import { oauthBetterAuthProvider } from "mcp-use/oauth/better-auth";

const server = new MCPServer({
  name: "better-auth-anonymous-example",
  version: "1.0.0",
  oauth: oauthBetterAuthProvider({
    authURL: process.env.MCP_USE_OAUTH_BETTER_AUTH_URL!,
  }),
});

server.tool(
  {
    name: "whoami",
    description: "Return the verified Better Auth identity for this request.",
  },
  async (_params, ctx) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            id: ctx.auth.user.id,
            name: ctx.auth.user.name,
            isAnonymous: ctx.auth.user.isAnonymous,
            scopes: ctx.auth.scopes,
          },
          null,
          2
        ),
      },
    ],
  })
);

// The mcp-use CLI imports this server and owns the MCP socket.
export default server;
