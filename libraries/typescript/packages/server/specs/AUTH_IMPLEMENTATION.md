# mcp-use v2 authorization implementation contract

**Status:** Direct external authorization-server/resource-server mode is implemented.
**Package:** `mcp-use@2`; imports use `mcp-use` subpaths.

**Scope:** This phase implements direct external authorization-server and resource-server mode only. mcp-use verifies externally issued access tokens that are bound to the canonical MCP resource. It does not issue, store, refresh, or proxy tokens.

**Protocol basis:** Current [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) (revision 2025-11-25) and [MCP security guidance](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices), OAuth 2.1 resource-server guidance, and `@modelcontextprotocol/server@2.0.0-beta.3`. Beta.3 provides runtime-neutral resource-server helpers in server core.

## OAuth proxy is deferred

The current implementation must not add registration, local authorization, token, callback, or consent routes. It must not add local token issuance, persistence, or upstream client-secret handling. The future OAuth proxy design remains in [AUTH_SPEC.md](./AUTH_SPEC.md) and is excluded from this phase.

## Use `oauth` in the public API

The public constructor field is `oauth`, matching v1 terminology. `auth` is not a public constructor alias.

```ts
import { MCPServer } from "mcp-use";
import { oauthClerkProvider } from "mcp-use/oauth/clerk";

const server = new MCPServer({
  name: "acme-tools",
  version: "1.0.0",
  oauth: oauthClerkProvider({
    frontendApiUrl: process.env.CLERK_FRONTEND_API_URL!,
  }),
});
```

`oauth` configures a resource server. Its provider tells mcp-use how to verify bearer tokens and which external authorization servers to advertise in protected-resource metadata.

## Keep the official SDK behind mcp-use

Consumers import OAuth APIs only from `mcp-use/oauth`. They do not install, version, or import `@modelcontextprotocol/server` directly. It remains a regular dependency of mcp-use, not a consumer-managed peer dependency.

mcp-use does not reimplement protocol types, error classes, or runtime-neutral helpers that already exist. The OAuth entry point re-exports the upstream values unchanged:

```ts
// mcp-use/oauth
export {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  requireBearerAuth,
  verifyBearerToken,
} from "@modelcontextprotocol/server";

export type {
  AuthInfo as OAuthAuthInfo,
  AuthMetadataOptions,
  BearerAuthOptions,
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
```

Re-exporting preserves the upstream runtime identity and type identity. In particular, `OAuthError` remains the same class for `instanceof` checks. mcp-use owns only its higher-level provider, context, and Hono composition APIs.

Public documentation and examples never import from `@modelcontextprotocol/server`:

```ts
import {
  OAuthError,
  OAuthErrorCode,
  oauthCustomProvider,
  type OAuthAuthInfo,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "mcp-use/oauth";
```

## Define the provider contract

`OAuthProvider<TUser>` is a structural interface. Consumers can use a built-in factory, call `oauthCustomProvider`, or implement the same provider contract directly in server-side code.

```ts
export type OAuthExtra<TUser> = Record<string, unknown> & {
  user: TUser;
  payload: Record<string, unknown>;
  permissions: string[];
};

export interface OAuthResourceOptions {
  /** Full canonical public MCP endpoint URL. */
  resource?: URL | string;

  /** Endpoint-wide scopes enforced by the SDK bearer gate. */
  requiredScopes?: readonly string[];

  /** Value for protected-resource metadata `scopes_supported`. */
  scopesSupported?: readonly string[];

  /** Value for protected-resource metadata `resource_name`. */
  resourceName?: string;

  /** Value for protected-resource metadata `resource_documentation`. */
  serviceDocumentationUrl?: URL;
}

export interface CustomOAuthProviderOptions<TUser>
  extends OAuthResourceOptions {
  /** Verifies or introspects the token and returns SDK-native AuthInfo. */
  tokenVerifier: OAuthTokenVerifier;

  /** RFC 8414 authorization-server metadata for discovery. */
  oauthMetadata: OAuthMetadata;

  /** Maps verified information into the public mcp-use auth context. */
  mapAuthInfo: (authInfo: OAuthAuthInfo) => OAuthExtra<TUser>;
}

export interface OAuthProvider<TUser>
  extends CustomOAuthProviderOptions<TUser> {}

export function oauthCustomProvider<TUser>(
  options: CustomOAuthProviderOptions<TUser>,
): OAuthProvider<TUser>;
```

