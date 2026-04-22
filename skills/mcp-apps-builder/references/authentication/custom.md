# Custom & OAuth Proxy Authentication

Two factories cover everything that isn't a built-in provider:

- **`oauthCustomProvider`** — for identity providers that support **Dynamic Client Registration (DCR)** and advertise a `registration_endpoint` in their OAuth metadata. MCP clients register themselves directly with the upstream; your server only verifies tokens.
- **`oauthProxy`** — for providers **without DCR** (Google, GitHub, Okta, Azure AD, standard Auth0 apps, etc.). You register an app in the provider's dashboard, pass the fixed `clientId` / `clientSecret` here, and your server mediates the token exchange.

> Picking between them: if your provider lists a `registration_endpoint` at `https://<provider>/.well-known/oauth-authorization-server`, use `oauthCustomProvider`. Otherwise use `oauthProxy`.

---

## `oauthCustomProvider` (DCR)

Use this when your identity provider supports DCR and advertises a `registration_endpoint`. Clients discover the endpoints and register themselves against the upstream.

```typescript
import { MCPServer, oauthCustomProvider, object } from "mcp-use/server";
import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://auth.example.com/.well-known/jwks.json")
);

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthCustomProvider({
    issuer: "https://auth.example.com",
    authEndpoint: "https://auth.example.com/oauth/authorize",
    tokenEndpoint: "https://auth.example.com/oauth/token",

    async verifyToken(token) {
      const result = await jwtVerify(token, JWKS, {
        issuer: "https://auth.example.com",
        audience: "your-audience",
      });
      return { payload: result.payload as Record<string, unknown> };
    },

    getUserInfo(payload) {
      return {
        userId: payload.sub as string,
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
        roles: (payload.roles as string[]) || [],
      };
    },
  }),
});

server.tool(
  { name: "whoami", description: "Get authenticated user info" },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
    })
);

server.listen();
```

### Configuration Options

```typescript
oauthCustomProvider({
  // Required: OAuth endpoints
  issuer: "https://auth.example.com",
  authEndpoint: "https://auth.example.com/oauth/authorize",
  tokenEndpoint: "https://auth.example.com/oauth/token",

  // Required: must return { payload: Record<string, unknown> } or throw
  async verifyToken(token) {
    const { payload } = await jwtVerify(token, JWKS, { issuer: "..." });
    return { payload: payload as Record<string, unknown> };
  },

  // Optional
  jwksUrl: "https://auth.example.com/.well-known/jwks.json",  // advertised in discovery metadata
  userInfoEndpoint: "https://auth.example.com/userinfo",
  scopesSupported: ["openid", "profile", "email"],
  grantTypesSupported: ["authorization_code", "refresh_token"],
  audience: "your-api-identifier",
  getUserInfo: (payload) => ({
    userId: payload.sub as string,
    email: payload.email as string | undefined,
    name: payload.name as string | undefined,
  }),
})
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `issuer` | `string` | Yes | OAuth issuer URL |
| `authEndpoint` | `string` | Yes | Authorization endpoint |
| `tokenEndpoint` | `string` | Yes | Token endpoint |
| `verifyToken` | `(token: string) => Promise<{ payload: Record<string, unknown> }>` | Yes | Token verification function |
| `jwksUrl` | `string?` | No | JWKS endpoint advertised in discovery metadata |
| `userInfoEndpoint` | `string?` | No | User info endpoint URL |
| `scopesSupported` | `string[]?` | No | Default: `["openid", "profile", "email"]` |
| `grantTypesSupported` | `string[]?` | No | Default: `["authorization_code", "refresh_token"]` |
| `audience` | `string?` | No | Audience for JWT verification |
| `getUserInfo` | `(payload) => UserInfo` | No | Custom user info extraction |

### Default Claim Extraction

Without `getUserInfo`, the provider extracts standard OIDC claims automatically:

| Field | Extracted From |
|-------|---------------|
| `userId` | `sub`, `user_id`, or `id` |
| `email` | `email` |
| `name` | `name` |
| `username` | `username` or `preferred_username` |
| `nickname` | `nickname` |
| `picture` | `picture` or `avatar_url` |
| `roles` | `roles` (if array) |
| `permissions` | `permissions` (if array) |
| `scopes` | Parsed from `scope` string |

Override if your provider uses non-standard claim names:

```typescript
getUserInfo: (payload) => ({
  userId: payload.user_id as string,
  email: payload.mail as string,
  name: payload.display_name as string,
  roles: (payload.groups as string[]) || [],
})
```

---

## `oauthProxy` (non-DCR providers)

Use this for providers that don't support DCR — Google, GitHub, Okta, Azure AD, standard Auth0 Regular Web Apps, and anything else where you register an app in a dashboard and receive a fixed `clientId` / `clientSecret`.

The proxy flow:

```
Client → /register  → MCP server returns the pre-registered client_id
Client → /authorize → MCP server redirects to upstream /authorize
Upstream → redirect → authorization code returned to the client
Client → /token     → MCP server injects clientId + clientSecret, forwards to upstream
Upstream → token    → returned to the client
Client → /mcp/...   → MCP server verifies bearer via verifyToken()
```

### `jwksVerifier` helper

Use `jwksVerifier` to build a standard JWT+JWKS `verifyToken`. It handles signature verification, issuer checking, and optional audience validation. Pair it with `oauthProxy` for any JWT-based provider.

```typescript
import { oauthProxy, jwksVerifier } from "mcp-use/server";

