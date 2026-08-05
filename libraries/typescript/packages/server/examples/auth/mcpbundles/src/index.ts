import { MCPServer } from "mcp-use";
import {
  fetchMcpbundlesPublicConfig,
  oauthMcpbundlesProvider,
} from "mcp-use/oauth/mcpbundles";
import { z } from "zod";

const getUserInfoOutputSchema = z.object({
  user: z.object({
    id: z.string(),
    organizationId: z.string().nullable(),
    email: z.string().nullable(),
    roles: z.array(z.string()),
  }),
  auth: z.object({
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

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

const listingSlug = requireEnv("MCPBUNDLES_LISTING_SLUG");
const publicConfig = await fetchMcpbundlesPublicConfig({ listingSlug });
const baseUrl = optionalEnv("MCP_URL") ?? publicConfig.origin_resource;

const server = new MCPServer({
  name: "mcpbundles-auth-example",
  version: "1.0.0",
  title: "MCPBundles Connect Auth example",
  description:
    "An MCP server secured by MCPBundles Connect Auth access tokens on the vendor origin.",
  publicLandingPage: true,
  oauth: oauthMcpbundlesProvider({
    listingSlug,
    baseUrl,
    publicConfig,
  }),
});

server.tool(
  {
    name: "get-user-info",
    title: "Get user info",
    description:
      "Return the verified Connect Auth identity and authorization details.",
    outputSchema: getUserInfoOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_params, ctx) => {
    const data = {
      user: {
        id: ctx.auth.user.id,
        organizationId: ctx.auth.user.organizationId ?? null,
        email: ctx.auth.user.email ?? null,
        roles: ctx.auth.user.roles,
      },
      auth: {
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