Provider factories preserve v1 concepts and names:

```ts
oauthClerkProvider(...)
oauthAuth0Provider(...)
oauthWorkOSProvider(...)
oauthSupabaseProvider(...)
oauthKeycloakProvider(...)
oauthCustomProvider(...)
```

`oauthCustomProvider` validates the provider options and defensively copies array configuration. The verifier must return verified SDK-native fields, including `token`, `clientId`, `scopes`, and a valid future numeric `expiresAt`. Decode-only tokens, `verifyJwt: false`, and equivalent bypasses are forbidden.

Before calling `requireBearerAuth`, mcp-use wraps the provider with
`wrapOAuthTokenVerifier(provider, expectedResource?)`. The wrapper calls the
provider verifier, asserts resource binding against the resolved canonical
resource URL, then returns the final SDK-compatible `AuthInfo` with `extra`
merged as `{ ...authInfo.extra, ...provider.mapAuthInfo(authInfo) }`. Binding
succeeds when the token carries an RFC 8707 `resource` claim matching
`expectedResource`, or when `authInfo.resource` is absent but audience
validation was proven (an internal marker set by `createJwtVerifier`).
Therefore every successful bearer-gate result has the typed mcp-use values
before it reaches Hono, `mountMcp`, or the SDK callback. Custom providers use
this same wrapper; they cannot omit the public `mapAuthInfo` callback or rely
on an optional `extra` value.

## Resolve the canonical resource URL

Every protected resource has one canonical public MCP URL. mcp-use uses it for metadata, bearer challenges, and resource binding. The canonical URL includes the MCP endpoint path.

```ts
const resource = new URL("https://api.example.com/mcp");
getOAuthProtectedResourceMetadataUrl(resource).toString();
// "https://api.example.com/.well-known/oauth-protected-resource/mcp"
```

Resolution order:

1. Use the provider factory's explicit `resource` option when configured. It is the full canonical MCP endpoint URL, including `basePath`.
2. Otherwise use `MCP_URL` with the v1 compatibility convention: it is an absolute public origin, optionally ending in `/`, not an endpoint URL or path prefix. Resolve `basePath` against that origin exactly once.
3. Otherwise derive from the trusted local `listen()` URL only. Append `basePath` exactly once.
4. `getHandler()` and public or wildcard deployments without an explicit provider `resource` or a valid `MCP_URL` fail configuration. They must not derive a security identity from request headers.

Never derive the security identity, metadata URL, or resource-binding target from an untrusted request `Host` header. Hono remains responsible for configured host and origin validation.

`basePath` is the MCP endpoint route, not a prefix. Its default is `/mcp`. For `basePath: "/api/mcp"`, the resource is `https://api.example.com/api/mcp` and metadata is `https://api.example.com/.well-known/oauth-protected-resource/api/mcp`. For `basePath: "/api"`, the resource is `https://api.example.com/api`. With `MCP_URL=https://api.example.com`, each resolves by appending its `basePath` once.

Validate the resolved resource once during construction. It must be an absolute URL, contain no query or fragment, use HTTPS outside localhost, and have a path that matches `basePath` after trailing-slash normalization.

## Preserve typed `ctx.auth`

The constructor fixes the auth user type once. It does not accumulate a type through return values from `tool()`, `resource()`, or `prompt()`.

```ts
const server = new MCPServer({
  name: "acme-tools",
  version: "1.0.0",
  oauth: oauthClerkProvider(/* ... */),
});

server.tool({ name: "whoami", schema }, async (_params, ctx) => {
  ctx.auth.user.id;          // Clerk user type
  ctx.auth.accessToken;      // string
  ctx.auth.clientId;         // string | undefined
  return { content: [] };
});
```