oauthProxy({
  // ...
  verifyToken: jwksVerifier({
    jwksUrl: "https://<provider>/.well-known/jwks.json",
    issuer: "https://<provider>/",
    audience: "your-audience",  // optional — enforces `aud` claim
  }),
})
```

> `verifyToken` — whether from `jwksVerifier` or handwritten — **must resolve to `{ payload: Record<string, unknown> }`** or throw. The proxy surfaces `payload` to `getUserInfo` and to `ctx.auth.payload`.

For non-JWT providers (GitHub opaque tokens), write your own `verifyToken` that calls the provider's API — see [GitHub](#github-opaque-tokens) below.

### `oauthProxy` Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `authEndpoint` | `string` | Yes | Upstream authorization endpoint |
| `tokenEndpoint` | `string` | Yes | Upstream token endpoint |
| `issuer` | `string` | Yes | Token issuer (used in metadata and enforced by `jwksVerifier`) |
| `clientId` | `string` | Yes | Pre-registered OAuth client ID |
| `clientSecret` | `string?` | No | Client secret (omit for public clients) |
| `verifyToken` | `VerifyToken` | Yes | Token verification — use `jwksVerifier()` or a custom function |
| `scopes` | `string[]?` | No | Scopes to request. Default: `["openid", "email", "profile"]` |
| `grantTypes` | `string[]?` | No | Default: `["authorization_code", "refresh_token"]` |
| `extraAuthorizeParams` | `Record<string, string>?` | No | Extra query params on `/authorize` (e.g. `access_type`, `audience`, `prompt`) |
| `getUserInfo` | `(payload) => UserInfo` | No | Custom user info extraction from the verified payload |

---

## Provider Examples (`oauthProxy`)

### Google

```typescript
oauth: oauthProxy({
  authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  issuer: "https://accounts.google.com",
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  scopes: ["openid", "email", "profile"],
  extraAuthorizeParams: { access_type: "offline" },
  verifyToken: jwksVerifier({
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuer: "https://accounts.google.com",
    audience: process.env.GOOGLE_CLIENT_ID!,
  }),
})
```

### Okta

```typescript
const oktaDomain = process.env.OKTA_DOMAIN!;  // e.g. "https://dev-123.okta.com"

oauth: oauthProxy({
  authEndpoint: `${oktaDomain}/oauth2/default/v1/authorize`,
  tokenEndpoint: `${oktaDomain}/oauth2/default/v1/token`,
  issuer: `${oktaDomain}/oauth2/default`,
  clientId: process.env.OKTA_CLIENT_ID!,
  clientSecret: process.env.OKTA_CLIENT_SECRET,
  scopes: ["openid", "email", "profile"],
  verifyToken: jwksVerifier({
    jwksUrl: `${oktaDomain}/oauth2/default/v1/keys`,
    issuer: `${oktaDomain}/oauth2/default`,
  }),
})
```

### Azure AD (Microsoft Entra ID)

```typescript
const tenantId = process.env.AZURE_TENANT_ID!;
const base = `https://login.microsoftonline.com/${tenantId}/v2.0`;

