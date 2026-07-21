import { MCPServer } from "mcp-use";
import { oauthKeycloakProvider } from "mcp-use/oauth/keycloak";
import { z } from "zod";

const getUserInfoOutputSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  preferredUsername: z.string().nullable(),
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  emailVerified: z.boolean().nullable(),
  roles: z.array(z.string()),
  realmAccess: z.record(z.string(), z.unknown()).nullable(),
  resourceAccess: z.record(z.string(), z.unknown()).nullable(),
  permissions: z.array(z.string()),
  scopes: z.array(z.string()),
  clientId: z.string().nullable(),
  expiresAt: z.number(),
  resource: z.string().nullable(),
});

const server = new MCPServer({
  name: "keycloak-auth-example",
  version: "1.0.0",
  title: "Keycloak Direct Auth Example",
  description:
    "An MCP resource server that verifies Keycloak access tokens directly.",
  publicLandingPage: true,
  oauth: oauthKeycloakProvider({
    serverUrl: process.env.MCP_USE_OAUTH_KEYCLOAK_SERVER_URL!,
    realm: process.env.MCP_USE_OAUTH_KEYCLOAK_REALM!,
    audience: process.env.MCP_USE_OAUTH_KEYCLOAK_AUDIENCE!,
  }),
});

server.tool(
  {
    name: "get-user-info",
    title: "Get verified user info",
    description:
      "Returns identity and authorization data verified from the Keycloak access token.",
    outputSchema: getUserInfoOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_, { auth }) => {
    const data = {
      id: auth.user.id,
      email: auth.user.email ?? null,
      name: auth.user.name ?? null,
      preferredUsername: auth.user.preferredUsername ?? null,
      givenName: auth.user.givenName ?? null,
      familyName: auth.user.familyName ?? null,
      emailVerified: auth.user.emailVerified ?? null,
      roles: auth.user.roles,
      realmAccess: auth.user.realmAccess ?? null,
      resourceAccess: auth.user.resourceAccess ?? null,
      permissions: auth.permissions,
      scopes: auth.scopes,
      clientId: auth.clientId ?? null,
      expiresAt: auth.expiresAt,
      resource: auth.resource?.href ?? null,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
);

export default server;