The documented type contract is:

```ts
export type OAuthAuth<TUser> = {
  user: TUser;
  payload: Record<string, unknown>;
  accessToken: string;
  scopes: string[];
  permissions: string[];
  clientId?: string;
  expiresAt: number;
  resource?: URL;
};

type RequestContextBase = {
  signal: AbortSignal;
  request?: Request;
  client: RequestClientContext;
};

export type RequestContext<TUser = never, HasOAuth extends boolean = false> =
  HasOAuth extends true
    ? RequestContextBase & { auth: OAuthAuth<TUser> }
    : RequestContextBase & { auth?: never };
```

With `oauth`, `ctx.auth` is present and non-optional. OAuth callbacks are registered only through the gated HTTP MCP endpoint, so absence of `ctx.http?.authInfo` is an internal invariant violation. `request` remains optional because `ServerContext.http` is optional in the SDK. Without `oauth`, `ctx.auth` is unavailable by the documented type contract. A fixed construction generic such as `MCPServer<TUser, HasOAuth>` is allowed because the constructor infers it once and it remains unchanged. Forbidden return-type accumulation is different: `tool()` must not return a progressively growing `MCPServer<TTools & ...>` type, because it cannot accurately model loops and conditionals.

## Keep SDK AuthInfo on the wire

SDK `AuthInfo` remains the wire carrier. The provider wrapper produces the final `AuthInfo`, including typed mcp-use values under `extra`, before `requireBearerAuth` receives it. The gate returns that final value and `mountMcp` forwards it unchanged:

```ts
handler.fetch(c.req.raw, {
  parsedBody,
  authInfo,
});
```

The SDK exposes it as `ctx.http.authInfo` in its `ServerContext`. Projection
into mcp-use callback context uses two exported helpers:

- `toRequestContext(ctx)` — unauthenticated context (`RequestContext<never, false>`): `signal`, optional `request`, and `client`.
- `toAuthenticatedRequestContext<TUser>(ctx)` — authenticated context (`RequestContext<TUser, true>`): the same fields plus `auth`, after `requireOAuthAuthInfo` succeeds.

`MCPServer` picks between them from whether `oauth` is configured. There is no
`AsyncLocalStorage`, global request state, or second token-verification path.

`requireOAuthAuthInfo` and the authenticated projection:

```ts
function requireOAuthAuthInfo<TUser>(
  authInfo: AuthInfo | undefined,
): asserts authInfo is MappedOAuthAuthInfo<TUser> {
  const extra = authInfo?.extra;
  if (
    authInfo === undefined ||
    extra === undefined ||
    typeof extra !== "object" ||
    extra === null ||
    !("user" in extra) ||
    extra.user === undefined ||
    !("payload" in extra) ||
    extra.payload === null ||
    typeof extra.payload !== "object" ||
    Array.isArray(extra.payload) ||
    !("permissions" in extra) ||
    !Array.isArray(extra.permissions) ||
    !extra.permissions.every((permission) => typeof permission === "string") ||
    typeof authInfo.token !== "string" ||
    !Array.isArray(authInfo.scopes) ||
    !authInfo.scopes.every((scope) => typeof scope === "string") ||
    typeof authInfo.clientId !== "string" ||
    typeof authInfo.expiresAt !== "number" ||
    !Number.isFinite(authInfo.expiresAt) ||
    (authInfo.resource !== undefined && !(authInfo.resource instanceof URL))
  ) {
    throw new Error("OAuth callback did not receive mapped AuthInfo.extra");
  }
}

export function toRequestContext(
  ctx: ServerContext,
): RequestContext<never, false> {
  const request = ctx.http?.req;
  return {
    signal: ctx.mcpReq.signal,
    ...(request !== undefined && { request }),
    client: toClientContext(ctx),
  };
}

export function toAuthenticatedRequestContext<TUser>(
  ctx: ServerContext,
): RequestContext<TUser, true> {
  const request = ctx.http?.req;
  const authInfo = ctx.http?.authInfo;
  requireOAuthAuthInfo<TUser>(authInfo);
  return {
    signal: ctx.mcpReq.signal,
    ...(request !== undefined && { request }),
    client: toClientContext(ctx),
    auth: {
      user: authInfo.extra.user,
      payload: authInfo.extra.payload,
      accessToken: authInfo.token,
      scopes: [...authInfo.scopes],
      permissions: [...authInfo.extra.permissions],
      ...(authInfo.clientId.length > 0 && { clientId: authInfo.clientId }),
      expiresAt: authInfo.expiresAt,
      ...(authInfo.resource !== undefined && { resource: authInfo.resource }),
    },
  };
}
```

