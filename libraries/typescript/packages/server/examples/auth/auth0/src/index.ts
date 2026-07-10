import { MCPServer } from "@mcp-use/server";
import { oauthAuth0Provider } from "@mcp-use/server/oauth/auth0";
import { z } from "zod";

const getUserInfoOutputSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  nickname: z.string().nullable(),
  picture: z.string().nullable(),
  emailVerified: z.boolean().nullable(),
  updatedAt: z.string().nullable(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  scopes: z.array(z.string()),
  clientId: z.string().nullable(),
  expiresAt: z.number(),
  resource: z.string().nullable(),
});

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set`);
  }
  return value;
}

const server = new MCPServer({
  name: "auth0-direct-auth-example",
  version: "1.0.0",
  title: "Auth0 direct-auth example",
  description:
    "Authenticates Auth0 access tokens directly and returns verified token claims.",
  oauth: oauthAuth0Provider({
    domain: requireEnv("AUTH0_DOMAIN"),
    audience: requireEnv("AUTH0_AUDIENCE"),
  }),
});

server.tool(
  {
    name: "get-user-info",
    title: "Get user info",
    description:
      "Return the authenticated user's verified Auth0 identity and token authorization details.",
    outputSchema: getUserInfoOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_args, ctx) => {
    const data = {
      id: ctx.auth.user.id,
      email: ctx.auth.user.email ?? null,
      name: ctx.auth.user.name ?? null,
      nickname: ctx.auth.user.nickname ?? null,
      picture: ctx.auth.user.picture ?? null,
      emailVerified: ctx.auth.user.emailVerified ?? null,
      updatedAt: ctx.auth.user.updatedAt ?? null,
      roles: ctx.auth.user.roles,
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

export default server;
