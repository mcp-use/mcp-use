import { MCPServer } from "mcp-use";
import { oauthWorkOSProvider } from "mcp-use/oauth/workos";
import { z } from "zod";

const getUserInfoOutputSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    emailVerified: z.boolean().nullable(),
    name: z.string().nullable(),
    preferredUsername: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    picture: z.string().nullable(),
    roles: z.array(z.string()),
    organizationId: z.string().nullable(),
    sessionId: z.string().nullable(),
  }),
  auth: z.object({
    permissions: z.array(z.string()),
    scopes: z.array(z.string()),
    clientId: z.string().nullable(),
    expiresAt: z.number(),
    resource: z.string().nullable(),
  }),
});

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const server = new MCPServer({
  name: "workos-auth-example",
  version: "1.0.0",
  title: "WorkOS AuthKit example",
  description:
    "An MCP server secured by verified WorkOS AuthKit access tokens.",
  publicLandingPage: true,
  oauth: oauthWorkOSProvider({
    subdomain: requireEnv("WORKOS_SUBDOMAIN"),
  }),
});

server.tool(
  {
    name: "get-user-info",
    title: "Get user info",
    description:
      "Return the verified WorkOS user identity and authorization details.",
    outputSchema: getUserInfoOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_params, ctx) => {
    const data = {
      user: {
        id: ctx.auth.user.id,
        email: ctx.auth.user.email ?? null,
        emailVerified: ctx.auth.user.emailVerified ?? null,
        name: ctx.auth.user.name ?? null,
        preferredUsername: ctx.auth.user.preferredUsername ?? null,
        firstName: ctx.auth.user.firstName ?? null,
        lastName: ctx.auth.user.lastName ?? null,
        picture: ctx.auth.user.picture ?? null,
        roles: ctx.auth.user.roles,
        organizationId: ctx.auth.user.organizationId ?? null,
        sessionId: ctx.auth.user.sessionId ?? null,
      },
      auth: {
        permissions: ctx.auth.permissions,
        scopes: ctx.auth.scopes,
        clientId: ctx.auth.clientId ?? null,
        expiresAt: ctx.auth.expiresAt,
        resource: ctx.auth.resource?.href ?? null,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
);

export default server;
