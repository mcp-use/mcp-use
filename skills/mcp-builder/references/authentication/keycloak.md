# Keycloak Authentication

Setting up OAuth with Keycloak. Keycloak exposes full OAuth 2.1 + OIDC endpoints on every realm, including native [Dynamic Client Registration](https://www.keycloak.org/securing-apps/client-registration) (RFC 7591). MCP clients discover Keycloak via `.well-known` metadata, register themselves, complete a PKCE flow, and send the access token as a bearer on MCP requests — **the MCP server only verifies the JWT against Keycloak's JWKS**.

**Learn more:** [Keycloak Documentation](https://www.keycloak.org/documentation) · [Keycloak DCR](https://www.keycloak.org/securing-apps/client-registration) · [Runnable example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/keycloak)

---

## Quick Start

```typescript
import { MCPServer, oauthKeycloakProvider, object } from "mcp-use/server";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthKeycloakProvider(),  // reads MCP_USE_OAUTH_KEYCLOAK_SERVER_URL + _REALM
});

server.tool(
  { name: "whoami", description: "Get authenticated user info" },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      username: ctx.auth.user.username,
      email: ctx.auth.user.email,
      roles: ctx.auth.user.roles,
      permissions: ctx.auth.permissions,
      scopes: ctx.auth.scopes,
    })
);

server.listen();
```

With a `.env` file:

```bash
MCP_USE_OAUTH_KEYCLOAK_SERVER_URL=http://localhost:8080
MCP_USE_OAUTH_KEYCLOAK_REALM=demo
```

---

## Setup

This guide assumes you already have a Keycloak instance running with admin access. If not, see [Keycloak's getting started guide](https://www.keycloak.org/guides#getting-started).

### 1. Enable Dynamic Client Registration

Keycloak exposes `/{realm}/clients-registrations/openid-connect` on every realm. Anonymous (no-token) registration is gated by **Client Registration Policies**:

1. **Realm settings → Client registration → Anonymous Access Policies**
2. Open the **Trusted Hosts** policy
3. Add the hostnames MCP clients will register from (`localhost`, `127.0.0.1`) to **Trusted Hosts**
4. Make sure **Client URIs Must Match** is enabled so `redirect_uris` in the registration request are validated

> **Browser MCP clients** (like the Inspector) also need the **Allowed Registration Web Origins** policy (Keycloak 26.6+) listing every origin the client runs from. Without it, DCR requests fail with CORS `403 Invalid origin`.

For non-localhost redirect URIs, mint an **Initial Access Token** (Realm settings → Client registration → Initial access token) and have clients pass it on the DCR POST.

### 2. (Optional) Audience enforcement

Keycloak doesn't set `aud` to the resource server by default. To require it:

1. Add an **Audience** protocol mapper to a client scope in Keycloak.
2. Set `MCP_USE_OAUTH_KEYCLOAK_AUDIENCE` to the matching value.

Without the mapper, tokens will be rejected if `audience` is configured.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_USE_OAUTH_KEYCLOAK_SERVER_URL` | Yes | Base URL of your Keycloak server (no trailing slash, no `/realms` path) |
| `MCP_USE_OAUTH_KEYCLOAK_REALM` | Yes | Realm name (e.g. `demo`) |
| `MCP_USE_OAUTH_KEYCLOAK_AUDIENCE` | No | If set, enforced as the access token's `aud` claim. Requires an Audience protocol mapper. |

---

## Configuration Options

Zero-config (reads from env vars):

```typescript
oauth: oauthKeycloakProvider()
```

Explicit config:

```typescript
oauth: oauthKeycloakProvider({
  serverUrl: "https://keycloak.example.com",
  realm: "demo",
  audience: "https://my-mcp-server.example.com/mcp",  // optional
  verifyJwt: process.env.NODE_ENV === "production",   // default: true
  scopesSupported: ["openid", "profile", "email"],    // override advertised scopes
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | `string` | env var | Base URL of your Keycloak server |
| `realm` | `string` | env var | Realm name |
| `audience` | `string?` | env var | Required `aud` claim — needs an Audience mapper in Keycloak |
| `verifyJwt` | `boolean?` | `true` | Set `false` to skip JWT verification (**development only**) |
| `scopesSupported` | `string[]?` | `["openid", "profile", "email", "offline_access", "roles"]` | Override advertised scopes |

---

## The Flow

```
MCP Client ──(1) GET /.well-known/oauth-protected-resource   ─▶ MCP Server
MCP Client ──(2) GET /.well-known/oauth-authorization-server ─▶ MCP Server ─▶ Keycloak
MCP Client ──(3) POST /clients-registrations/openid-connect  ─▶ Keycloak      (DCR)
MCP Client ──(4) GET  /protocol/openid-connect/auth          ─▶ Keycloak      (PKCE)
MCP Client ──(5) POST /protocol/openid-connect/token         ─▶ Keycloak
MCP Client ──(6) MCP request + Bearer <token>                ─▶ MCP Server    (verifies JWT via JWKS)
```

Step 2 is a passthrough from the MCP server back to Keycloak's metadata — it's what tells the client where to register and where to send the user for login. Everything else goes directly to Keycloak.

---

## User Context

Keycloak puts realm roles in `realm_access.roles` and resource roles in `resource_access.{client}.roles`. The provider normalizes them onto `ctx.auth`:

| Field | Type | Source |
|-------|------|--------|
| `userId` | `string` | `sub` claim |
| `email` | `string?` | `email` claim |
| `name` | `string?` | `name` claim |
| `username` | `string?` | `preferred_username` claim |
| `roles` | `string[]?` | `realm_access.roles` — **realm roles only** |
| `permissions` | `string[]?` | `resource_access.{client}.roles` — as `"client:role"` strings |
| `scopes` | `string[]?` | Parsed from `scope` claim |

### Role-Based Access Control

```typescript
server.tool(
  { name: "admin-action", description: "Admin-only action" },
  async (_args, ctx) => {
    if (!ctx.auth.user.roles?.includes("admin")) {
      return error("Forbidden: admin role required");
    }

    // ... admin logic
    return text("Done");
  }
);
```

For per-client roles, check `ctx.auth.permissions` (formatted as `client:role`).

---

## Making Keycloak API Calls

Call Keycloak's userinfo endpoint with the raw access token:

```typescript
server.tool(
  {
    name: "get-keycloak-userinfo",
    description: "Fetch the full userinfo document from Keycloak",
  },
  async (_args, ctx) => {
    const serverUrl = process.env.MCP_USE_OAUTH_KEYCLOAK_SERVER_URL!;
    const realm = process.env.MCP_USE_OAUTH_KEYCLOAK_REALM!;

    const res = await fetch(
      `${serverUrl}/realms/${realm}/protocol/openid-connect/userinfo`,
      { headers: { Authorization: `Bearer ${ctx.auth.accessToken}` } }
    );

    return object(await res.json());
  }
);
```

---

## Example `.env`

```bash
# Required: base URL of your Keycloak server — no trailing slash, no /realms path
MCP_USE_OAUTH_KEYCLOAK_SERVER_URL=http://localhost:8080

# Required: realm name
MCP_USE_OAUTH_KEYCLOAK_REALM=demo

# Optional: if set, the provider enforces that the token's `aud` claim equals
# this value. Requires an Audience protocol mapper on the client scope.
# MCP_USE_OAUTH_KEYCLOAK_AUDIENCE=http://localhost:3000
```

---

## Production Notes

- **Audience enforcement.** Keycloak doesn't set `aud` to the resource server by default. To require it, add an *Audience* protocol mapper to the client scope and set `MCP_USE_OAUTH_KEYCLOAK_AUDIENCE`.
- **Anonymous DCR.** Fine for local dev, risky in production. Disable anonymous access and issue Initial Access Tokens that clients pass on the DCR request.
- **Transport.** Always serve Keycloak and the MCP server over HTTPS outside of local dev.
- **Scope of realm roles.** `ctx.auth.user.roles` only contains realm roles. Use `ctx.auth.permissions` (formatted as `client:role`) for per-client roles.

---

## Next Steps

- **Auth overview** → [overview.md](overview.md)
- **Custom providers + OAuth proxy reference** → [custom.md](custom.md)
- **WorkOS setup** → [workos.md](workos.md)
- **Build tools** → [../server/tools.md](../server/tools.md)
