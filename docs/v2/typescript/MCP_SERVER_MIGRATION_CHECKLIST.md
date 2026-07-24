# MCP Server v2 documentation migration checklist

Updated July 24, 2026.

Progress: **27 of 27 pages ready**

- Ready: 27
- Full v1 migrations: 11 of 11 complete
- Slight v2 migrations: 11 of 11 complete

API-reference pages are also outside this migration checklist.

## Previously ready

- [x] [Server overview](/v2/typescript/server/index)
- [x] [Better Auth](/v2/typescript/server/authentication/providers/better-auth)
- [x] [Compose MCP servers](/v2/typescript/server/proxy)
- [x] [Next.js](/v2/typescript/server/nextjs-drop-in)
- [x] [Notifications](/v2/typescript/server/notifications)

## Full v1 migrations — complete

- [x] [Authentication overview](/v2/typescript/server/authentication/index)
  - [x] Import `MCPServer` from `mcp-use` and providers from their `mcp-use/oauth/*` entry points.
  - [x] Replace zero-argument provider examples and SDK-owned environment fallbacks with explicit provider options.
  - [x] Replace `ctx.auth.user.userId` with the native provider user field `ctx.auth.user.id`.
  - [x] Remove OAuth Proxy from the chooser and provider taxonomy because native v2 does not export it.
  - [x] Reframe custom authentication around `createTokenVerifier`, `oauthMetadata`, and `mapAuthInfo`.
  - [x] Avoid routing readers through stale API-reference pages while those pages remain outside this migration.
- [x] [User context](/v2/typescript/server/authentication/user-context)
  - [x] Replace `mcp-use/server` imports with native root and OAuth entry-point imports.
  - [x] Document the native auth shape and provider-specific `user` type instead of a generic `UserInfo`.
  - [x] Use normalized fields such as `id` and `organizationId` instead of `userId` and raw snake-case claims.
  - [x] Rewrite custom claim mapping around `oauthCustomProvider({ createTokenVerifier, oauthMetadata, mapAuthInfo })`.
  - [x] Clarify that scopes come from verified SDK auth info and permissions come from the provider mapping.
- [x] [OAuth proxy](/v2/typescript/server/authentication/providers/oauth-proxy)
  - [x] Remove the page from native v2 navigation or convert it into an explicit unsupported-feature migration note.
  - [x] Delete all legacy proxy factory examples, options, fixed-client recipes, and token-brokering route descriptions.
  - [x] Remove inbound OAuth Proxy links from the other authentication guides.
  - [x] Direct fixed-client brokering to an external authorization-server implementation instead of mcp-use.
- [x] [Custom OAuth provider](/v2/typescript/server/authentication/providers/custom)
  - [x] Import `MCPServer` from `mcp-use` and `oauthCustomProvider` from `mcp-use/oauth`.
  - [x] Replace the removed endpoint, `verifyToken`, `jwksUrl`, and `getUserInfo` option shape.
  - [x] Supply `createTokenVerifier(resource)`, full `oauthMetadata`, and `mapAuthInfo(authInfo)`.
  - [x] Map native user fields with `id` and return `{ user, payload, permissions }`.
  - [x] Explain that the verifier receives the resolved MCP resource and that fixed-client proxying is external.
- [x] [Google Cloud deployment](/v2/typescript/server/deployment/google)
  - [x] Rebuild setup around `create-mcp-use-app@beta --template mcp-server` and its generated scripts.
  - [x] Convert the zoo server to root imports, `inputSchema`/`outputSchema`, raw results, and a default server export.
  - [x] Replace the legacy widget section with `views/<name>/view.tsx`, tool `view`, and `structuredContent`.
  - [x] Bind to `0.0.0.0`, use Cloud Run's injected `PORT`, and preserve IAM flags on redeploys.
  - [x] Materialize Google ID-token values instead of showing unexpanded shell variables in JSON.
  - [x] Remove unsafe cleanup commands, dated model/log examples, and unsupported production-readiness or cost claims.
- [x] [Sampling](/v2/typescript/server/sampling)
  - [x] Replace the premise: native stateless v2 exposes no server-side `ctx.sample()` API.
  - [x] Remove all sampling overload, capability-gate, timeout, progress, response, and failure examples.
  - [x] Explain the supported boundary: the host/model performs generation, then calls deterministic tools.
  - [x] Keep only request-scoped `ctx.reportProgress()` guidance that matches the current API.
  - [x] Recast the page as a migration/boundary guide or remove it from navigation.
