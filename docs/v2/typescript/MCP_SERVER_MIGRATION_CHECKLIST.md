# MCP Server v2 documentation migration checklist

Updated July 24, 2026.

Progress: **10 of 39 pages ready**

- Ready: 10
- Full v1 migrations: 17
- Slight v2 migrations: 12

The v2 Session Management section is not part of this inventory. Native v2 is
stateless, so its three storage guides and Sessions API reference were removed.
The corresponding v1 documentation remains available.

## Ready

- [x] [Server overview](server/index.mdx)
- [x] [Better Auth](server/authentication/providers/better-auth.mdx)
- [x] [Compose MCP servers](server/proxy.mdx)
- [x] [Next.js](server/nextjs-drop-in.mdx)
- [x] [Notifications](server/notifications.mdx)
- [x] [API: Elicitation schemas](api-reference/server/elicitation-schemas.mdx)
- [x] [API: Middleware](api-reference/server/middleware.mdx)
- [x] [API: Response helpers](api-reference/server/response-helpers.mdx)
- [x] [API: ServerConfig](api-reference/server/server-config.mdx)
- [x] [API: Tool context](api-reference/server/tool-context.mdx)

## Full v1 migrations

- [ ] [Authentication overview](server/authentication/index.mdx)
- [ ] [User context](server/authentication/user-context.mdx)
- [ ] [Auth0](server/authentication/providers/auth0.mdx)
- [ ] [Clerk](server/authentication/providers/clerk.mdx)
- [ ] [Keycloak](server/authentication/providers/keycloak.mdx)
- [ ] [Supabase authentication](server/authentication/providers/supabase.mdx)
- [ ] [WorkOS](server/authentication/providers/workos.mdx)
- [ ] [OAuth proxy](server/authentication/providers/oauth-proxy.mdx)
- [ ] [Custom OAuth provider](server/authentication/providers/custom.mdx)
- [ ] [Google Cloud deployment](server/deployment/google.mdx)
- [ ] [OpenAPI](server/openapi.mdx)
- [ ] [Sampling](server/sampling.mdx)
- [ ] [Subscriptions](server/subscriptions.mdx)
- [ ] [API: Authentication helpers](api-reference/server/auth.mdx)
- [ ] [API: Prompts](api-reference/server/prompts.mdx)
- [ ] [API: Resources](api-reference/server/resources.mdx)
- [ ] [API: Tools](api-reference/server/tools.mdx)

## Slight v2 migrations

- [ ] [Examples](server/examples.mdx)
- [ ] [Tools](server/tools.mdx)
- [ ] [Resources](server/resources.mdx)
- [ ] [Prompts](server/prompts.mdx)
- [ ] [Response helpers](server/response-helpers.mdx)
- [ ] [Middleware](server/middleware.mdx)
- [ ] [Elicitation](server/elicitation.mdx)
- [ ] [Manufact deployment](server/deployment/mcp-use.mdx)
- [ ] [Supabase deployment](server/deployment/supabase.mdx)
- [ ] [API: OAuth providers](api-reference/server/auth-providers.mdx)
- [ ] [API: MCPServer](api-reference/server/mcp-server.mdx)
- [ ] [API: Widgets](api-reference/server/widgets.mdx)