oauth: oauthProxy({
  authEndpoint: `${base}/oauth2/v2.0/authorize`,
  tokenEndpoint: `${base}/oauth2/v2.0/token`,
  issuer: base,
  clientId: process.env.AZURE_CLIENT_ID!,
  clientSecret: process.env.AZURE_CLIENT_SECRET,
  scopes: ["openid", "profile", "email"],
  verifyToken: jwksVerifier({
    jwksUrl: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    issuer: base,
    audience: process.env.AZURE_CLIENT_ID!,
  }),
})
```

### Auth0 (Regular Web App, no Early Access)

For Auth0 with a standard Regular Web App (no DCR Early Access), use the proxy. See [auth0.md](auth0.md) for the full guide.

```typescript
const domain = process.env.AUTH0_DOMAIN!;
const audience = process.env.AUTH0_AUDIENCE ?? "";

oauth: oauthProxy({
  authEndpoint: `https://${domain}/authorize`,
  tokenEndpoint: `https://${domain}/oauth/token`,
  issuer: `https://${domain}/`,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  scopes: ["openid", "email", "profile"],
  extraAuthorizeParams: { audience },
  verifyToken: jwksVerifier({
    jwksUrl: `https://${domain}/.well-known/jwks.json`,
    issuer: `https://${domain}/`,
    audience,
  }),
})
```

### GitHub (opaque tokens)

GitHub uses non-JWT opaque tokens. Use a custom `verifyToken` that calls the GitHub API instead of `jwksVerifier`:

```typescript
oauth: oauthProxy({
  authEndpoint: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  issuer: "https://github.com",
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  scopes: ["read:user", "user:email"],

  // GitHub uses opaque tokens — validate by calling the API
  async verifyToken(token) {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "my-mcp-server",
      },
    });
    if (!res.ok) throw new Error("Invalid GitHub token");
    const user = await res.json();
    return { payload: { sub: String(user.id), ...user } };
  },

  getUserInfo(payload) {
    return {
      userId: payload.sub as string,
      username: payload.login as string | undefined,
      name: payload.name as string | undefined,
      email: payload.email as string | undefined,
      picture: payload.avatar_url as string | undefined,
    };
  },
})
```

---

## Accessing user info in tools

```typescript
server.tool(
  { name: "get-user-info", description: "Get authenticated user info" },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
      scopes: ctx.auth.scopes,
    })
);
```

---

## Common Mistakes

- **Using `oauthCustomProvider` for Google / GitHub / Okta / Azure AD** — those don't support DCR. Use `oauthProxy` instead.
- **`verifyToken` returning the wrong shape** — must resolve to `{ payload: Record<string, unknown> }` or throw. Returning `jwtVerify`'s raw result doesn't satisfy this in TypeScript — cast explicitly: `return { payload: result.payload as Record<string, unknown> }`.
- **Forgetting `audience` for JWT verification** — most providers issue per-client tokens; without `audience` in `jwksVerifier`, tokens from other clients could be accepted.
- **Missing `extraAuthorizeParams`** — Google needs `access_type: "offline"` for refresh tokens; Auth0 needs `audience` to issue JWT access tokens instead of opaque ones.

---

## Resources

- [`jose` library](https://github.com/panva/jose) — JWT verification primitives (already a dependency of `mcp-use`)
- [OAuth 2.1 Specification](https://oauth.net/2.1/)
- [OIDC Specification](https://openid.net/specs/openid-connect-core-1_0.html)
- [Runnable Auth0 proxy example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/auth0-proxy)

---

## Next Steps

- **Auth overview** → [overview.md](overview.md)
- **Auth0 setup** → [auth0.md](auth0.md)
- **WorkOS setup** → [workos.md](workos.md)
- **Supabase setup** → [supabase.md](supabase.md)
- **Keycloak setup** → [keycloak.md](keycloak.md)
- **Build tools** → [../server/tools.md](../server/tools.md)