- [x] [Subscriptions](/v2/typescript/server/subscriptions)
  - [x] Replace stateful `resources/subscribe` guidance with live stateless `subscriptions/listen` requests.
  - [x] Explain that delivery is listener-bound and non-durable, with no transport session storage.
  - [x] Replace `sendResourcesListChanged()` with `notifyResourcesChanged()` everywhere.
  - [x] Migrate examples to root imports, `inputSchema`, and raw MCP results.
  - [x] Test with a modern client that keeps a subscription listener open and then re-reads invalidated resources.
- [x] [Examples](/v2/typescript/server/examples)
  - [x] Replace the marketing gallery with an index of maintained native examples under `libraries/typescript/packages/server/examples`.
  - [x] Group examples by protocol feature, Views, authentication, runtime, and deployment.
  - [x] Separate external showcases from canonical repository examples and verify every hosted endpoint.
  - [x] Add stateless lifecycle, notifications/subscriptions, and sampling-boundary examples prominently.
  - [x] Use `create-mcp-use-app@beta` with explicit `mcp-server` or `mcp-apps` templates.
- [x] [Elicitation](/v2/typescript/server/elicitation)
  - [x] Rewrite every call to `ctx.elicit(key, message, schemaOrUrl)` with a stable correlation key.
  - [x] Replace `result.action` with `result.status`.
  - [x] Return `result.result` when status is `required`, then handle the retried call's `inputResponses`.
  - [x] Run side effects only after `accept` because callbacks re-run across input-required rounds.
  - [x] Replace helper returns and compatibility imports with root imports and raw results.
  - [x] Update form validation, URL-mode semantics, example paths, and testing instructions.
- [x] [Manufact deployment](/v2/typescript/server/deployment/mcp-use)
  - [x] Remove the nonexistent `--no-github` upload and managed-repository workflow.
  - [x] Require an existing Git repository with a supported GitHub `origin` and installed GitHub App access.
  - [x] Change the link file to `.mcp-use/cloud/link.json` and document `--new`.
  - [x] Replace the flag catalog with the implemented v2 deploy flags.
  - [x] Remove unsupported `--watch-paths` and `--deploy-branches` guidance.
  - [x] Separate deploy creation from build-log following and verify all hosted URL examples.
- [x] [Supabase deployment](/v2/typescript/server/deployment/supabase)
  - [x] Use `npm:mcp-use`, raw tool results, and the server's Web `fetch` handler instead of `listen()`.
  - [x] Rebuild deployment around `.mcp-use/build/index.js`, not the stale `dist` artifact layout.
  - [x] Replace widget paths with `/_mcp-use/views/` and public assets with `/_mcp-use/public/`.
  - [x] Clarify build-time and runtime `MCP_ASSETS_URL`, `MCP_URL`, and CSP responsibilities.
  - [x] Remove or revalidate the old automated deployment script and fix the missing example link.
  - [x] Resolve endpoint-path inconsistencies and remove obsolete widget metadata and Zod troubleshooting.

## Slight v2 migrations — complete

- [x] [Auth0](/v2/typescript/server/authentication/providers/auth0)
  - [x] Import `MCPServer` from `mcp-use` and `oauthAuth0Provider` from `mcp-use/oauth/auth0`.
  - [x] Require explicit `{ domain }` configuration and remove SDK-owned environment fallbacks.
  - [x] Remove the old `audience` provider option and bind verification to the MCP resource.
  - [x] Replace `userId` with `id` while retaining top-level Auth0 permissions.
  - [x] Point to `libraries/typescript/packages/server/examples/auth/auth0` and use app-owned environment names.
- [x] [Clerk](/v2/typescript/server/authentication/providers/clerk)
  - [x] Use root and `mcp-use/oauth/clerk` imports with explicit `frontendApiUrl`.
  - [x] Remove zero-config environment fallback claims.
  - [x] Use `organizationId`, `organizationRole`, and `organizationSlug`.
  - [x] Read organization permissions from top-level `ctx.auth.permissions`.
  - [x] Replace `userId` with `id` and document the optional native `audience`.
  - [x] Fix the runnable example link.
- [x] [Keycloak](/v2/typescript/server/authentication/providers/keycloak)
  - [x] Use root and `mcp-use/oauth/keycloak` imports with required `serverUrl` and `realm`.
  - [x] Remove SDK environment fallbacks and the nonexistent `audience` workflow.
  - [x] Read flattened resource roles from `ctx.auth.permissions`.
  - [x] Replace `userId` with `id` and preserve raw `resourceAccess` only when needed.
  - [x] Fix production checks and the runnable example link.