The exact value mappings are:

- `ctx.auth.accessToken` takes `sdkAuthInfo.token`.
- `ctx.auth.scopes` copies `sdkAuthInfo.scopes`.
- `ctx.auth.clientId` takes `sdkAuthInfo.clientId` when non-empty; otherwise it is undefined. Verifiers populate SDK `AuthInfo.clientId` from the token's `client_id` claim, falling back to `azp`, else empty string. Tokens are not rejected for lacking client claims — client identification is not an OAuth resource-server validation requirement; RFC 9068's `client_id` claim only applies to its opt-in at+jwt profile, and RFC 7662 marks `client_id` OPTIONAL. When no client claim exists (for example WorkOS AuthKit or Supabase), `ctx.auth.clientId` is undefined.
- `ctx.auth.expiresAt` takes `sdkAuthInfo.expiresAt`.
- `ctx.auth.resource` takes `sdkAuthInfo.resource` and remains optional.
- `ctx.auth.user`, `ctx.auth.payload`, and `ctx.auth.permissions` come from `sdkAuthInfo.extra`.

All providers supply typed mcp-use additions through `mapAuthInfo`. The wrapper merges the result under `AuthInfo.extra`; a provider may retain unrelated SDK `extra` fields, but mcp-use's fields always come from verified data. It must not populate user data from an unverified decode.

## Run routes in this order

Route and request ordering is exact:

1. Register public OAuth discovery and protected-resource metadata routes with `oauthMetadataResponse`.
2. Register the exact MCP endpoint bearer gate. Do not protect a broad prefix that unintentionally covers metadata routes or unrelated routes.
3. The gate calls `requireBearerAuth(...)` and stores a successful `AuthInfo` in Hono variables.
4. `mountMcp` reads the Hono variable and forwards it as `MountMcpOptions.authInfo` to `handler.fetch`.
5. The MCP route creates the SDK server factory for this request with the forwarded `authInfo`.
6. Callback execution receives SDK `ctx.http.authInfo`; `toAuthenticatedRequestContext` (or `toRequestContext` when OAuth is not configured) projects it once to mcp-use callback context.

```ts
const provider = config.oauth!;
const providerOptions = getOAuthProviderOptions(provider);

app.use("*", async (c, next) => {
  const response = oauthMetadataResponse(c.req.raw, {
    oauthMetadata: providerOptions.oauthMetadata,
    resourceServerUrl: resource,
    ...(providerOptions.scopesSupported !== undefined && {
      scopesSupported: providerOptions.scopesSupported,
    }),
    ...(providerOptions.resourceName !== undefined && {
      resourceName: providerOptions.resourceName,
    }),
    ...(providerOptions.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: providerOptions.serviceDocumentationUrl,
    }),
  });

  if (response !== undefined) return response;
  await next();
});

const gate = requireBearerAuth({
  verifier: wrapOAuthTokenVerifier(provider, resource),
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
  ...(providerOptions.requiredScopes !== undefined && {
    requiredScopes: providerOptions.requiredScopes,
  }),
});

app.use(basePath, async (c, next) => {
  const result = await gate(c.req.raw);
  if (result instanceof Response) return result;
  c.set("authInfo", result);
  await next();
});

mountMcp(app, createServerForRequest, {
  path: basePath,
  authInfo: (c) => c.get("authInfo"),
});
```

