# MCP Server v2 documentation migration checklist

Updated July 24, 2026.

Progress: **5 of 27 pages ready**

- Ready: 5
- Full v1 migrations: 11
- Slight v2 migrations: 11

API-reference pages are also outside this migration checklist.

## Ready

- [x] [Server overview](server/index.mdx)
- [x] [Better Auth](server/authentication/providers/better-auth.mdx)
- [x] [Compose MCP servers](server/proxy.mdx)
- [x] [Next.js](server/nextjs-drop-in.mdx)
- [x] [Notifications](server/notifications.mdx)

## Full v1 migrations

- [ ] [Authentication overview](server/authentication/index.mdx)
  - [ ] Import `MCPServer` from `mcp-use` and providers from their `mcp-use/oauth/*` entry points.
  - [ ] Replace zero-argument provider examples and SDK-owned environment fallbacks with explicit provider options.
  - [ ] Replace `ctx.auth.user.userId` with the native provider user field `ctx.auth.user.id`.
  - [ ] Remove OAuth Proxy from the chooser and provider taxonomy because native v2 does not export it.
  - [ ] Reframe custom authentication around `createTokenVerifier`, `oauthMetadata`, and `mapAuthInfo`.
  - [ ] Avoid routing readers through stale API-reference pages while those pages remain outside this migration.
- [ ] [User context](server/authentication/user-context.mdx)
  - [ ] Replace `mcp-use/server` imports with native root and OAuth entry-point imports.
  - [ ] Document the native auth shape and provider-specific `user` type instead of a generic `UserInfo`.
  - [ ] Use normalized fields such as `id` and `organizationId` instead of `userId` and raw snake-case claims.
  - [ ] Rewrite custom claim mapping around `oauthCustomProvider({ createTokenVerifier, oauthMetadata, mapAuthInfo })`.
  - [ ] Clarify that scopes come from verified SDK auth info and permissions come from the provider mapping.
- [ ] [OAuth proxy](server/authentication/providers/oauth-proxy.mdx)
  - [ ] Remove the page from native v2 navigation or convert it into an explicit unsupported-feature migration note.
  - [ ] Delete all `oauthProxy()` examples, options, fixed-client recipes, and token-brokering route descriptions.
  - [ ] Remove inbound OAuth Proxy links from the other authentication guides.
  - [ ] Direct fixed-client brokering to an external authorization-server implementation instead of mcp-use.
- [ ] [Custom OAuth provider](server/authentication/providers/custom.mdx)
  - [ ] Import `MCPServer` from `mcp-use` and `oauthCustomProvider` from `mcp-use/oauth`.
  - [ ] Replace the removed endpoint, `verifyToken`, `jwksUrl`, and `getUserInfo` option shape.
  - [ ] Supply `createTokenVerifier(resource)`, full `oauthMetadata`, and `mapAuthInfo(authInfo)`.
  - [ ] Map native user fields with `id` and return `{ user, payload, permissions }`.
  - [ ] Explain that the verifier receives the resolved MCP resource and that fixed-client proxying is external.
- [ ] [Google Cloud deployment](server/deployment/google.mdx)
  - [ ] Rebuild setup around `create-mcp-use-app@beta --template mcp-server` and its generated scripts.
  - [ ] Convert the zoo server to root imports, `inputSchema`/`outputSchema`, raw results, and a default server export.
  - [ ] Replace the legacy widget section with `views/<name>/view.tsx`, tool `view`, and `structuredContent`.
  - [ ] Bind to `0.0.0.0`, use Cloud Run's injected `PORT`, and preserve IAM flags on redeploys.
  - [ ] Materialize Google ID-token values instead of showing unexpanded shell variables in JSON.
  - [ ] Remove unsafe cleanup commands, dated model/log examples, and unsupported production-readiness or cost claims.
- [ ] [Sampling](server/sampling.mdx)
  - [ ] Replace the premise: native stateless v2 exposes no server-side `ctx.sample()` API.
  - [ ] Remove all sampling overload, capability-gate, timeout, progress, response, and failure examples.
  - [ ] Explain the supported boundary: the host/model performs generation, then calls deterministic tools.
  - [ ] Keep only request-scoped `ctx.reportProgress()` guidance that matches the current API.
  - [ ] Recast the page as a migration/boundary guide or remove it from navigation.
- [ ] [Subscriptions](server/subscriptions.mdx)
  - [ ] Replace stateful `resources/subscribe` guidance with live stateless `subscriptions/listen` requests.
  - [ ] Explain that delivery is listener-bound and non-durable, with no transport session storage.
  - [ ] Replace `sendResourcesListChanged()` with `notifyResourcesChanged()` everywhere.
  - [ ] Migrate examples to root imports, `inputSchema`, and raw MCP results.
  - [ ] Test with a modern client that keeps a subscription listener open and then re-reads invalidated resources.
- [ ] [Examples](server/examples.mdx)
  - [ ] Replace the marketing gallery with an index of maintained native examples under `libraries/typescript/packages/server/examples`.
  - [ ] Group examples by protocol feature, Views, authentication, runtime, and deployment.
  - [ ] Separate external showcases from canonical repository examples and verify every hosted endpoint.
  - [ ] Add stateless lifecycle, notifications/subscriptions, and sampling-boundary examples prominently.
  - [ ] Use `create-mcp-use-app@beta` with explicit `mcp-server` or `mcp-apps` templates.
- [ ] [Elicitation](server/elicitation.mdx)
  - [ ] Rewrite every call to `ctx.elicit(key, message, schemaOrUrl)` with a stable correlation key.
  - [ ] Replace `result.action` with `result.status`.
  - [ ] Return `result.result` when status is `required`, then handle the retried call's `inputResponses`.
  - [ ] Run side effects only after `accept` because callbacks re-run across input-required rounds.
  - [ ] Replace helper returns and compatibility imports with root imports and raw results.
  - [ ] Update form validation, URL-mode semantics, example paths, and testing instructions.
