import { MCPServer } from "@mcp-use/server";
import { oauthSupabaseProvider } from "@mcp-use/server/oauth/supabase";
import { z } from "zod";
import { mountAuthRoutes } from "./auth-routes.js";

const getUserInfoOutputSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  fullName: z.string().nullable(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string().nullable(),
  aal: z.string().nullable(),
  amr: z.array(
    z.object({
      method: z.string(),
      timestamp: z.number().nullable(),
    })
  ),
  sessionId: z.string().nullable(),
  permissions: z.array(z.string()),
  scopes: z.array(z.string()),
  clientId: z.string().nullable(),
  expiresAt: z.number(),
  resource: z.string().nullable(),
});

const projectId = environmentValue("SUPABASE_PROJECT_ID");
const supabaseUrlEnv = environmentValue("SUPABASE_URL");
const jwtSecret = environmentValue("SUPABASE_JWT_SECRET");
const publishableKey = environmentValue("SUPABASE_PUBLISHABLE_KEY");

if (projectId === undefined && supabaseUrlEnv === undefined) {
  throw new Error(
    "Missing Supabase configuration: set SUPABASE_PROJECT_ID or SUPABASE_URL."
  );
}

if (publishableKey === undefined) {
  throw new Error(
    "Missing SUPABASE_PUBLISHABLE_KEY environment variable (required for the consent UI)."
  );
}

const supabaseUrl =
  supabaseUrlEnv ?? `https://${projectId}.supabase.co`;

const server = new MCPServer({
  name: "supabase-user-info",
  version: "1.0.0",
  title: "Supabase User Info",
  description:
    "Returns verified Supabase identity and authorization metadata for the caller.",
  oauth: oauthSupabaseProvider({
    ...(projectId !== undefined && { projectId }),
    ...(supabaseUrlEnv !== undefined && { supabaseUrl: supabaseUrlEnv }),
    ...(jwtSecret !== undefined && { jwtSecret }),
  }),
  configureApp: (app) =>
    mountAuthRoutes(app, { supabaseUrl, publishableKey }),
});

server.tool(
  {
    name: "get-user-info",
    title: "Get user info",
    description:
      "Return the verified Supabase user identity and authorization metadata for the authenticated caller.",
    outputSchema: getUserInfoOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_params, ctx) => {
    const data = {
      id: ctx.auth.user.id,
      email: ctx.auth.user.email ?? null,
      name: ctx.auth.user.name ?? null,
      fullName: ctx.auth.user.fullName ?? null,
      username: ctx.auth.user.username ?? null,
      avatarUrl: ctx.auth.user.avatarUrl ?? null,
      role: ctx.auth.user.role ?? null,
      aal: ctx.auth.user.aal ?? null,
      amr: ctx.auth.user.amr.map(({ method, timestamp }) => ({
        method,
        timestamp: timestamp ?? null,
      })),
      sessionId: ctx.auth.user.sessionId ?? null,
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

function environmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

export default server;
