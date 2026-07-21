import { MCPServer } from "mcp-use";
import { oauthClerkProvider } from "mcp-use/oauth/clerk";
import { z } from "zod";

const getUserInfoOutputSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    username: z.string().nullable(),
    organizationId: z.string().nullable(),
    organizationRole: z.string().nullable(),
    organizationSlug: z.string().nullable(),
    roles: z.array(z.string()),
  }),
  permissions: z.array(z.string()),
  scopes: z.array(z.string()),
  clientId: z.string().nullable(),
  expiresAt: z.number(),
  resource: z.string().nullable(),
});

const frontendApiUrl = requiredEnvironmentValue(
  "MCP_USE_OAUTH_CLERK_FRONTEND_API_URL"
);

const server = new MCPServer({
  name: "clerk-direct-auth-example",
  version: "1.0.0",
  description: "An MCP server that verifies Clerk-issued access tokens.",
  publicLandingPage: true,
  oauth: oauthClerkProvider({ frontendApiUrl }),
});

server.tool(
  {
    name: "get-user-info",
    description: "Get verified Clerk user, organization, and token metadata.",
    outputSchema: getUserInfoOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_args, ctx) => {
    const data = {
      user: {
        id: ctx.auth.user.id,
        email: ctx.auth.user.email ?? null,
        name: ctx.auth.user.name ?? null,
        username: ctx.auth.user.username ?? null,
        organizationId: ctx.auth.user.organizationId ?? null,
        organizationRole: ctx.auth.user.organizationRole ?? null,
        organizationSlug: ctx.auth.user.organizationSlug ?? null,
        roles: ctx.auth.user.roles,
      },
      permissions: ctx.auth.permissions,
      scopes: ctx.auth.scopes,
      clientId: ctx.auth.clientId ?? null,
      expiresAt: ctx.auth.expiresAt,
      resource: ctx.auth.resource?.href ?? null,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
);

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export default server;
