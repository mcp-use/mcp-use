# Keycloak direct-auth example

This example runs `mcp-use` as an OAuth resource server. It verifies
Keycloak access tokens locally against the realm's JWKS, then exposes one
read-only MCP tool:

- `get-user-info()` returns verified identity claims, realm and resource roles,
  permissions, scopes, expiration, and, when present, client ID and resource.
  It does not return or forward the access token.

The server does not call Keycloak's UserInfo endpoint. Claims come only from
the validated access token.

## Configure Keycloak

1. Create or select a realm.
2. Create an OpenID Connect client for the MCP client application. Use
   **Standard flow** and enable dynamic client registration (DCR) for the
   realm when the connecting MCP client needs to register itself.
3. Set the client's valid redirect URIs to the callback URL required by the
   MCP client. Configure Web Origins to the MCP client's browser origin when
   it uses a browser-based authorization flow. Do not use broad wildcard
   redirect URIs or origins in production.
4. Ensure the client issues access tokens for this realm. The example verifies
   the token issuer and signature; it does not exchange, proxy, or forward
   tokens.

### Audience validation

For secure resource-server operation, set
`MCP_USE_OAUTH_KEYCLOAK_AUDIENCE` to the expected audience value (typically
the API client ID or resource identifier). The server will reject access
tokens that do not include this value in their `aud` claim.

To configure Keycloak to include the audience claim:

1. In the Keycloak admin console, navigate to the client scope assigned to
   your MCP client.
2. Add an Audience protocol mapper with the target audience value matching
   `MCP_USE_OAUTH_KEYCLOAK_AUDIENCE`.
3. Ensure the mapper is included in the issued access tokens.

## Environment

Copy `.env.example` to `.env` and configure:

```sh
MCP_USE_OAUTH_KEYCLOAK_SERVER_URL=https://keycloak.example.com
MCP_USE_OAUTH_KEYCLOAK_REALM=mcp
MCP_USE_OAUTH_KEYCLOAK_AUDIENCE=mcp-api
```

For deployments, set the same variables in the deployment environment.

For a public deployment, also set `MCP_URL` to the server origin, for example
`https://mcp.example.com`, not the `/mcp` endpoint.

## Run

From this directory:

```sh
pnpm dev
```

`mcp-use dev` owns the local socket and calls `getHandler()` on this
default-exported server. Before importing the entry, it resolves the actual
local port and, when `MCP_URL` is absent, supplies a scoped trusted local
canonical origin. The shared handler uses `legacy: "stateless"`. Public and
tunnel deployments require `MCP_URL`.

Point an OAuth-capable MCP client at `http://localhost:3000/mcp`. The client
authenticates with Keycloak and sends its bearer access token to the MCP
endpoint, where the server verifies it directly.

## Typecheck

```sh
pnpm typecheck
```
