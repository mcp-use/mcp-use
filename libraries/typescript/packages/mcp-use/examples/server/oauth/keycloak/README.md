# Keycloak OAuth MCP Server Example

An MCP server that delegates authentication to a Keycloak realm using **Dynamic Client Registration (RFC 7591)**. MCP clients register themselves with Keycloak on first use, complete a PKCE authorization flow, and send the resulting access token as a bearer token on MCP requests. The MCP server only verifies the JWT against Keycloak's JWKS — it does not proxy OAuth traffic.

## Prerequisites

- Node 20+
- A running Keycloak realm you can reach from this process, with:
  - **Dynamic Client Registration** enabled (Keycloak's OIDC client registration service is on by default on every realm at `/realms/{realm}/clients-registrations/openid-connect`).
  - An anonymous DCR policy that permits the `redirect_uris` your MCP client will send. The default `Trusted Hosts` policy only allows `localhost` / `127.0.0.1` — loosen or tighten to match your deployment.
  - If the MCP client runs in a browser (e.g. a web-based inspector), the realm also needs the `Allowed Registration Web Origins` policy (Keycloak 26.6+) configured with the client's origin, otherwise Keycloak returns `403 Invalid origin` on the DCR POST.
- A test user in the realm so you can log in during the PKCE flow.

## Setup

From the TypeScript workspace root:

```bash
pnpm install
pnpm --filter mcp-use build
```

Copy `.env.example` to `.env` and point the vars at your Keycloak.

## Run

```bash
pnpm --filter keycloak-oauth-example dev
```

The server starts on port **3000** with the inspector at http://localhost:3000/inspector.

## Testing the flow

1. Open http://localhost:3000/inspector
2. Connect to `http://localhost:3000/mcp`
3. The inspector discovers Keycloak via `/.well-known/oauth-authorization-server`, registers itself via DCR, and redirects you to the Keycloak login page
4. Log in with a user from your realm
5. Back in the inspector, call:
   - `get-user-info` — returns claims lifted from the JWT (`sub`, `preferred_username`, realm roles, scopes…)
   - `get-keycloak-userinfo` — fetches the full OIDC userinfo document from Keycloak using the access token

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
- **Anonymous DCR**: The default `Trusted Hosts` policy enforces that the `redirect_uris` in the registration request use an allowed hostname. For non-localhost redirect URIs, either extend that policy's trusted hosts list or mint an Initial Access Token and have the client pass it on the registration request.
- **Browser clients**: On Keycloak 26.6+, add the `Allowed Registration Web Origins` client-registration policy (provider id `registration-web-origins`, config key `web-origins`) listing every origin your inspector/client will run from. Without it, browser DCR is blocked by CORS.
- **Production**: Turn off anonymous DCR, require initial access tokens, serve everything over HTTPS, and set `MCP_USE_OAUTH_KEYCLOAK_AUDIENCE`.