`mountMcp` adds this composition seam:

```ts
export interface MountMcpOptions<E extends Env = Env> {
  path?: string;
  handler?: CreateMcpHandlerOptions;
  authInfo?: (context: Context<E>) => AuthInfo | undefined;
}
```

It combines the resolved `authInfo` with `parsedBody` in the same `handler.fetch` options object. When `authInfo` is absent, `mountMcp` keeps its current unauthenticated behavior.

The SDK factory receives the same value before registrations run:

```ts
const createServerForRequest: McpServerFactory = ({ authInfo }) => {
  return buildSdkServer({ authInfo });
};
```

This ordering lets a factory omit tools for a principal before registration. Per-tool authorization failures remain soft MCP results, such as `{ isError: true, content: [...] }`. Endpoint-wide required scopes are the only HTTP `403` check.

## Reuse Beta.3 resource-server helpers

Package internals use the official Beta.3 implementations. The public OAuth entry point re-exports the same helpers and types so consumers remain inside the mcp-use package boundary:

- `OAuthTokenVerifier`
- `requireBearerAuth`
- `verifyBearerToken` and `bearerAuthChallengeResponse`
- `oauthMetadataResponse`
- `getOAuthProtectedResourceMetadataUrl`
- `OAuthError` and `OAuthErrorCode`
- `OAuthAuthInfo`, aliased directly from SDK `AuthInfo`
- `OAuthMetadata`, `OAuthProtectedResourceMetadata`, and the corresponding option types

Do not fork these declarations or copy their implementations into mcp-use. Thin Hono adapters may call them, but resource-server protocol behavior remains owned by the official SDK.

Beta.3 authorization-server helpers are out of scope for this phase. Do not reuse frozen helpers from `server-legacy`.

`requireBearerAuth` is the sole bearer gate. Its outcomes are:

- Missing, malformed, invalid, or expired bearer tokens return `401` with `invalid_token`.
- Missing endpoint-required scopes return `403` with `insufficient_scope`.
- Unexpected non-OAuth verifier failures return `500` with `server_error`.
- The `WWW-Authenticate` challenge includes the `resource_metadata` URL for the canonical resource.

For direct providers, `oauthMetadataResponse` serves path-aware protected-resource metadata at `/.well-known/oauth-protected-resource/<resource path>` and authorization-server metadata at `/.well-known/oauth-authorization-server`. It supports `GET`, `HEAD`, and `OPTIONS` with CORS, and falls through for unmatched paths.

## Use Hono as the host adapter

No upstream `@modelcontextprotocol/hono` auth feature is required. Beta.3 deliberately places web-standard authorization helpers in server core so they work in Hono, Workers, Deno, Bun, and other `Request`/`Response` hosts.

Hono handles body parsing, configured host validation, and origin validation. mcp-use exports thin ergonomic adapters from `mcp-use/oauth`:

- `bearerAuth(provider, resource)` invokes `requireBearerAuth` and stores `authInfo` in Hono variables.
- `oauthMetadata(provider, resource)` serves direct-provider `oauthMetadataResponse` and falls through on unrelated routes.
- `MountMcpOptions.authInfo` forwards custom middleware results through `mountMcp`.

Those adapters are conveniences for normal and custom composition. An upstream Hono convenience wrapper is optional and not a blocker.

## Port provider adapters after the seam

The first implementation phase supplies the resource-server seam. The next phase ports five v1 provider adapters:

1. Clerk with `oauthClerkProvider`
2. Auth0 with `oauthAuth0Provider`
3. WorkOS with `oauthWorkOSProvider`
4. Supabase with `oauthSupabaseProvider`
5. Keycloak with `oauthKeycloakProvider`

