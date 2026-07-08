# @mcp-use/server — authorization spec

**Status:** **Deferred — blocked on official SDK auth support.** The design below is complete and stands as the contract for when the SDK catches up (its web-standard `requireBearerAuth` gate and related exports have not reached a published beta); nothing auth-shaped is implemented or should be started before then. Companion to `SPEC.md` (see its "Later phases" list).
**Protocol basis:** MCP 2026-07-28 authorization (OAuth 2.1 resource server), SDK `@modelcontextprotocol/server@2.0.0-beta.2` (always the latest beta — see the SPEC.md ground rule).
**SDK reference:** <https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html> — the SDK's own authorization guide. Caveat: the site tracks the SDK's main branch and currently documents exports (web-standard `requireBearerAuth`) that have not reached a published beta; check the installed package before assuming an export exists.
**v1 reference:** `packages/mcp-use/src/server/oauth/*` defines *what* must be possible, never what the API looks like.

## Model

The server is an OAuth **resource server** and nothing else: it verifies access tokens issued by an external authorization server (Clerk, Auth0, WorkOS, …) and never issues, stores, or refreshes tokens itself. This matches the SDK v2 architecture exactly:

1. Token **verification happens in HTTP middleware**, outside the MCP handler. The handler is strictly pass-through: `handler.fetch(request, { authInfo })` performs no verification of its own and never reads request headers for auth.
2. The verified `AuthInfo` surfaces in two places downstream:
   - `ctx.http.authInfo` on the SDK `ServerContext` handed to every tool/resource/prompt handler — we lift this into our `RequestContext` as `ctx.auth`.
   - `McpRequestContext.authInfo` — the argument to the **server factory** (`McpServerFactory`), *before* any registration callback runs. Because we build a fresh `McpServer` per request, this enables per-principal server construction (tools that don't exist for non-admin callers), which v1's single-instance model could not do.
3. Clients discover how to authenticate via RFC 9728 **protected resource metadata** (`/.well-known/oauth-protected-resource`) plus a `WWW-Authenticate` challenge on `401` that points at it.

## What we reuse from the SDK (and what we must build)

Reused as-is from `@modelcontextprotocol/server`:

- **`AuthInfo`** — `{ token, clientId, scopes[], expiresAt?, resource?, extra? }`. Our wire-level carrier; we never fork this type.
- **`OAuthError` / `OAuthErrorCode` / `OAuthErrorResponse`** — thrown by verifiers, converted to spec-correct `401 invalid_token` / `403 insufficient_scope` bodies by our middleware.
- **`OAuthProtectedResourceMetadata`** — the shape our well-known endpoint serves. The SDK also exports its validation schema (`OAuthProtectedResourceMetadataSchema`) as a ready-made value; calling `.parse()` on that imported object requires no zod dependency of ours (zod is the SDK's internal concern).
- **`checkResourceAllowed` / `resourceUrlFromServerUrl`** — RFC 8707 resource-binding validation (token `resource` vs our canonical URL).
- **`OAuthTokens` / `OAuthClientInformation*` / `AuthorizationServerMetadata` / OpenID discovery types** — used by proxy mode (below); we don't redeclare any OAuth wire shapes.

**Landing in the SDK — wait for it, don't build it** (the deferral in the status line): a runtime-neutral `requireBearerAuth` for web-standard `fetch(request)` hosts is merged on the SDK's main branch as a pending changeset (minor bump for `@modelcontextprotocol/server`, shipping `requireBearerAuth`, `verifyBearerToken`, `bearerAuthChallengeResponse`, with `OAuthTokenVerifier` moving into core). It is **not** in any published beta yet — beta.2 ships none of it, and `@modelcontextprotocol/hono` still has only host/origin validation — but it covers exactly what we'd otherwise hand-roll (extract bearer → verify → `401`/`403` with `WWW-Authenticate` → produce `AuthInfo`). Usage shape per the SDK guide: `const auth = await gate(request); if (auth instanceof Response) return auth; return handler.fetch(request, { authInfo: auth })`. One behavior to design around: the SDK gate **rejects any verifier result without `expiresAt`** with an automatic `401`.

Built by us:

- `bearerAuth(config)` — thin Hono middleware wrapping the SDK's web-standard `requireBearerAuth` gate (adapt Hono context ↔ `Request`/`Response`, stash `AuthInfo`); challenge/error semantics stay the SDK's. The gate shipping in a published beta is the trigger that un-defers this spec.
- `authMetadata(config)` — Hono routes mirroring `mcpAuthMetadataRouter`, which remains Express-only (RFC 9728 metadata; RFC 8414 / OIDC discovery passthrough where the provider needs it).
- The provider adapters (below).

Dependency: `jose` (JWKS fetch + JWT verification), already budgeted in SPEC.md ground rules.

## Public API

### Configuring auth

```ts
import { MCPServer } from "@mcp-use/server";
import { clerkAuth } from "@mcp-use/server/auth/clerk";

const server = new MCPServer({
  name: "acme-tools",
  version: "1.0.0",
  auth: clerkAuth({ secretKey: process.env.CLERK_SECRET_KEY }),
});
```

or bring-your-own verifier:

```ts
const server = new MCPServer({
  name: "acme-tools",
  version: "1.0.0",
  auth: {
    verifyToken: async (token, request) => {
      const claims = await verifyJwt(token, { jwksUri: JWKS_URI });
      if (!claims) return null; // → 401 + WWW-Authenticate challenge
      return {
        clientId: claims.azp,
        scopes: claims.scope?.split(" ") ?? [],
        expiresAt: claims.exp,
        user: { id: claims.sub, email: claims.email, plan: claims.plan },
      };
    },
    requiredScopes: ["mcp:read"],               // endpoint-wide → 403 insufficient_scope
    authorizationServers: ["https://auth.acme.com"], // published in RFC 9728 metadata
  },
});
```

Contract:

```ts
/** Returned by verifiers. `token` is filled in by the middleware; `extra` is internal plumbing. */
export interface VerifiedAuth<TUser> {
  clientId: string;
  scopes: string[];
  /** Required: the SDK's bearer gate auto-401s a verifier result without it. Non-expiring credentials (opaque/session tokens) must synthesize one (e.g. now + introspection TTL). */
  expiresAt: number;
  resource?: URL;
  user: TUser;
}

export interface AuthConfig<TUser> {
  /** Return the verified identity, or null to reject (→ 401). May also throw OAuthError for specific codes. */
  verifyToken: (token: string, request: Request) => Promise<VerifiedAuth<TUser> | null>;
  /** Scopes every request must carry; missing → 403 insufficient_scope. */
  requiredScopes?: string[];
  /** Authorization server issuer URLs, published in protected-resource metadata. Adapters fill this in. */
  authorizationServers?: string[];
  /** Canonical resource identifier for RFC 8707 binding checks. Defaults to the public server URL. */
  resource?: string;
}
```

### The context: `ctx.auth`, typed end-to-end

`RequestContext` gains `auth`:

```ts
/** What ctx.auth looks like. TUser is decided by the auth adapter. */
export type Auth<TUser> = AuthInfo & { user: TUser };
```

`TUser` flows from the adapter with zero user annotations: `clerkAuth(...)` returns `AuthConfig<ClerkUser>`, the `MCPServer` constructor infers it, and every callback's `ctx.auth.user` is fully typed. A custom `verifyToken` infers `TUser` from its own return type.

```ts
server.tool({ name: "whoami", inputSchema: z.object({}) }, async (_p, ctx) => {
  ctx.auth.user.id;        // ✅ typed, autocompleted
  ctx.auth.scopes;         // ✅ SDK AuthInfo fields still present
  ctx.auth.user.nope;      // ❌ compile error
  return { content: [{ type: "text", text: `Hi ${ctx.auth.user.firstName}` }] };
});
```

No-auth narrowing (replaces v1's `McpContext<HasOAuth>`): when no `auth` config is passed, `ctx.auth` is not on the context type — reaching for it is a compile error, not a runtime surprise. When auth is configured, `ctx.auth` is **non-optional**; no null-check boilerplate in every tool.

Handlers defined outside a `server.tool(...)` callsite use the exported alias:

```ts
import type { ToolCtx } from "@mcp-use/server";
import type { ClerkUser } from "@mcp-use/server/auth/clerk";
export async function whoami(_p: {}, ctx: ToolCtx<ClerkUser>) { /* … */ }
```

Rejected alternative: Hono/Express-style global `declare module` augmentation for the user type — global state, breaks with two servers in one process, and fights adapter-shipped types.

**Ground-rule 26 note (`MCPServer` stays non-generic).** That decision rejected *return-type accumulation* (`tool()` returning `MCPServer<TTools & {…}>`): types that grow per chained call and structurally can't see loops/conditionals. The auth generic is a different animal — a single parameter **fixed at construction**, inferred once from the constructor argument, never accumulating across calls, fully compatible with loop/conditional/OpenAPI registration. None of the rejection reasons apply. If we still want the letter of the rule preserved, the fallback is `new MCPServer(config)` staying non-generic with `auth` carrying a phantom type that only `ToolCtx<TUser>` reads — but the inferred class generic is strictly better DX and is the recommendation.

The auth generic also **forecloses nothing** should accumulation ever be revisited: a construction-fixed generic and per-call accumulating generics compose (`tool()` would return `MCPServer<TUser, TTools & {…}>`, re-threading `TUser` unchanged — the tRPC `initTRPC.context<C>()` / Hono `Env` pattern). Adding a second, defaulted type parameter later is non-breaking.

### Wire mapping (internal)

On the wire we stay SDK-pure: the middleware builds a plain `AuthInfo` with the adapter's `user` (and optional `claims`) tucked into `extra` — the field the SDK explicitly reserves for attached data — and passes it to `handler.fetch(req, { parsedBody, authInfo })`. `toRequestContext` lifts `ctx.http.authInfo` into `ctx.auth`, surfacing `extra.user` as `ctx.auth.user`. Consumers never see `extra`.

### Per-principal registration

`authInfo` reaches the factory before registration callbacks run, so tools can be conditionally *absent* (not just guarded) — they never appear in `tools/list` for callers that don't qualify:

```ts
server.tool(
  {
    name: "delete_org",
    inputSchema: z.object({ orgId: z.string() }),
    enabled: (auth) => auth?.scopes.includes("admin") ?? false,
  },
  async ({ orgId }, ctx) => { /* … */ }
);
```

Per-tool scope *checks* inside handlers stay soft-fail (`isError: true` + explanatory text) so the model can react; HTTP-level `403` is reserved for the endpoint-wide `requiredScopes` gate.

### Composition escape hatch (`mountMcp`)

Users mounting into their own Hono app keep their own middleware and forward the result explicitly:

```ts
app.use("/mcp", myOwnAuthMiddleware);          // sets c.var.authInfo
mountMcp(app, factory, {
  path: "/mcp",
  authInfo: (c) => c.var.authInfo,             // forwarded into handler.fetch
});
```

`bearerAuth()` and `authMetadata()` are exported standalone for this audience.

## Request flow

```
client ── POST /mcp (no token) ──▶ bearerAuth → 401
                                    WWW-Authenticate: Bearer resource_metadata=
                                      "https://srv/.well-known/oauth-protected-resource"
client ── GET  /.well-known/oauth-protected-resource ──▶ authMetadata → RFC 9728 doc
client ── OAuth flow directly with the authorization server (DCR or proxy mode) ──▶ token
client ── POST /mcp (Bearer token) ──▶ bearerAuth
             │ verifyToken(token, request) → VerifiedAuth | null | throws OAuthError
             │ requiredScopes check → 403 insufficient_scope
             ▼
          handler.fetch(req, { parsedBody, authInfo })
             │                         │
             ▼                         ▼
   factory({ era, authInfo, … })   ctx.http.authInfo → toRequestContext → ctx.auth
   (per-principal registration)    (typed ctx.auth.user in every callback)
```

## Provider adapters

All six v1 providers are ported, **not** in the v1 structure. v1's `OAuthProvider` interface (verifyToken/getUserInfo/getIssuer/endpoints, `payload: any` throughout) dissolves into a simpler shape: each adapter is a factory returning `AuthConfig<TProviderUser>`.

| v1 provider | v2 adapter | User type |
|---|---|---|
| `clerk.ts` | `@mcp-use/server/auth/clerk` → `clerkAuth()` | `ClerkUser` |
| `auth0.ts` | `@mcp-use/server/auth/auth0` → `auth0Auth()` | `Auth0User` |
| `workos.ts` | `@mcp-use/server/auth/workos` → `workosAuth()` | `WorkOSUser` |
| `supabase.ts` | `@mcp-use/server/auth/supabase` → `supabaseAuth()` | `SupabaseUser` |
| `keycloak.ts` | `@mcp-use/server/auth/keycloak` → `keycloakAuth()` | `KeycloakUser` |
| `better-auth.ts` | `@mcp-use/server/auth/better-auth` → `betterAuth()` | `BetterAuthUser` |

Subpath exports keep provider code out of the main bundle; adapters share one internal JWKS/JWT core (`jose`) so each is mostly claim-mapping + endpoint derivation.

### The user-type contract

Every adapter's user type extends a normalized baseline (v1's `UserInfo`, kept but enforced in the type system):

```ts
export interface BaseUser {
  id: string;              // token subject — always present
  email?: string;          // optional = honest: phone-only accounts exist
  name?: string;
  picture?: string;
  roles: string[];         // normalized (Clerk org_role, Auth0 roles claim, Keycloak realm roles, …)
  permissions: string[];
}
export interface ClerkUser extends BaseUser { orgId?: string; orgSlug?: string; sessionId: string; }
```

Rules (the point of owning the adapters):

- **Map, never cast.** Adapters construct the user object field-by-field from verified claims; `payload as XUser` is banned. Types are true by construction, and provider claim drift breaks loudly in our adapter tests, not silently in user code.
- **Honest optionality.** A field is non-optional only when the token structurally guarantees it. "Mapped properly" means the types tell the truth, including about absence.
- **Self-contained types.** Adapter user types are defined here, structurally matching the provider — never re-exported from `@clerk/backend` etc., so consumers don't inherit provider SDKs as type dependencies.
- **Claims escape hatch.** JWT-based adapters also expose the full verified payload as `ctx.auth.claims` (typed `Record<string, unknown>`), so an unmapped custom claim never forces re-verification.
- **Thin vs rich.** What claims a token carries varies by provider config (Clerk session tokens are minimal unless the JWT template is customized). Default is claims-only (no network hop — we're stateless, verification runs per request). `fetchUser: true` opts into the provider's user-info API for a richer, distinctly-typed user (`ClerkFullUser`), with an internal TTL cache since it would otherwise be one API call per MCP request.
- **No unverified mode.** v1's `verifyJwt: false` (decode-without-verify) is not ported. There is no configuration in which a token reaches `ctx.auth` unverified.

### Validation posture (no internal zod)

Auth needs **no zod of our own** (the SPEC.md zod-as-devDependency-only ground rule holds here too). The public invariant is absolute — user-facing schema inputs (`schema`/`outputSchema`) are Standard Schema only, and the auth API takes no schemas from users at all.

Three validation jobs, none of which needs a validator dependency:

1. **Tokens** — `jose` (signature, expiry, issuer, audience). The security-critical layer; the SDK deliberately ships no JWT verifier, and nothing a schema adds.
2. **Our RFC 9728 metadata document** — conformance-checked once at server construction with the SDK's exported `OAuthProtectedResourceMetadataSchema`, used as an imported value (`.parse()` on the SDK's own object; zod stays the SDK's internal concern, not our dependency). Never per request.
3. **Claims → `user` mapping and `fetchUser` responses** — hand-declared public interfaces (`ClerkUser` etc.) constructed field-by-field through a small set of internal narrowing helpers (`asString`, `asStringArray`, …) that null out wrongly-typed claims instead of trusting them. The interfaces are hand-written deliberately, not as a fallback: they're the documentation surface (per-field TSDoc, which inferred types can't carry) and they keep validator types out of the public `.d.ts`. Strict TS (`exactOptionalPropertyTypes`, no-`any` lint) forces every interface field to be handled at the construction site, and adapter tests pin against recorded provider fixtures so upstream claim drift breaks in our CI, not in user code. `fetchUser` provider-API responses — the drift-prone external boundary — go through the same helpers and fixtures.

Flexibility note: an internal validator would be invisible to users (nothing zod-shaped may appear in a public signature regardless), so if the `fetchUser` mappers prove unwieldy in practice, adopting zod internally later is a zero-migration change. Carrying the dependency now — with its version-coupling watch items — isn't justified for six flat claim-mapping objects that narrowing helpers cover.

### Security defaults (all adapters)

- JWKS fetched via `jose` `createRemoteJWKSet` with caching; issuer check always on; audience check on when the provider issues audience-bound tokens.
- RFC 8707 resource binding validated with the SDK's `checkResourceAllowed` when the token carries `resource`.
- Expiry enforced by verification, surfaced on `AuthInfo.expiresAt`.
- Failures map to spec responses via `OAuthError`: `401 invalid_token` (missing/expired/bad signature) with the `WWW-Authenticate` challenge, `403 insufficient_scope` with `scope` listed.

## Discovery endpoints & proxy mode

Two serving modes, ported from v1's `routes.ts` split:

1. **DCR-direct (default).** We serve only `/.well-known/oauth-protected-resource` (RFC 9728: `resource`, `authorization_servers`, `scopes_supported`, `bearer_methods_supported`). Clients register and exchange tokens directly with the provider. Where a provider's discovery documents need path massaging, v1's `well-known.ts` RFC 8414 / OIDC-Discovery URL helpers port as internal utilities.
2. **Proxy mode (non-DCR providers: Google, GitHub, enterprise IdPs).** Port of v1's `oauth-proxy.ts` + proxy routes: `/register` returns the pre-registered client, `/authorize` redirects upstream, the broker callback keeps `<baseUrl>/oauth/callback` the only redirect URI to register, and token exchange injects the configured client secret. Reuses the SDK's `OAuthTokens` / `OAuthClientInformation` types for all wire shapes. Ships as `oauthProxy({...})`, itself producing an `AuthConfig<TUser>` — the seam does not care which mode filled it.

Explicitly deferred, not dropped: v1's CORS-proxy layer for browser clients (`oauth/proxy.ts`) — decide with the inspector team once inspector-v2 requirements are known; it's additive middleware either way.

## Instrumentation note

Not auth, but the same review thread: the observability seam is **not** `ctx.log` (deprecated in the 2026-07-28 protocol). It is SEP-414 trace context (`traceparent`/`tracestate`/`baggage` in `_meta`, key constants exported by the SDK) + the SDK's `ServerEventBus`/`onerror` hooks. An instrumentation adapter starts an OTel span per request with `mcpReq.method`, tool name, and `ctx.auth.clientId` as attributes. Specced separately when auth lands; called out here so `AuthInfo` fields stay stable for it.

## Phasing

1. **Seam** — `AuthConfig`/`VerifiedAuth`/`Auth<TUser>`, `bearerAuth`, `authMetadata`, `authInfo` pass-through in `mountMcp`, `ctx.auth` in `toRequestContext`, typed-context narrowing + type-level tests. e2e: real HTTP `401` challenge → metadata → authorized `tools/call` with the official client.
2. **Adapters** — shared `jose` core, then the six providers (Clerk first — it's the doc example), `claims` + `fetchUser` variants, `enabled` per-tool gating.
3. **Proxy mode** — non-DCR flow, broker callback, secret injection.

## Deltas vs v1 (for the migration guide)

- `ctx.auth.user` is typed per adapter; v1's `AuthInfo` (`user: UserInfo; payload; accessToken; scopes; permissions`) becomes SDK `AuthInfo` + typed `user` + `claims`. `accessToken` → `ctx.auth.token`; `permissions` live on `user.permissions`.
- Verification is explicit pass-through (`handler.fetch({ authInfo })`), not AsyncLocalStorage — v1's `context-storage.ts` (with its `globalThis` bundler workaround) has no v2 counterpart at all.
- `verifyJwt: false` removed (security).
- OAuth config moves from server-level options + `setup.ts` state machine into one `auth` constructor field; provider factories return config, not class instances.
- New capabilities v1 didn't have: per-principal tool *existence* (`enabled`), RFC 8707 resource binding, typed no-auth compile-time narrowing.