- [x] [Supabase authentication](/v2/typescript/server/authentication/providers/supabase)
  - [x] Use root and `mcp-use/oauth/supabase` imports with explicit `projectId` or `supabaseUrl`.
  - [x] Rename environment variables as app-owned inputs rather than SDK fallbacks.
  - [x] Replace `userId` with `id` and document the native mapped Supabase fields.
  - [x] Keep the RLS `accessToken` pattern but use the corrected environment inputs.
  - [x] Document ES256/JWKS versus `jwtSecret` HS256 behavior and the default audience.
  - [x] Point to the current in-repo Supabase authentication example.
- [x] [WorkOS](/v2/typescript/server/authentication/providers/workos)
  - [x] Use root and `mcp-use/oauth/workos` imports with explicit `{ subdomain }`.
  - [x] Replace `organization_id` with `organizationId` and `userId` with `id`.
  - [x] Remove SDK environment fallbacks and any implied provider `audience` option.
  - [x] Fix the runnable example link and document current mapped user fields.
- [x] [OpenAPI](/v2/typescript/server/openapi)
  - [x] Import from `mcp-use`, default-export the generated server, and remove scaffold-style `listen()`.
  - [x] Document raw JSON/text/error result mapping instead of response-helper behavior.
  - [x] Explain input-name collisions, operation-name sanitization, caps, and suffixes.
  - [x] Correct tag/exclude matching and path-versus-operation parameter precedence.
  - [x] State `baseUrl`, bundled-reference, request-body, and query-array constraints.
  - [x] Fix the example link and use its actual repository command.
- [x] [Tools](/v2/typescript/server/tools)
  - [x] Describe `inputSchema` as Standard Schema-compatible, with Zod as one option.
  - [x] Fix the request-context example so it does not read `ctx.auth` from an unauthenticated server.
  - [x] Correct the View location from `resources/` to `views/`.
  - [x] State that `view` requires `outputSchema` and one View can bind to only one tool.
  - [x] Document that schema-backed successful results require matching `structuredContent`.
- [x] [Resources](/v2/typescript/server/resources)
  - [x] Change imports from `mcp-use/server` to `mcp-use`.
  - [x] Replace response helpers with raw `{ contents: [...] }` resource results.
  - [x] Show static callbacks as `(uri, ctx)` and template callbacks as `(uri, params, ctx)`.
  - [x] Move template autocomplete from `callbacks.complete` to top-level `complete`.
  - [x] Explain that inferred template parameters are `string | string[]`.
  - [x] Replace `sendResourcesListChanged()` with `notifyResourcesChanged()`.
  - [x] Stop recommending Response Helpers as the native resource-return path.
- [x] [Prompts](/v2/typescript/server/prompts)
  - [x] Change imports from `mcp-use/server` to `mcp-use`.
  - [x] Prefer raw `{ messages: [...] }` prompt results over response helpers.
  - [x] Describe prompt schemas as Standard Schema-compatible, with Zod as one option.
  - [x] Clarify that `completable()` supplies suggestions and does not constrain valid values.
  - [x] Apply `.describe()` and other refinements before wrapping a field with `completable()`.
  - [x] Fix the request-context example so it uses an OAuth-configured server.
  - [x] Replace `sendPromptsListChanged()` with `notifyPromptsChanged()`.
  - [x] Remove the claim that prompts can be registered after server startup.
- [x] [Response helpers](/v2/typescript/server/response-helpers)
  - [x] Make the raw-return example self-contained by importing Zod and creating the server.
  - [x] Teach root `mcp-use` imports and identify `mcp-use/server` as v1 compatibility.
  - [x] Distinguish native `array(xs)` output from the compatibility layer's `{ data }` wrapper.
  - [x] Clarify that resource and prompt helper results are deprecated conversion inputs.
  - [x] State that view-bound tools require `outputSchema`.
- [x] [Middleware](/v2/typescript/server/middleware)
  - [x] Use root imports, `inputSchema`, and raw results.
  - [x] Replace the `ctx.session?.sessionId` rate-limit example with an external or verified identity key.
  - [x] Explain that middleware and client metadata are request-scoped with no session affinity.
  - [x] Tighten Hono request-context wording around `ctx.request`.
  - [x] Fix the middleware example link and align testing instructions with `mcp-use dev`.
