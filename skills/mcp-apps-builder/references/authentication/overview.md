# Authentication

Adding OAuth 2.0/2.1 authentication to your MCP server.

**Use for:** Protecting tools behind user authentication, accessing user identity in tool handlers, integrating with identity providers (Auth0, Better Auth, Clerk, WorkOS, Supabase, Keycloak, Google, GitHub, Okta, Azure AD, and more).

> **Two integration modes.** Pick by whether your identity provider supports Dynamic Client Registration (DCR):
> - **Remote auth** (`oauthAuth0Provider`, `oauthBetterAuthProvider`, `oauthClerkProvider`, `oauthKeycloakProvider`, `oauthSupabaseProvider`, `oauthWorkOSProvider`, `oauthCustomProvider`) — clients register and authenticate directly with the upstream provider; your server only verifies the resulting bearer token. Requires DCR on the upstream.
> - **OAuth proxy** (`oauthProxy` + `jwksVerifier`) — your server holds pre-registered client credentials and mediates the token exchange. Use this for Google, GitHub, Okta, Azure AD, or any provider where you register the app in a dashboard and receive a fixed `clientId` / `clientSecret`.

---

## How It Works

Pass an OAuth provider to the `oauth` option on `MCPServer`:

```typescript
import { MCPServer } from "mcp-use/server";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: yourProvider(),  // see provider-specific guides
});
```

This single property:
- Protects all `/mcp/*` routes with bearer token authentication
- Verifies tokens on every request (JWT + JWKS by default)
- Sets up OAuth discovery endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`, `/.well-known/oauth-protected-resource`)
- In proxy mode, also sets up `/register`, `/authorize`, and `/token` endpoints that mediate the upstream flow
- Populates `ctx.auth` in all tool/resource/prompt handlers

---

## Accessing User Context

Every tool handler receives `ctx.auth` when OAuth is enabled:

```typescript
server.tool(
  {
    name: "get-profile",
    description: "Get the authenticated user's profile",
  },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
    })
);
```

### `ctx.auth` Shape

```typescript
ctx.auth.user            // UserInfo object (see below)
ctx.auth.accessToken     // Raw bearer token string
ctx.auth.scopes          // string[] — parsed from JWT `scope` claim
ctx.auth.permissions     // string[] — parsed from JWT `permissions` claim
ctx.auth.payload         // Raw JWT payload (all claims, Record<string, unknown>)
```

### `ctx.auth.user` (UserInfo)

All providers populate these base fields:

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Unique user identifier (`sub` claim) |
| `email` | `string?` | User's email |
| `name` | `string?` | Display name |
| `username` | `string?` | Username |
| `nickname` | `string?` | Nickname |
| `picture` | `string?` | Avatar URL |
| `roles` | `string[]?` | User roles |
| `permissions` | `string[]?` | User permissions |

Providers may add extra fields (e.g., WorkOS adds `organization_id`, Keycloak adds `username`, Supabase adds `aal`). Access them via `ctx.auth.user.organization_id` or `ctx.auth.payload` for raw claims.

### `ctx.auth.payload` (Raw Claims)

**Type:** `Record<string, unknown>` — values require explicit casts. Applies to **all providers** since `verifyToken` always returns `{ payload: Record<string, unknown> }`.

**Prefer typed accessors** (`ctx.auth.user.*`, `ctx.auth.scopes`, `ctx.auth.permissions`) over raw payload access. If your provider has non-standard claims, map them into typed `ctx.auth.user` fields via `getUserInfo` rather than casting in every tool handler:

```typescript
// ✅ Preferred: map claims once in getUserInfo
oauth: oauthCustomProvider({
  // ...endpoints and verifyToken...
  getUserInfo: (payload) => ({
    userId: payload.sub as string,
    email: payload.mail as string,
    name: payload.display_name as string,
    roles: (payload.groups as string[]) || [],
  }),
})

