# mcp-use authorization spec

**Status:** Direct resource-server mode implemented. OAuth proxy mode is deferred; its design remains in this document.

> **Implementation phase note:** OAuth proxy mode is deferred and must not be implemented in the current auth implementation phase. Its detailed future design remains in this document. Direct resource-server mode follows [AUTH_IMPLEMENTATION.md](./AUTH_IMPLEMENTATION.md).

**Protocol basis:** Current [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) (revision 2025-11-25) and [MCP security guidance](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices), OAuth 2.1 resource-server guidance, and `@modelcontextprotocol/server@2.0.0-beta.4`. Beta.4 provides runtime-neutral resource-server helpers in server core; it does not provide authorization-server primitives.

**Scope:** This is the v2 resource-server contract. Direct external-authorization-server mode is the default. mcp-use verifies an access token when its external authorization server is advertised for the canonical MCP resource and the token is issued specifically for that resource. This is direct mode, not proxy pass-through.

An explicit proxy mode makes mcp-use a local OAuth authorization server for MCP clients. It registers a unique local client per MCP client, obtains and stores upstream credentials server-side under one fixed upstream client identity that represents the proxy itself (never an individual end user or local client), and issues local MCP tokens. It never passes upstream tokens to MCP clients.

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

`oauth` configures a resource server. In direct mode, its provider tells mcp-use how to verify bearer tokens and which external authorization servers to advertise in protected-resource metadata. In proxy mode, it also configures the local authorization server that protected-resource metadata advertises.

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

export interface OAuthProxyProviderOptions<TUser> extends OAuthResourceOptions {
  upstream: {
    issuer: URL | string;
    authorizationEndpoint: URL | string;
    tokenEndpoint: URL | string;
    /** Identifies the proxy itself to the upstream authorization server. Not a per-user or per-local-client identity. */
    clientId: string;
    clientAuthentication: OAuthProxyUpstreamClientAuthentication;
    /** Verifies or introspects the upstream access token returned from the code exchange. */
    tokenVerifier: OAuthTokenVerifier;
    /**
     * Whether the upstream authorization server issues an RFC 9207 `iss` parameter on the callback.
     * When `true`, the callback validates it. When `false`, the proxy relies on pinned `issuer`,
     * `authorizationEndpoint`, and `tokenEndpoint` plus the single fixed callback as a reduced,
     * configuration-based mix-up defense; see "Support proxy provider capabilities" below.
     */
    supportsIssuerIdentification: boolean;
    /** Full set of upstream scopes the fixed client is authorized to request. */
    scopes: readonly string[];
    supportsRefreshTokens?: boolean;
    /**
     * Explicit upstream authorization-request PKCE capability. `"S256"` is the only supported
     * method; there is no other value that enables PKCE. `"unsupported"` is a documented
     * compatibility limitation for a provider that lacks upstream PKCE, chosen deliberately rather
     * than defaulted, since there is no safe implicit default for this security control.
     */
    pkce: "S256" | "unsupported";
  };
  /** Determines which upstream scopes are requested and shown on consent for approved local scopes. */
  scopeMapping: OAuthProxyScopeMapping;
  /** Durable storage for internal proxy records. See "Persist proxy state safely". */
  storage: OAuthProxyStorage;
  /**
   * Explicitly permits `development-only` storage and emits a warning.
   * Defaults to `false`; never enable it in production.
   */
  allowInsecureStorageForDevelopment?: boolean;
  /** Signs local JWT access and refresh tokens. All proxy replicas use the same key material. */
  signing: OAuthProxySigningKey;
  /**
   * Authenticates local consent cookies. All proxy replicas use the same key material.
   * This key is distinct from the JWT signing key and uses the same explicit key type contract
   * as `OAuthProxySigningKey.key`.
   */
  consentCookieKey: CryptoKey | Uint8Array;
  /** Renders the local consent page and resolves user decisions. Consent precedes upstream identity. */
  consent: OAuthProxyConsent;
  /**
   * Maps freshly verified upstream `AuthInfo` into the public mcp-use auth context. Proxy mode
   * calls this for every successful local bearer verification, never at grant creation.
   */
  mapAuthInfo: (upstreamAuthInfo: OAuthAuthInfo) => OAuthExtra<TUser>;
  /** Local issuer, route, and lifetime overrides. Defaults are defined below. */
  local?: OAuthProxyLocalOptions;
}

/**
 * A declarative, deterministic mapping from local scopes to upstream scopes. Never forwards local
 * scopes as-is and never runs caller code to compute the mapping. Supported local scopes are
 * exactly the keys of `upstreamScopesByLocalScope`; there is no separate `localScopes` list to
 * keep in sync. `oauthProxyProvider` validates at construction time that every upstream scope
 * named anywhere in `upstreamScopesByLocalScope` is a member of `upstream.scopes`; construction
 * fails otherwise. For an approved set of local scopes, the proxy requests and displays on
 * consent the stable, deduplicated union of `upstreamScopesByLocalScope[localScope]` across those
 * scopes, in the fixed order `upstreamScopesByLocalScope` defines. A request naming a local scope
 * outside these keys is rejected with `invalid_scope`. This removes arbitrary mapping code,
 * exponential subset enumeration, and request-time nondeterminism checks entirely: the mapping is
 * data, so it cannot be nondeterministic.
 */
export interface OAuthProxyScopeMapping {
  /** Upstream scopes to request and display on consent for each supported local scope. */
  readonly upstreamScopesByLocalScope: Readonly<Record<string, readonly string[]>>;
}

/**
 * Credentials used only when the proxy calls the upstream token endpoint. Scoped to confidential-client
 * methods with a concrete secret for the first implementation. `private_key_jwt` is not offered until its
 * signing algorithm, key rotation, and assertion contract are separately specified.
 */
export interface OAuthProxyUpstreamClientAuthentication {
  readonly method: "client_secret_basic" | "client_secret_post";
  /** Server-only. Never returned in a response, log, trace, or error. */
  readonly clientSecret: string;
}

