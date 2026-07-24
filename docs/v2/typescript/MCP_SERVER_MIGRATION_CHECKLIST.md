# MCP Server v2 documentation migration checklist

Updated July 24, 2026.

Progress: **5 of 27 pages ready**

- Ready: 5
- Full v1 migrations: 13
- Slight v2 migrations: 9

The v2 Session Management section is not part of this inventory. Native v2 is
stateless, so its three storage guides and Sessions API reference were removed.
The corresponding v1 documentation remains available.

API-reference pages are also outside this migration checklist.

## Ready

- [x] [Server overview](server/index.mdx)
- [x] [Better Auth](server/authentication/providers/better-auth.mdx)
- [x] [Compose MCP servers](server/proxy.mdx)
- [x] [Next.js](server/nextjs-drop-in.mdx)
- [x] [Notifications](server/notifications.mdx)

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

## Slight v2 migrations

- [ ] [Examples](server/examples.mdx)
- [ ] [Tools](server/tools.mdx)
  - [ ] Describe `inputSchema` as Standard Schema-compatible, with Zod as one option.
  - [ ] Fix the request-context example so it does not read `ctx.auth` from an unauthenticated server.
  - [ ] Correct the View location from `resources/` to `views/`.
  - [ ] State that `view` requires `outputSchema` and one View can bind to only one tool.
  - [ ] Document that schema-backed successful results require matching `structuredContent`.
- [ ] [Resources](server/resources.mdx)
  - [ ] Change imports from `mcp-use/server` to `mcp-use`.
  - [ ] Replace response helpers with raw `{ contents: [...] }` resource results.
  - [ ] Show static callbacks as `(uri, ctx)` and template callbacks as `(uri, params, ctx)`.
  - [ ] Move template autocomplete from `callbacks.complete` to top-level `complete`.
  - [ ] Explain that inferred template parameters are `string | string[]`.
  - [ ] Replace `sendResourcesListChanged()` with `notifyResourcesChanged()`.
  - [ ] Stop recommending Response Helpers as the native resource-return path.
- [ ] [Prompts](server/prompts.mdx)
  - [ ] Change imports from `mcp-use/server` to `mcp-use`.
  - [ ] Prefer raw `{ messages: [...] }` prompt results over response helpers.
  - [ ] Describe prompt schemas as Standard Schema-compatible, with Zod as one option.
  - [ ] Clarify that `completable()` supplies suggestions and does not constrain valid values.
  - [ ] Apply `.describe()` and other refinements before wrapping a field with `completable()`.
  - [ ] Fix the request-context example so it uses an OAuth-configured server.
  - [ ] Replace `sendPromptsListChanged()` with `notifyPromptsChanged()`.
  - [ ] Remove the claim that prompts can be registered after server startup.
- [ ] [Response helpers](server/response-helpers.mdx)
- [ ] [Middleware](server/middleware.mdx)
- [ ] [Elicitation](server/elicitation.mdx)
- [ ] [Manufact deployment](server/deployment/mcp-use.mdx)
- [ ] [Supabase deployment](server/deployment/supabase.mdx)
