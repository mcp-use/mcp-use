# Keycloak OAuth MCP Server Example

An MCP server that delegates authentication to a Keycloak realm using **Dynamic Client Registration (RFC 7591)**. MCP clients register themselves with Keycloak on first use, complete a PKCE authorization flow, and send the resulting access token as a bearer token on MCP requests. The MCP server only verifies the JWT against Keycloak's JWKS — it does not proxy OAuth traffic.

## Prerequisites

- Node 20+
- A running Keycloak instance with a realm that has DCR enabled. The companion [`keycloak-auth-server`](https://github.com/andrewkhadder/keycloak-auth-server) repo provides exactly this: Keycloak 26 in Docker with a pre-seeded `demo` realm, a `testuser` account, and anonymous DCR allowed for `localhost` redirect URIs.

```bash
# In the keycloak-auth-server repo
docker compose up -d
# Wait ~60s, then confirm:
curl -s http://localhost:8080/realms/demo/.well-known/oauth-authorization-server | jq .issuer
```

## Setup

From the TypeScript workspace root:

```bash
pnpm install
pnpm --filter mcp-use build
```

## Run

```bash
# Defaults point at http://localhost:8080 and realm `demo`
pnpm --filter keycloak-oauth-example dev
```

Override via environment:

```bash
export MCP_USE_OAUTH_KEYCLOAK_SERVER_URL=http://localhost:8080
export MCP_USE_OAUTH_KEYCLOAK_REALM=demo
# Optional — if set, the JWT `aud` claim must match
# (requires a Keycloak audience mapper on the client scope)
export MCP_USE_OAUTH_KEYCLOAK_AUDIENCE=http://localhost:3000
pnpm --filter keycloak-oauth-example dev
```

The server starts on port **3000** with the inspector at http://localhost:3000/inspector.

## Testing the flow

1. Open http://localhost:3000/inspector
2. Connect to `http://localhost:3000/mcp`
3. The inspector discovers Keycloak via `/.well-known/oauth-authorization-server`, registers itself via DCR, and redirects you to the Keycloak login page
4. Log in with **`testuser` / `testpassword`**
5. Back in the inspector, call:
   - `get-user-info` — returns claims lifted from the JWT (`sub`, `preferred_username`, realm roles, scopes…)
   - `get-keycloak-userinfo` — fetches the full OIDC userinfo document from Keycloak using the access token

You can also run the standalone end-to-end test in the `keycloak-auth-server` repo (`./scripts/test-mcp-auth-dcr.sh`) to confirm DCR + PKCE work independently of mcp-use.

## Flow

```
MCP Client ──(1) GET /.well-known/oauth-protected-resource ─▶ MCP Server
MCP Client ──(2) GET /.well-known/oauth-authorization-server ─▶ MCP Server ─▶ Keycloak
MCP Client ──(3) POST /clients-registrations/openid-connect ─▶ Keycloak      (DCR)
MCP Client ──(4) GET  /protocol/openid-connect/auth ─────────▶ Keycloak      (PKCE)
MCP Client ──(5) POST /protocol/openid-connect/token ────────▶ Keycloak
MCP Client ──(6) MCP request + Bearer <token> ──────────────▶ MCP Server    (verifies JWT via JWKS)
```

Step 2 is a passthrough from the MCP server back to Keycloak's metadata — it's what tells the client where to register and where to send the user for login. Everything else goes directly to Keycloak.

## Notes

- **Audience**: Keycloak doesn't set `aud` to the resource server by default. If you want the provider to enforce `aud`, add an *Audience* protocol mapper to the client scope in Keycloak and set `MCP_USE_OAUTH_KEYCLOAK_AUDIENCE` to the matching value.
- **DCR trust**: The pre-seeded `demo` realm only accepts anonymous DCR when the requested `redirect_uris` point at `localhost` / `127.0.0.1`. For other hosts, mint an Initial Access Token (see the `keycloak-auth-server` README) and pass it on the registration request.
- **Production**: Turn off anonymous DCR, require initial access tokens, serve everything over HTTPS, and set `MCP_USE_OAUTH_KEYCLOAK_AUDIENCE`.