/**
 * Release one supports symmetric signing only, matching the FastMCP precedent: HS256 with one
 * shared server-only HMAC key. Asymmetric signing is not offered in release one. `key` must be
 * either a non-extractable HMAC `CryptoKey` (algorithm `HMAC` with hash `SHA-256`) or a
 * `Uint8Array` of at least 32 bytes; an ambiguous raw string is not accepted, and mcp-use does not
 * derive a key from a password or other low-entropy input. The same configured key material must
 * be available to every proxy replica, since any replica may verify a token another replica
 * issued. `keyId` is optional and, when present, is carried as the JWT header `kid`.
 */
export interface OAuthProxySigningKey {
  readonly algorithm: "HS256";
  readonly key: CryptoKey | Uint8Array;
  readonly keyId?: string;
}

/**
 * Generic key-value storage used only by mcp-use internal record adapters. Values are opaque
 * serialized internal records. Production implementations must be shared by all replicas and
 * provide authenticated encryption at rest and key rotation through the storage system or its
 * wrapper; mcp-use never implements that encryption itself. A caller-supplied
 * unencrypted or in-memory implementation is allowed only for local development and tests.
 *
 * `protection` makes the storage's security mode explicit and detectable without mcp-use
 * inspecting how the implementation handles encryption. `"encrypted-at-rest"` declares that the
 * storage system or its wrapper provides authenticated encryption at rest and key rotation.
 * `"development-only"` declares that it does not. `oauthProxyProvider` rejects `"development-only"`
 * storage unless `allowInsecureStorageForDevelopment` is explicitly `true`, and always logs a clear,
 * unavoidable warning when that override is used.
 */