- [ ] [Manufact deployment](server/deployment/mcp-use.mdx)
  - [ ] Remove the nonexistent `--no-github` upload and managed-repository workflow.
  - [ ] Require an existing Git repository with a supported GitHub `origin` and installed GitHub App access.
  - [ ] Change the link file to `.mcp-use/cloud/link.json` and document `--new`.
  - [ ] Replace the flag catalog with the implemented v2 deploy flags.
  - [ ] Remove unsupported `--watch-paths` and `--deploy-branches` guidance.
  - [ ] Separate deploy creation from build-log following and verify all hosted URL examples.
- [ ] [Supabase deployment](server/deployment/supabase.mdx)
  - [ ] Use `npm:mcp-use`, raw tool results, and the server's Web `fetch` handler instead of `listen()`.
  - [ ] Rebuild deployment around `.mcp-use/build/index.js`, not the stale `dist` artifact layout.
  - [ ] Replace widget paths with `/_mcp-use/views/` and public assets with `/_mcp-use/public/`.
  - [ ] Clarify build-time and runtime `MCP_ASSETS_URL`, `MCP_URL`, and CSP responsibilities.
  - [ ] Remove or revalidate the old automated deployment script and fix the missing example link.
  - [ ] Resolve endpoint-path inconsistencies and remove obsolete widget metadata and Zod troubleshooting.

## Slight v2 migrations

- [ ] [Auth0](server/authentication/providers/auth0.mdx)
  - [ ] Import `MCPServer` from `mcp-use` and `oauthAuth0Provider` from `mcp-use/oauth/auth0`.
  - [ ] Require explicit `{ domain }` configuration and remove SDK-owned environment fallbacks.
  - [ ] Remove the old `audience` provider option and bind verification to the MCP resource.
  - [ ] Replace `userId` with `id` while retaining top-level Auth0 permissions.
  - [ ] Point to `libraries/typescript/packages/server/examples/auth/auth0` and use app-owned environment names.
- [ ] [Clerk](server/authentication/providers/clerk.mdx)
  - [ ] Use root and `mcp-use/oauth/clerk` imports with explicit `frontendApiUrl`.
  - [ ] Remove zero-config environment fallback claims.
  - [ ] Use `organizationId`, `organizationRole`, and `organizationSlug`.
  - [ ] Read organization permissions from top-level `ctx.auth.permissions`.
  - [ ] Replace `userId` with `id` and document the optional native `audience`.
  - [ ] Fix the runnable example link.
- [ ] [Keycloak](server/authentication/providers/keycloak.mdx)
  - [ ] Use root and `mcp-use/oauth/keycloak` imports with required `serverUrl` and `realm`.
  - [ ] Remove SDK environment fallbacks and the nonexistent `audience` workflow.
  - [ ] Read flattened resource roles from `ctx.auth.permissions`.
  - [ ] Replace `userId` with `id` and preserve raw `resourceAccess` only when needed.
  - [ ] Fix production checks and the runnable example link.
- [ ] [Supabase authentication](server/authentication/providers/supabase.mdx)
  - [ ] Use root and `mcp-use/oauth/supabase` imports with explicit `projectId` or `supabaseUrl`.
  - [ ] Rename environment variables as app-owned inputs rather than SDK fallbacks.
  - [ ] Replace `userId` with `id` and document the native mapped Supabase fields.
  - [ ] Keep the RLS `accessToken` pattern but use the corrected environment inputs.
  - [ ] Document ES256/JWKS versus `jwtSecret` HS256 behavior and the default audience.
  - [ ] Point to the current in-repo Supabase authentication example.
- [ ] [WorkOS](server/authentication/providers/workos.mdx)
  - [ ] Use root and `mcp-use/oauth/workos` imports with explicit `{ subdomain }`.
  - [ ] Replace `organization_id` with `organizationId` and `userId` with `id`.
  - [ ] Remove SDK environment fallbacks and any implied provider `audience` option.
  - [ ] Fix the runnable example link and document current mapped user fields.
- [ ] [OpenAPI](server/openapi.mdx)
  - [ ] Import from `mcp-use`, default-export the generated server, and remove scaffold-style `listen()`.
  - [ ] Document raw JSON/text/error result mapping instead of response-helper behavior.
  - [ ] Explain input-name collisions, operation-name sanitization, caps, and suffixes.
  - [ ] Correct tag/exclude matching and path-versus-operation parameter precedence.
  - [ ] State `baseUrl`, bundled-reference, request-body, and query-array constraints.
  - [ ] Fix the example link and use its actual repository command.
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
  - [ ] Make the raw-return example self-contained by importing Zod and creating the server.
  - [ ] Teach root `mcp-use` imports and identify `mcp-use/server` as v1 compatibility.
  - [ ] Distinguish native `array(xs)` output from the compatibility layer's `{ data }` wrapper.
  - [ ] Clarify that resource and prompt helper results are deprecated conversion inputs.
  - [ ] State that view-bound tools require `outputSchema`.
- [ ] [Middleware](server/middleware.mdx)
  - [ ] Use root imports, `inputSchema`, and raw results.
  - [ ] Replace the `ctx.session?.sessionId` rate-limit example with an external or verified identity key.
  - [ ] Explain that middleware and client metadata are request-scoped with no session affinity.
  - [ ] Tighten Hono request-context wording around `ctx.request`.
  - [ ] Fix the middleware example link and align testing instructions with `mcp-use dev`.