Each adapter verifies tokens, maps verified claims to a typed `user`, preserves the verified payload, provides normalized permissions, and advertises its authorization-server metadata. Each adapter must map claims rather than cast decoded payloads. No adapter offers `verifyJwt: false`.

JWT adapters share a `jose` implementation for remote JWKS caching and signature verification. They always validate issuer and expiry, validate audience when the provider issues audience-bound tokens, and apply SDK resource-binding checks when the token carries a resource. Opaque-token adapters use RFC 7662 introspection and map the response into the same `AuthInfo` contract. Verifiers throw `OAuthError` with `OAuthErrorCode.InvalidToken` for rejected credentials so the core gate returns the correct challenge.

In direct mode, clients use the external authorization server's registration, authorization, and token endpoints. mcp-use serves protected-resource metadata, advertises the external authorization server, and verifies the resulting access token. The external authorization server must be advertised for the canonical resource and issue a token specifically bound to that resource, including the RFC 8707 `resource` indicator when applicable. mcp-use never handles authorization codes or client secrets in direct mode.

Better Auth is explicitly deferred. Do not port `oauthBetterAuthProvider` as part of the resource-server adapter phase. Its v2 integration will be designed separately so a Better Auth instance can compose with `MCPServer` more directly than the v1 provider wrapper. The custom provider escape hatch remains available in the meantime, but its shape does not constrain the future first-class Better Auth API.

## SDK dependency prerequisite

`@modelcontextprotocol/server`, `@modelcontextprotocol/hono`, and `@modelcontextprotocol/client` are pinned together at `2.0.0-beta.3`.

## Verify the implementation

Acceptance coverage must include:

- An official client e2e direct flow: unauthenticated MCP request, `401` challenge, protected-resource metadata retrieval, external OAuth authorization and token acquisition, retry, then an authorized `tools/call`.
- Missing and malformed token `401 invalid_token`; expired token `401 invalid_token`; endpoint scope failure `403 insufficient_scope`; expected `WWW-Authenticate` `resource_metadata`.
- Exact-route protection: public discovery routes work without bearer auth, while only the configured MCP endpoint is gated.
- A custom Hono composition that stores `authInfo` and forwards it through `mountMcp`.
- Canonical URL, `basePath`, MCP path, `MCP_URL`, path-aware metadata, and unsafe-derivation configuration tests.
- URL validation tests for HTTPS, localhost exceptions, path matching, queries, fragments, and trailing slashes.
- Context parity: `user`, `payload`, `accessToken`, `scopes`, and `permissions`, plus `clientId`, `expiresAt`, and `resource`.
- Provider contract tests for JWT issuer, audience, expiry, resource binding, JWKS caching, opaque-token introspection, and verified claim mapping.
- Compile-time tests proving `ctx.auth` is present with `oauth`, unavailable without it, and retains each provider user type.
- Concurrency tests proving identity isolation by construction with fresh per-request SDK servers and explicit `authInfo` forwarding.

## Migrate from v1

Migrate provider concepts and public context compatibility, not deferred behavior:

- Port the Clerk, Auth0, WorkOS, Supabase, and Keycloak provider concepts and their typed user mappings.
- Defer Better Auth to a separate integration design; do not carry the v1 provider API forward by default.
- Deferred behavior is excluded from this implementation phase.
- Preserve `user`, `payload`, `accessToken`, `scopes`, and `permissions` on `ctx.auth`.
- In direct mode, `accessToken` aliases verified SDK `AuthInfo.token`.
- Do not port `verifyJwt: false` or any decode-only authentication path.
- Do not port v1's unauthenticated `HEAD` bypass on the MCP endpoint. Beta.3 bearer authentication gates every method on that route; metadata routes retain public `HEAD` support.
- Replace v1 context storage with explicit `handler.fetch(..., { authInfo })` forwarding and `toRequestContext` / `toAuthenticatedRequestContext` projection.
- Do not claim beta.3 helpers are pending, Express-only, or supplied by an upstream Hono auth feature. Use only beta.3 resource-server helpers.