export interface OAuthProxyStorage {
  readonly protection: "encrypted-at-rest" | "development-only";
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array, options?: { expiresAt?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomically reads, validates, and consumes a TTL-bound record. */
  consume(key: string): Promise<Uint8Array | undefined>;
  /** Atomically applies a compare-and-swap or transaction callback for consume and rotation flows. */
  transact<T>(operation: (transaction: OAuthProxyStorageTransaction) => Promise<T>): Promise<T>;
}

export interface OAuthProxyStorageTransaction {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array, options?: { expiresAt?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  consume(key: string): Promise<Uint8Array | undefined>;
}

/**
 * A validated, transaction-bound consent request. Identity is not yet known; only local request and client
 * data is present. Every field the renderer needs to show comes from the loaded transaction and client record.
 */
export interface OAuthProxyConsentRequest {
  readonly transactionId: string;
  readonly csrfToken: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly localScopes: readonly string[];
  readonly upstreamScopes: readonly string[];
}

/** The outcome of a submitted consent decision. */
export interface OAuthProxyConsentDecision {
  readonly approved: boolean;
  /** Opaque local subject id, present only when the deployment binds approval to an authenticated local session. */
  readonly subject?: string;
}

/**
 * Renders and resolves local consent. Consent happens before any upstream identity exists, so this seam
 * is not parameterized by `TUser`. By default every flow requires a fresh consent decision.
 *
 * CSRF ownership: mcp-use's internal `OAuthProxyStorage` transaction adapter generates and persists each transaction's `csrfToken` (see
 * `OAuthProxyTransaction`) when it is created; that value is the only source of truth. `render` receives it
 * so the page can embed it in the approval form. `resolveDecision` receives the same loaded `transaction` and
 * must verify the value submitted on the request against `transaction.csrfToken` before returning
 * `approved: true`; a missing or mismatched token must resolve to `approved: false`. The consent adapter owns
 * the verification step, but never the token's origin or persistence.
 *
 * `findReusableApproval` is optional and lets a deployment with its own authenticated local sessions skip the
 * page when an exact prior approval for the same client, redirect URI, resource, and scopes exists for the
 * current session. Do not implement default reuse from upstream consent cookies or from `TUser`, which is
 * unknown at this point in the flow.
 */
export interface OAuthProxyConsent {
  render: (request: OAuthProxyConsentRequest) => Response | Promise<Response>;
  resolveDecision: (
    request: Request,
    transaction: OAuthProxyTransaction,
  ) => Promise<OAuthProxyConsentDecision>;
  findReusableApproval?: (
    request: Request,
    context: {
      clientId: string;
      redirectUri: string;
      resource: string;
      localScopes: readonly string[];
    },
  ) => Promise<{ subject: string } | undefined>;
}

/** A pending or resolved local authorization transaction, keyed by an opaque `transactionId`. */
export interface OAuthProxyTransaction {
  readonly transactionId: string;
  readonly csrfToken: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly localScopes: readonly string[];
  readonly resource: string;
  readonly downstreamCodeChallenge: string;
  readonly originalState: string;
  readonly approved: boolean;
  readonly subject?: string;
  /** Absolute expiry covering consent through the upstream callback. See `OAuthProxyLocalOptions.transactionTtlSeconds`. */
  readonly expiresAt: number;
}

/**
 * Internal adapters serialize only these conceptual records in `OAuthProxyStorage`: local client
 * registration; transaction and proxy-owned upstream state; one-use local code carrying or
 * referencing an upstream token response; private upstream token-vault record; local JWT JTI to
 * vault mapping; and refresh-token hash/index metadata. The records are not public interfaces.
 *
 * Local JWT structure is exact. The protected header is `{ alg: "HS256", typ: "JWT" }`, plus
 * `kid` when `OAuthProxySigningKey.keyId` is configured. The payload contains exactly `iss`
 * (local issuer), `aud` (canonical MCP resource), `client_id` (local client ID), `scope` (a
 * single space-delimited OAuth scope string, not an array), `iat`, `exp`, a random `jti`, and a
 * private claim `token_use` with value `"access"` or `"refresh"`. The payload never repeats or
 * aliases the header's `typ`; `token_use` is the only place that distinguishes access from
 * refresh tokens, precisely so it cannot be confused with the JWT protected-header `typ`, which
 * always stays the fixed string `"JWT"`. No upstream token, mapped identity, payload, permissions,
 * or vault identifier is embedded in either JWT.
 */

/**
 * Local issuer, route, and lifetime overrides. The callback route is derived read-only from `issuer` and
 * `routes.callback`; it is not independently configurable, so it stays a single fixed URL. Operators
 * register that exact URL as the redirect URI with the upstream authorization server.
 *
 * The first release does not implement or advertise a public revocation endpoint, so there is no `revoke`
 * route here; see "Apply endpoint protections" for the internal-only revocation this design still requires.
 */
export interface OAuthProxyLocalOptions {
  /** Absolute local issuer URL under the server origin. Defaults to `<server-origin>/oauth`. */
  issuer?: URL | string;
  routes?: {
    authorize?: string;
    token?: string;
    register?: string;
    callback?: string;
  };
  /** Lifetime of a pending transaction, covering consent through the upstream callback. Default 600 (10 minutes). */
  transactionTtlSeconds?: number;
  /** Local authorization-code lifetime in seconds. Default 60. */
  codeTtlSeconds?: number;
  /** Local access-token lifetime in seconds. Default 900 (15 minutes). */
  accessTokenTtlSeconds?: number;
  /**
   * Local refresh-token family lifetime in seconds. Required when `upstream.supportsRefreshTokens` is `true`;
   * otherwise ignored, because local refresh tokens are not issued by default.
   */
  refreshTokenTtlSeconds?: number;
}

/** Creates a provider that also owns local OAuth authorization-server routes. */
export function oauthProxyProvider<TUser>(
  options: OAuthProxyProviderOptions<TUser>,
): OAuthProvider<TUser>;

/**
 * Trusted inputs for mounting the local authorization-server route seam. Every value comes from resolved
 * configuration or the canonical resource (see "Resolve the canonical resource URL"), never from an
 * untrusted request `Host` header.
 */
interface OAuthLocalRouteContext {
  readonly resource: URL;
  readonly serverOrigin: URL;
  readonly issuer: URL;
  readonly routes: {
    readonly authorize: URL;
    readonly token: URL;
    readonly register: URL;
    readonly callback: URL;
  };
}

/**
 * Not exported. Present only on the internal shape of proxy providers; direct and custom providers leave
 * it `undefined`. `mount` registers the proxy's metadata, register, authorize, consent, callback, and token
 * routes on the given Hono app using web-standard `Request`/`Response` handlers, the same architecture as
 * the rest of this seam. `MCPServer` calls it before registering the exact MCP bearer gate; see "Run routes
 * in this order".
 */
interface OAuthLocalAuthServerRoutes<TUser> {
  mount(app: Hono, context: OAuthLocalRouteContext): void;
}

/** Not exported. Proxy providers add local authorization-server routes. */
interface OAuthProviderInternal<TUser> extends OAuthProvider<TUser> {
  /**
   * Present only for proxy providers, populated by `oauthProxyProvider`. The provider's `tokenVerifier` is then the
   * proxy's own local-token verifier, not `upstream.tokenVerifier`; see "Reconcile the wrapper for proxy
   * providers" below for how that interacts with `mapAuthInfo`.
   */
  localAuthServer?: OAuthLocalAuthServerRoutes<TUser>;
}
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

### Reconcile the wrapper for proxy providers

Proxy providers use this identical wrapper contract, but their `tokenVerifier` and `mapAuthInfo` play different roles than for direct or custom providers. For a proxy provider, `tokenVerifier` is the proxy's own local-JWT verifier described in "Issue and verify local tokens", not `upstream.tokenVerifier`. It verifies the local JWT, resolves its JTI mapping and private upstream token-vault record, refreshes first when required, verifies the stored upstream access token, then calls the provider option's `mapAuthInfo` on that freshly verified result. It attaches the resulting `OAuthExtra<TUser>` to `AuthInfo.extra` before the wrapper runs.

The proxy provider's exposed `mapAuthInfo` is therefore a validate-and-return hook: it asserts that `authInfo.extra` already has the shape `OAuthExtra<TUser>` (the same `user`, `payload`, `permissions` checks `requireOAuthAuthInfo` performs later) and returns it unchanged. It never calls the provider option's `mapAuthInfo` again and never performs an unsafe cast in place of that check. The option callback runs on every successful proxy bearer verification, after fresh upstream verification, rather than during grant creation.

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
- `ctx.auth.user`, `ctx.auth.payload`, and `ctx.auth.permissions` come from `sdkAuthInfo.extra`

All providers supply typed mcp-use additions through `mapAuthInfo`. The wrapper merges the result under `AuthInfo.extra`; a provider may retain unrelated SDK `extra` fields, but mcp-use's fields always come from verified data. It must not populate user data from an unverified decode. Proxy providers are the one exception to `mapAuthInfo` computing this data itself; see "Reconcile the wrapper for proxy providers" for why their callback only validates and returns freshly mapped data.

## Run routes in this order

The MCP request path creates a fresh SDK server per request. Direct providers are otherwise stateless. Proxy providers require durable shared storage and shared signing and consent-cookie key material. Route and request ordering is exact:

1. Register public OAuth discovery and protected-resource metadata routes. For a direct provider this is the existing `oauthMetadataResponse` composition. For a proxy provider, call `internal.localAuthServer.mount(app, context)` first; it registers the local metadata, register, authorize, consent, callback, and token routes using the trusted `OAuthLocalRouteContext`, never a request `Host` header.
2. Register the exact MCP endpoint bearer gate. Do not protect a broad prefix that unintentionally covers the routes from step 1 or unrelated routes.
3. The gate calls `requireBearerAuth(...)` and stores a successful `AuthInfo` in Hono variables.
4. `mountMcp` reads the Hono variable and forwards it as `MountMcpOptions.authInfo` to `handler.fetch`.
5. The MCP route creates the SDK server factory for this request with the forwarded `authInfo`.
6. Callback execution receives SDK `ctx.http.authInfo`; `toAuthenticatedRequestContext` (or `toRequestContext` when OAuth is not configured) projects it once to mcp-use callback context.

```ts
const providerOptions = getOAuthProviderOptions(provider);
const internal = resolveOAuthProvider(provider);

if (internal.localAuthServer !== undefined) {
  internal.localAuthServer.mount(app, localRouteContext);
}

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

Beta.3 does not provide authorization-server, DCR, consent, authorization-code, token, or proxy helpers in server core. Those helpers are frozen in `server-legacy` and must not be reused for this clean v2 implementation. mcp-use owns new Hono and web-standard routes for local proxy authorization-server behavior.

`requireBearerAuth` is the sole bearer gate. Its outcomes are:

- Missing, malformed, invalid, or expired bearer tokens return `401` with `invalid_token`.
- Missing endpoint-required scopes return `403` with `insufficient_scope`.
- Unexpected non-OAuth verifier failures return `500` with `server_error`.
- The `WWW-Authenticate` challenge includes the `resource_metadata` URL for the canonical resource.

Use `oauthMetadataResponse` for direct-provider public discovery routes with the concrete external authorization-server metadata and resource metadata options:

```ts
app.use("*", async (c, next) => {
  const response = oauthMetadataResponse(c.req.raw, {
    oauthMetadata: internal.oauthMetadata,
    resourceServerUrl: resource,
    ...(internal.scopesSupported !== undefined && {
      scopesSupported: [...internal.scopesSupported],
    }),
    ...(internal.resourceName !== undefined && {
      resourceName: internal.resourceName,
    }),
    ...(internal.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: internal.serviceDocumentationUrl,
    }),
  });

  if (response !== undefined) return response;
  await next();
});
```

For direct providers, it serves path-aware protected-resource metadata at `/.well-known/oauth-protected-resource/<resource path>` and authorization-server metadata at `/.well-known/oauth-authorization-server`. It supports `GET`, `HEAD`, and `OPTIONS` with CORS, and falls through for unmatched paths. Proxy providers register their local authorization-server metadata explicitly so it can accurately advertise only implemented local capabilities.

## Use Hono as the host adapter

No upstream `@modelcontextprotocol/hono` auth feature is required. Beta.3 deliberately places web-standard authorization helpers in server core so they work in Hono, Workers, Deno, Bun, and other `Request`/`Response` hosts.

Hono handles body parsing, configured host validation, and origin validation. mcp-use exports thin ergonomic adapters from `mcp-use/oauth`:

- `bearerAuth(provider, resource)` invokes `requireBearerAuth` and stores `authInfo` in Hono variables.
- `oauthMetadata(provider, resource)` serves direct-provider `oauthMetadataResponse` and falls through on unrelated routes.
- `MountMcpOptions.authInfo` forwards custom middleware results through `mountMcp`.

Those adapters are conveniences for normal and custom composition. An upstream Hono convenience wrapper is optional and not a blocker.

## Port provider adapters after the seam

The first implementation phase supplies only the resource-server seam. The next phase ports five v1 provider adapters:

1. Clerk with `oauthClerkProvider`
2. Auth0 with `oauthAuth0Provider`
3. WorkOS with `oauthWorkOSProvider`
4. Supabase with `oauthSupabaseProvider`
5. Keycloak with `oauthKeycloakProvider`

Each adapter verifies tokens, maps verified claims to a typed `user`, preserves the verified payload, provides normalized permissions, and advertises its authorization-server metadata. Each adapter must map claims rather than cast decoded payloads. No adapter offers `verifyJwt: false`.

JWT adapters share a `jose` implementation for remote JWKS caching and signature verification. They always validate issuer and expiry and establish that every token was issued for the canonical MCP resource by validating its audience or RFC 8707 resource binding; a token for which the provider cannot establish that binding is rejected. Opaque-token adapters use RFC 7662 introspection and likewise require the introspection result to establish the canonical MCP resource before mapping it into the same `AuthInfo` contract. Verifiers throw `OAuthError` with `OAuthErrorCode.InvalidToken` for rejected credentials so the core gate returns the correct challenge.

In direct mode, clients use the external authorization server's registration, authorization, and token endpoints. mcp-use serves protected-resource metadata, advertises the external authorization server, and verifies the resulting access token. The external authorization server must be advertised for the canonical resource and issue a token specifically bound to that resource, including the RFC 8707 `resource` indicator when applicable. mcp-use never handles authorization codes or client secrets in direct mode.

Better Auth is explicitly deferred. Do not port `oauthBetterAuthProvider` as part of the resource-server adapter phase. Its v2 integration will be designed separately so a Better Auth instance can compose with `MCPServer` more directly than the v1 provider wrapper. The custom provider escape hatch remains available in the meantime, but its shape does not constrain the future first-class Better Auth API.

## Use proxy mode as a local authorization server

Proxy mode is explicit. It is for an upstream authorization server that cannot participate in the direct MCP flow. It makes mcp-use the complete local OAuth authorization server for MCP clients. Each MCP client registers as its own unique local client with its own `client_id`. The fixed upstream `client_id` never identifies an individual local client or end user; it identifies only the proxy deployment to the upstream authorization server.

### Design precedent

This design takes non-normative precedent from FastMCP's current OAuth proxy architecture: it issues local JWTs, maps local JWT JTIs to private upstream token records, uses a generic pluggable store, and relies on storage-wrapper encryption rather than application-facing encryption methods. See PrefectHQ/fastmcp's [proxy implementation](https://github.com/PrefectHQ/fastmcp/blob/main/fastmcp_slim/fastmcp/server/auth/oauth_proxy/proxy.py) (inspected at commit `1d932cc778a24cc0bf46fc4baad8306d4fed9c4b` on 2026-07-09) and the [OAuth Proxy documentation](https://gofastmcp.com/servers/auth/oauth-proxy). mcp-use retains its own public contract and security requirements.

### Support proxy provider capabilities

The first proxy implementation requires an upstream authorization server that supports:

- The OAuth 2.1 authorization-code grant. When `upstream.pkce` is `"S256"`, the proxy requires PKCE with `code_challenge_method=S256`. `upstream.pkce: "unsupported"` is an explicit, deliberately chosen compatibility limitation, documented for the deployment, that omits upstream PKCE entirely; it is never an implicit default.
- One exact, fixed redirect URI for the proxy's callback (see below). Upstream authorization servers that only accept dynamically varying redirect URIs per end user are out of scope.
- Confidential-client authentication at the token endpoint using `client_secret_basic` or `client_secret_post`.
- A way to verify or introspect the issued access token, either locally (for example a validated JWT) or through an introspection endpoint, so `upstream.tokenVerifier` can produce verified `AuthInfo`.
- Scopes that the configured `scopeMapping` can request; the proxy does not infer or guess upstream scopes, and every upstream scope named in `scopeMapping.upstreamScopesByLocalScope` is validated against `upstream.scopes` at construction, as described on `OAuthProxyScopeMapping`.

Refresh is offered only when `upstream.supportsRefreshTokens` is `true` and the upstream authorization server reliably supports server-side refresh. The first release does not implement or advertise a public revocation endpoint at all; see "Apply endpoint protections" for the internal-only revocation this design still requires for security events.

RFC 9207 issuer identification in the callback response is required and validated only when `upstream.supportsIssuerIdentification` is `true`. When the upstream authorization server does not support RFC 9207, the proxy instead pins `upstream.issuer`, `upstream.authorizationEndpoint`, and `upstream.tokenEndpoint` from static configuration and relies on the single fixed callback URI as its main authorization-server mix-up defense. That configuration-only defense is weaker than validated `iss`, so operators integrating such a provider should prefer one that supports RFC 9207 when a choice exists.

### Configure local discovery and routes

By default, the local issuer is `<server-origin>/oauth`, with these public routes:

- `<issuer>/authorize`
- `<issuer>/token`
- `<issuer>/register`
- `<issuer>/callback`, the fixed proxy callback described below
- `<server-origin>/.well-known/oauth-authorization-server/oauth` for local RFC 8414 metadata

Protected-resource metadata for the canonical MCP resource advertises only this local issuer as `authorization_servers`; in proxy mode it never lists the upstream issuer, so MCP clients only ever discover and talk to the local authorization server.

Local RFC 8414 metadata at `<server-origin>/.well-known/oauth-authorization-server/oauth` is exact:

```json
{
  "issuer": "<issuer>",
  "authorization_endpoint": "<issuer>/authorize",
  "token_endpoint": "<issuer>/token",
  "registration_endpoint": "<issuer>/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"]
}
```

`grant_types_supported` includes `"refresh_token"` only when `upstream.supportsRefreshTokens` is configured `true`; otherwise it stays exactly `["authorization_code"]`. `token_endpoint_auth_methods_supported` is always exactly `["none"]`, matching every local client being a public client with no `client_secret`. There is no `revocation_endpoint` field and no `/revoke` route in the first release; grant and refresh-family revocation exist only as internal store operations triggered by security events, not as a client-facing endpoint. There is no `client_id_metadata_document_supported` field in the first release either.

The current MCP specification (2025-11-25) makes Client ID Metadata Documents a SHOULD and keeps DCR as a MAY; see [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and the [OAuth Client ID Metadata Document draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/). The first proxy implementation supports RFC 7591 DCR only and does not advertise `client_id_metadata_document_supported` until Client ID Metadata Documents are implemented separately. See [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591). This is deliberate scope, not a claim that DCR is the preferred current MCP path.

The local issuer and resource must use HTTPS outside localhost. `local` options may override route paths, the issuer, and token lifetimes only when they remain absolute, canonical, non-query URLs under the configured server origin. The callback route itself is derived read-only from `issuer` and `routes.callback`; operators register that exact, single URL as the redirect URI with the upstream authorization server.

### Register a unique local public client

`POST /oauth/register` accepts a JSON RFC 7591 registration request body and creates one unique local public `client_id`. Internal storage adapters persist the validated registration. Validation is exact:

- `redirect_uris` must be a non-empty array of absolute URIs, each HTTPS outside a loopback development exception, with no fragment and no wildcard segment. Any other value returns `invalid_redirect_uri`.
- `client_name` must be a non-empty string, because the consent page must clearly identify the client to the user. A missing or empty value returns `invalid_client_metadata`.
- `response_types`, when present, must be exactly `["code"]`; omitting it is equivalent to `["code"]`. Any other value returns `invalid_client_metadata`.
- `grant_types`, when present, must be a subset of `["authorization_code"]`, plus `"refresh_token"` only when `upstream.supportsRefreshTokens` is configured `true`; omitting it is equivalent to `["authorization_code"]`. Any other value returns `invalid_client_metadata`.
- `token_endpoint_auth_method`, when present, must be exactly `"none"`, since every local client is a public client; omitting it is equivalent to `"none"`. Any other value returns `invalid_client_metadata`.
- Unknown metadata fields are ignored per RFC 7591; invalid values for supported fields return `invalid_client_metadata`.

On success, the route responds `201 Created` with `Cache-Control: no-store` and a JSON body containing the new `client_id`, a `client_id_issued_at` Unix timestamp, and the accepted metadata echoed back: `redirect_uris`, `client_name`, `response_types: ["code"]`, `grant_types` (as resolved above), and `token_endpoint_auth_method: "none"`. The response never includes a `client_secret`, and the first release has no client-configuration management API, so it never includes `registration_client_uri` or `registration_access_token`. The internal adapter loads `clientName` with the client ID and redirect URIs for consent.

The fixed upstream `client_id` and client authentication are never returned, advertised, or accepted as a local client identity. They identify the proxy to the upstream authorization server only, and remain distinct from every unique local `client_id` the proxy issues.

Redirect matching against a stored URI uses exact string comparison; validation performed at registration time does not alter the string that gets stored or later compared. Prefix, suffix, origin-only, and wildcard matching are forbidden.

### Require consent before upstream authorization

`GET /oauth/authorize` validates a local authorization request before any upstream redirect:

- `response_type` is exactly `code`.
- `client_id` identifies a unique registered local client.
- `redirect_uri` exactly matches one registered URI string.
- `state` is present.
- PKCE is required with `code_challenge_method=S256`.
- `resource` is the canonical MCP resource.
- requested local scopes are within the keys of `scopeMapping.upstreamScopesByLocalScope`.

Upstream identity is not yet known at this point, so consent cannot be keyed by `TUser`. The internal transaction adapter assigns the `csrfToken` and `expiresAt` that govern the rest of the flow, then the proxy calls `consent.render` with an `OAuthProxyConsentRequest` built from that transaction and the client record: `clientId`, `clientName`, exact `redirectUri`, `resource`, requested `localScopes`, and the `upstreamScopes` computed as the stable deduplicated union of `scopeMapping.upstreamScopesByLocalScope` entries for them. The consent page uses a restrictive `Content-Security-Policy` with `frame-ancestors 'none'` or an equivalent clickjacking defense.

The internal transaction adapter owns the CSRF token: it generates and persists `csrfToken` on the transaction and is the only source of truth for its value. `consent.resolveDecision` receives the raw submission `Request` and the same loaded `OAuthProxyTransaction`, and must verify the value submitted on the form against `transaction.csrfToken` before returning `approved: true`; a missing or mismatched value resolves to `approved: false`. The consent adapter owns performing that check, never the token's origin.

By default, every flow requires a fresh consent decision. A deployment may implement `consent.findReusableApproval` to skip the page when its own authenticated local session already recorded an exact prior approval for the same client, redirect URI, resource, and scopes; the default omits this hook, so the default never reuses upstream consent cookies or an unauthenticated guess at identity. The internal transaction adapter persists the decision, and only after `approved` is true does the proxy create upstream state and, where supported, upstream PKCE. No upstream state or session exists before approval. It reloads the transaction when the consent form is re-rendered or resubmitted, and expired records cannot proceed.

### Keep the two authorization-code flows separate

After consent, the proxy redirects to the upstream authorization endpoint using the fixed upstream `client_id`, one fixed proxy callback URI, and proxy-owned state. When `upstream.pkce` is `"S256"`, it also creates a separate upstream S256 PKCE verifier and challenge, stores the verifier server-side with the state, and sends only the challenge; when `upstream.pkce` is `"unsupported"`, it sends no upstream PKCE parameters at all. It preserves the local request's mandatory downstream PKCE challenge and original local `state` only in the durable local transaction, never in the upstream request. The transaction and state expire no later than `OAuthProxyLocalOptions.transactionTtlSeconds`.

`GET /oauth/callback` atomically consumes the proxy-owned upstream state exactly once. It obtains the bound transaction and, when `upstream.pkce` is `"S256"`, the upstream PKCE verifier needed for the exchange. Missing, consumed, or expired state returns a local error page. When `upstream.supportsIssuerIdentification` is `true`, the callback validates the returned `iss` against `upstream.issuer` and rejects a mismatch.

The callback exchanges the upstream code server-side using the fixed upstream client authentication and, when `upstream.pkce` is `"S256"`, the recovered verifier. It stores the returned upstream token set only in a private token-vault record. It does not call `mapAuthInfo` at grant creation and does not persist mapped identity. The storage deployment protects vault records at rest according to its declared `protection` mode.

The callback stores a new one-time local authorization code with the configured `expiresAt` (see `OAuthProxyLocalOptions.codeTtlSeconds`), bound to the transaction (local client, exact redirect URI, downstream PKCE challenge, canonical resource, approved scopes) and the private vault record. It redirects to the registered local redirect URI with that local code and the original local `state`.

The upstream code, upstream access token, upstream refresh token, upstream client ID, and upstream client secret never appear in a browser redirect or local token response.

### Issue and verify local tokens

`POST /oauth/token` atomically consumes the local code exactly once; a missing, consumed, or expired code returns `invalid_grant`. After validating the local client, exact redirect URI, mandatory downstream S256 PKCE verifier, resource, and scopes against the loaded transaction, it issues a short-lived signed local JWT access token (`token_use: "access"`) bound to the local client, resource, scopes, and private vault record. Its issuer, audience/resource, and client identity are local. The JWT contains exactly the header and payload fields defined in the storage-record contract above and gets a random `jti` whose storage mapping points to the vault record.

Local bearer verification first verifies the signed local JWT's HS256 signature using the configured shared HMAC key, then verifies local issuer, canonical MCP audience/resource, expiry, `token_use: "access"`, client ID, scopes, and `jti`. It loads the `jti`-to-vault mapping and vault record, rejecting a missing, revoked, or expired record. If the upstream access token is expired or near expiry and refresh is configured, it refreshes server-side and atomically updates the vault before verification. It then calls `upstream.tokenVerifier` on the stored upstream access token and calls public `mapAuthInfo` on the freshly verified upstream `AuthInfo`. It builds SDK `AuthInfo` from local JWT claims plus that mapped extra. A verifier outage or failure rejects the bearer token for that request. Deleting or revoking the `jti` mapping invalidates a local JWT even while its signature and `exp` remain valid. `ctx.auth.accessToken` is the signed local MCP JWT in proxy mode, never an upstream credential.

This whole sequence is exactly `tokenVerifier` for the proxy's provider (see "Reconcile the wrapper for proxy providers"). It runs inside the standard `requireBearerAuth` wrapper like any other provider; only its `mapAuthInfo` differs, validating and returning the `extra` this verifier already attached instead of computing it.

Tools that require an upstream credential need a separate, explicit server-side capability that resolves the private vault record. That capability is not exposed through `ctx.auth.accessToken`.

### Rotate local refresh tokens

Local refresh tokens are signed local JWTs, never upstream refresh tokens. They use `token_use: "refresh"`, a random `jti`, and the same minimal header and payload structure as access tokens. Their `jti` mapping and refresh hash/index metadata bind them to the local client, resource, vault record, and rotation family with an explicit expiry from `OAuthProxyLocalOptions.refreshTokenTtlSeconds`.

`POST /oauth/token` with `grant_type=refresh_token` verifies the local refresh JWT and atomically consumes and rotates its `jti` mapping. Reuse of an already-consumed `jti` is a replay signal that revokes the token family. The token endpoint returns a uniform `invalid_grant` for missing, invalid, revoked, or replayed refresh tokens, so internal distinctions never become a client-visible oracle.

On a successful rotation, when `upstream.supportsRefreshTokens` is configured true, the proxy refreshes the upstream vault record server-side only when its access token is at or near expiry. An upstream refresh failure revokes the vault and associated JTI mappings, and the local error response never leaks upstream detail.

Do not advertise or issue local refresh tokens unless the configured upstream behavior supports reliable server-side refresh.

### Persist proxy state safely

`OAuthProxyStorage` is the durable, shared, atomic abstraction used by internal record adapters for local registrations, transactions, upstream state, local codes, private token-vault records, JTI mappings, refresh metadata, and revocations. It must support TTL, atomic consume-and-create transitions, and multi-instance-safe compare-and-swap or equivalent transactions. Every TTL-bound record is rejected and deleted on expiry.

Store one-use codes, refresh indexes, and upstream state hashed where possible. `oauthProxyProvider` rejects storage whose `protection` is `"development-only"` unless `allowInsecureStorageForDevelopment` is explicitly `true`; the override always emits a clear, unavoidable warning and must never be enabled in production. mcp-use detects the declared capability and never inspects how the implementation handles encryption. Production storage must be shared across replicas and provide authenticated encryption at rest and key rotation through the storage system or a storage wrapper; mcp-use does not implement that encryption itself. Storage failures fail closed.

### Apply endpoint protections

Public OAuth and metadata responses set `Cache-Control: no-store` unless a safe, explicitly documented discovery cache policy applies. Authorization, callback, token, and registration responses always use `Cache-Control: no-store`. The token and registration endpoints permit only the minimum documented CORS origins and methods. They must not use wildcard CORS with credentialed requests.

Apply IP, client, and registration quotas to registration, authorization, callback, and token routes. Rate-limit malformed requests and failed code, PKCE, refresh, and client lookups without creating an oracle. Redact authorization codes, bearer tokens, refresh handles, client secrets, upstream credentials, state, and PKCE verifiers from logs, errors, traces, and metrics.

Expired, consumed, revoked, mismatched, or replayed codes, state, and refresh tokens are rejected. Local authorization-code and access-token lifetimes are short and configured explicitly through `OAuthProxyLocalOptions`. Error responses use OAuth error codes without exposing registration, consent, upstream, or storage internals:

- `/authorize` redirects only to an exactly validated registered redirect URI. It returns `invalid_request`, `unauthorized_client`, `invalid_scope`, or `access_denied` as appropriate. Without a safe redirect URI, it returns a local error page instead of any redirect.
- `/callback` returns a local error page, not a redirect, for invalid, missing, expired, or replayed upstream state, or when the stored local redirect URI cannot be validated. Once the state is valid and its stored local redirect URI is confirmed, an upstream denial or a failed code exchange redirects only to that prevalidated local redirect URI with a sanitized OAuth error code (for example `access_denied` or `server_error`) and the original local `state`. Upstream error descriptions, provider-specific error detail, and any upstream diagnostic content are never forwarded or exposed.
- `/token` returns JSON OAuth errors: `invalid_request`, `invalid_client`, `invalid_grant`, `invalid_scope`, or `unsupported_grant_type`. A reused or invalid refresh token both return `invalid_grant`, as described above.
- `/register` returns RFC 7591 errors, including `invalid_redirect_uri` and `invalid_client_metadata`.

The first release has no `/revoke` endpoint and does not advertise `revocation_endpoint` or claim RFC 7009 support. JTI mappings, token vaults, and refresh families remain internally revocable for security events (refresh-token replay, upstream refresh failure, administrative action), never as a capability exposed to OAuth clients. The proxy does not support private local clients, token exchange, arbitrary upstream client credentials, `private_key_jwt` upstream authentication, wildcard redirect URIs, browser-delivered upstream tokens, or Client ID Metadata Documents in its first release. It must not advertise unsupported capabilities. Relevant standards: [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414), [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707), [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636), [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700), and [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207).

## Meet the SDK dependency prerequisite

`@modelcontextprotocol/server`, `@modelcontextprotocol/hono`, and `@modelcontextprotocol/client` use coordinated `2.0.0-beta.4` pins.

## Verify the implementation

Acceptance coverage must include:

- An official client e2e flow: unauthenticated MCP request, `401` challenge, protected-resource metadata retrieval, OAuth authorization and token acquisition, retry, then an authorized `tools/call`.
- Missing and malformed token `401 invalid_token`; expired token `401 invalid_token`; endpoint scope failure `403 insufficient_scope`; expected `WWW-Authenticate` `resource_metadata`.
- Exact-route protection: public discovery routes work without bearer auth, while only the configured MCP endpoint is gated.
- A custom Hono composition that stores `authInfo` and forwards it through `mountMcp`.
- Canonical URL, `basePath`, MCP path, `MCP_URL`, path-aware metadata, and unsafe-derivation configuration tests.
- URL validation tests for HTTPS, localhost exceptions, path matching, queries, fragments, and trailing slashes.
- Context parity: `user`, `payload`, `accessToken`, `scopes`, and `permissions`, plus `clientId`, `expiresAt`, and `resource`.
- Provider contract tests for JWT issuer, audience, expiry, resource binding, JWKS caching, opaque-token introspection, and verified claim mapping.
- Compile-time tests proving `ctx.auth` is present with `oauth`, unavailable without it, and retains each provider user type.
- Concurrency tests proving identity isolation by construction with fresh per-request SDK servers and explicit `authInfo` forwarding.
- Proxy DCR tests prove one unique local public `client_id` per valid RFC 7591 request, `invalid_client_metadata` on a missing or empty `client_name`, that `getClient` returns the stored `clientName`, exact-string redirect URI storage and matching with no wildcard or prefix acceptance, and that fixed upstream client credentials are never advertised or returned.
- Proxy authorization tests cover required state and S256 PKCE, canonical resource and local-scope validation against the keys of `scopeMapping.upstreamScopesByLocalScope`, fresh consent by default, `consent.findReusableApproval` only skipping the page on an exact client/redirect/resource/scope match, that `consent.resolveDecision` rejects a missing or mismatched `transaction.csrfToken`, clickjacking defenses, expired-transaction rejection, and no upstream state created before approval.
- Proxy callback tests prove upstream state is single-use and expiry-bound, `iss` is validated when `upstream.supportsIssuerIdentification` is `true` and rejected on mismatch, the upstream code is exchanged server-side with the recovered S256 verifier when `upstream.pkce` is `"S256"`, an explicit `upstream.pkce: "unsupported"` compatibility configuration sends no upstream PKCE parameters, only a local code plus the original local state reaches the local redirect URI, invalid or replayed state produces a local error page rather than a redirect, and a post-state upstream denial or exchange failure redirects only to the prevalidated local redirect URI with a sanitized error and no upstream diagnostic detail.
- Scope-mapping tests prove local scopes are never forwarded to the upstream authorization server unmapped, that a local scope outside the keys of `upstreamScopesByLocalScope` is rejected with `invalid_scope`, that construction fails when any upstream scope named in `upstreamScopesByLocalScope` is missing from `upstream.scopes`, and that consent and the upstream authorization request both show the stable deduplicated union of upstream scopes for the approved local scopes.
- Local token tests prove configured HS256 signing and verification with the shared HMAC key, rejection of a non-`CryptoKey`, under-length, or otherwise ambiguous key at construction, the exact header (`alg: "HS256"`, `typ: "JWT"`, optional `kid`) and payload (`iss`, `aud`, `client_id`, `scope`, `iat`, `exp`, `jti`, `token_use`) shape, local issuer and canonical resource audience binding, `token_use: "access"` versus `token_use: "refresh"`, short expiry, random `jti`, and absence of upstream tokens, mapped identity, payload, permissions, or vault IDs from JWTs. They prove each `jti` maps privately to a vault record, deleting or revoking that mapping invalidates an otherwise valid JWT, and `ctx.auth.accessToken` is the signed local JWT, never an upstream token.
- Proxy bearer-verification tests prove the provider's `tokenVerifier` verifies the local JWT, loads the `jti` mapping and vault, rejects missing, revoked, or expired records, calls `upstream.tokenVerifier` on the stored upstream access token, then calls the configured `mapAuthInfo` on every successful verification. They prove the provider's exposed `mapAuthInfo` only validates and returns that attached value, and upstream verifier outage or failure rejects the request.
- Refresh tests prove atomic local refresh-JWT `jti` rotation, uniform `invalid_grant` on invalid or replayed values, conditional upstream refresh before verification when the vault token is expired or near expiry, atomic vault update on success, revocation on failure, and absence of refresh discovery when unsupported.
- Storage tests cover TTL enforcement and deletion, persistent records without `expiresAt`, atomic consume and transaction behavior, one-use local codes and upstream state, refresh rotation, `jti` and vault invalidation, shared-replica storage behavior, and fail-closed storage failures. Replica tests prove all instances share the HS256 signing key, consent-cookie key material, and secure shared storage. Storage-protection tests prove `oauthProxyProvider` rejects `protection: "development-only"` storage by default, accepts it only with `allowInsecureStorageForDevelopment: true` while logging a clear warning, and accepts `protection: "encrypted-at-rest"` without an override.
- Route-mounting tests prove `internal.localAuthServer.mount` is called and its routes are reachable before the MCP bearer gate is registered, that the mounted routes derive their issuer and origin only from `OAuthLocalRouteContext`, and that a direct provider leaves `localAuthServer` `undefined` with unchanged metadata-only registration.
- Local discovery-metadata tests assert the exact RFC 8414 field values and array contents shown above, including conditional `"refresh_token"` in `grant_types_supported`, and that protected-resource metadata lists only the local issuer, never the upstream issuer, in proxy mode.
- DCR wire-contract tests cover every validation rule on `redirect_uris`, `client_name`, `response_types`, `grant_types`, and `token_endpoint_auth_method` (both omitted and explicit valid/invalid values), the exact `201` response shape including `client_id_issued_at`, and the absence of `client_secret`, `registration_client_uri`, and `registration_access_token`.
- Scope-mapping construction tests prove `oauthProxyProvider` rejects construction when `upstreamScopesByLocalScope` names an upstream scope outside `upstream.scopes`, and that an authorization request naming a local scope outside the keys of `upstreamScopesByLocalScope` is rejected with `invalid_scope`.
- Confirm no route or metadata document advertises a revocation endpoint or `client_id_metadata_document_supported` in the first release.

## Migrate from v1

Migrate provider concepts and public context compatibility, not proxy behavior:

- Port the Clerk, Auth0, WorkOS, Supabase, and Keycloak provider concepts and their typed user mappings.
- Defer Better Auth to a separate integration design; do not carry the v1 provider API forward by default.
- Do not port or preserve v1 proxy behavior. Implement the explicit local authorization-server proxy design in this document.
- Preserve `user`, `payload`, `accessToken`, `scopes`, and `permissions` on `ctx.auth`.
- In direct mode, `accessToken` aliases verified SDK `AuthInfo.token`. In proxy mode, it is the signed local MCP JWT and never an upstream token.
- Do not port `verifyJwt: false` or any decode-only authentication path.
- Do not port v1's unauthenticated `HEAD` bypass on the MCP endpoint. Beta.3 bearer authentication gates every method on that route; metadata routes retain public `HEAD` support.
- Replace v1 context storage with explicit `handler.fetch(..., { authInfo })` forwarding and `toRequestContext` / `toAuthenticatedRequestContext` projection.
- Do not claim beta.3 helpers are pending, Express-only, supplied by an upstream Hono auth feature, or sufficient to implement the local authorization server. Use only beta.3 resource-server helpers and new mcp-use Hono/web-standard proxy routes.