// Then access typed fields in tools:
async (_args, ctx) => object({ email: ctx.auth.user.email })
```

```typescript
// ❌ Avoid: casting raw payload in every tool handler
async (_args, ctx) => {
  const exp = ctx.auth.payload.exp as number;  // unknown → number cast needed
  return object({ expiresAt: new Date(exp * 1000).toISOString() });
}
```

If you must read raw claims (debugging or one-off provider-specific fields), cast explicitly:

```typescript
const exp = ctx.auth.payload.exp as number | undefined;
const customField = ctx.auth.payload.my_field as string;
```

---

## Zero-Config Setup

All built-in remote-auth providers support zero-config via environment variables. Call the factory with no arguments and it reads from `MCP_USE_OAUTH_*` env vars:

```typescript
oauth: oauthAuth0Provider()     // reads MCP_USE_OAUTH_AUTH0_*
oauth: oauthWorkOSProvider()    // reads MCP_USE_OAUTH_WORKOS_*
oauth: oauthSupabaseProvider()  // reads MCP_USE_OAUTH_SUPABASE_*
oauth: oauthKeycloakProvider()  // reads MCP_USE_OAUTH_KEYCLOAK_*
```

Or pass config explicitly to override env vars. See each provider's guide for available options.

`oauthProxy` and `oauthCustomProvider` have no zero-config mode — all endpoints must be passed explicitly.

---

## Available Providers

### Remote auth (DCR)

| Provider | Factory | Required Config | Guide |
|----------|---------|-----------------|-------|
| **Auth0** | `oauthAuth0Provider()` | `domain`, `audience` (env: `MCP_USE_OAUTH_AUTH0_DOMAIN`, `MCP_USE_OAUTH_AUTH0_AUDIENCE`) | [auth0.md](auth0.md) |
| **Better Auth** | `oauthBetterAuthProvider({ authURL })` | `BETTER_AUTH_SECRET` | [better-auth.md](better-auth.md) |
| **Clerk** | `oauthClerkProvider()` | `frontendApiUrl` (env: `MCP_USE_OAUTH_CLERK_FRONTEND_API_URL`) | [clerk.md](clerk.md) |
| **WorkOS** | `oauthWorkOSProvider()` | `subdomain` (env: `MCP_USE_OAUTH_WORKOS_SUBDOMAIN`) | [workos.md](workos.md) |
| **Supabase** | `oauthSupabaseProvider()` | `projectId` (env: `MCP_USE_OAUTH_SUPABASE_PROJECT_ID`) | [supabase.md](supabase.md) |
| **Keycloak** | `oauthKeycloakProvider()` | `serverUrl`, `realm` (env: `MCP_USE_OAUTH_KEYCLOAK_SERVER_URL`, `MCP_USE_OAUTH_KEYCLOAK_REALM`) | [keycloak.md](keycloak.md) |
| **Custom (DCR)** | `oauthCustomProvider({ ... })` | `issuer`, endpoints, `verifyToken` | [custom.md](custom.md) |

### OAuth proxy (non-DCR)

| Use for | Factory | Guide |
|---------|---------|-------|
| Google, GitHub, Okta, Azure AD, Auth0 (non-EA), any pre-registered app | `oauthProxy({ ... })` + `jwksVerifier({ ... })` | [custom.md](custom.md#oauth-proxy-non-dcr-providers) |

---

## Making Authenticated API Calls

Use `ctx.auth.accessToken` to call your provider's API on behalf of the user:

```typescript
server.tool(
  { name: "fetch-data", description: "Fetch user data from API" },
  async (_args, ctx) => {
    const res = await fetch("https://api.example.com/me", {
      headers: {
        Authorization: `Bearer ${ctx.auth.accessToken}`,
      },
    });

    if (!res.ok) {
      return error(`API call failed: ${res.status}`);
    }

    return object(await res.json());
  }
);
```

Provider-specific examples (Supabase, Keycloak, Auth0, etc.) live in each provider's guide.

---

## Advertising Auth to ChatGPT (`securitySchemes` + `authenticationRequired()`)

ChatGPT and other SEP-1488–aware clients decide which sign-in UI to show *before* invoking a tool by reading the `securitySchemes` field on each tool in `tools/list`. The framework only emits this field if you set it.

There are two halves to wire up:

**1. Advertise the policy on each tool** (or set `defaultSecuritySchemes` on the server config):

```typescript
import { z } from "zod";
import { text, authenticationRequired } from "mcp-use/server";

// Anonymous tool — no sign-in UI
server.tool(
  {
    name: "public_search",
    schema: z.object({ q: z.string() }),
    securitySchemes: [{ type: "noauth" }],
  },
  async ({ q }) => text(`results for ${q}`)
);

// Optional auth — anonymous works, signed-in unlocks more
server.tool(
  {
    name: "browse_catalog",
    schema: z.object({ q: z.string() }),
    securitySchemes: [
      { type: "noauth" },
      { type: "oauth2", scopes: ["catalog.read"] },
    ],
  },
  async ({ q }, ctx) =>
    ctx.auth ? text(`personalised: ${q}`) : text(`anonymous: ${q}`)
);

// Auth-required tool — must be signed in
server.tool(
  {
    name: "create_doc",
    schema: z.object({ title: z.string() }),
    securitySchemes: [{ type: "oauth2", scopes: ["docs.write"] }],
  },
  async ({ title }, ctx) => {
    if (!ctx.auth) {
      return authenticationRequired({
        scopes: ["docs.write"],
        resourceMetadataUrl:
          "https://your-mcp.example.com/.well-known/oauth-protected-resource",
      });
    }
    return text(`created: ${title}`);
  }
);
```

**2. Return `authenticationRequired()` on the failure path.** The helper emits `_meta["mcp/www_authenticate"]` with a `Bearer` challenge, which is what triggers ChatGPT's sign-in flow. Pair with `securitySchemes` — both halves are required.

Server-wide default (use when most tools share the same policy):

```typescript
new MCPServer({
  name: "my-server",
  version: "1.0.0",
  defaultSecuritySchemes: [{ type: "oauth2", scopes: ["read"] }],
});
```

`securitySchemes` is **advertisement only** — token verification still happens at the OAuth provider layer (`oauth: ...`) and inside the tool handler via `ctx.auth`. The advertisement just tells the client which sign-in UI to surface ahead of time.

---

## Common Mistakes

- **Wrong `ctx.auth` shape** — User info is nested: `ctx.auth.user.email`, not `ctx.auth.email`
- **Using `oauthCustomProvider` for non-DCR providers** — For Google, GitHub, Okta, Azure AD, etc., use `oauthProxy` + `jwksVerifier` instead. `oauthCustomProvider` only works with providers that advertise a `registration_endpoint`.
- **Custom `verifyToken` returning the wrong shape** — It must resolve to `{ payload: Record<string, unknown> }` or throw. The proxy surfaces `payload` to `getUserInfo` and to `ctx.auth`.
- **Hardcoding provider credentials** — Use env vars; never commit secrets
- **Skipping JWT verification in production** — `verifyJwt: false` is development only
- **Throwing errors instead of returning `error()`** — Use the `error()` response helper for auth-related failures
- **Declaring `securitySchemes` without returning `authenticationRequired()`** — ChatGPT won't trigger sign-in unless the failure path emits the `Bearer` challenge. Both halves are required.
- **Treating `securitySchemes` as enforcement** — It's advertisement only. Always verify `ctx.auth` (and scopes) inside the handler regardless.

---

## Next Steps

- **Auth0 setup** → [auth0.md](auth0.md)
- **Better Auth setup** → [better-auth.md](better-auth.md)
- **Clerk setup** → [clerk.md](clerk.md)
- **WorkOS setup** → [workos.md](workos.md)
- **Supabase setup** → [supabase.md](supabase.md)
- **Keycloak setup** → [keycloak.md](keycloak.md)
- **Custom provider / OAuth proxy** → [custom.md](custom.md)
- **Build tools** → [../server/tools.md](../server/tools.md)
- **See examples** → [../patterns/common-patterns.md](../patterns/common-patterns.md)
