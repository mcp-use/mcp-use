# Auth0 direct-auth example

This server verifies Auth0 access tokens locally from Auth0's JWKS. Its only
tool, `get-user-info`, returns verified Auth0 claims and authorization details.
It does not send the access token to Auth0 or any other service.

## Configure Auth0

1. In Auth0, create an API for this MCP server. Set its API Identifier to the
   value you will use for `AUTH0_AUDIENCE`, such as
   `https://api.example.com`.
2. Define the API permissions that your MCP client needs. The client must
   request those scopes during authorization. The example exposes verified
   permissions and scopes, but does not require a particular scope.
3. Create or enable an Auth0 application for your external MCP client. Use
   Authorization Code with PKCE, configure the client's callback URLs at
   Auth0, and enable dynamic client registration only if your Auth0 tenant and
   client support it. Otherwise, configure the client ID at the MCP client.
4. Configure the client to target this API. Its requested token must contain
   the API Identifier as its `aud` claim. When the client supports RFC 8707,
   it should use the protected-resource metadata and send the returned
   `resource` parameter. The requested scopes must be allowed for the API and
   application.

`AUTH0_AUDIENCE` is the Auth0 API Identifier, not the Auth0 Management API
audience. The server validates the token issuer, signature, and audience before
the tool runs.

## Configure the server

Copy `.env.example` to `.env` and set the required values:

```sh
AUTH0_DOMAIN=https://your-tenant.us.auth0.com
AUTH0_AUDIENCE=https://api.example.com
```

For a public deployment, also set `MCP_URL` to the public origin only:

```sh
MCP_URL=https://mcp.example.com
```

The server derives its MCP resource URL from that origin. Do not append an
endpoint path to `MCP_URL`.

## Run

Install workspace dependencies, then start development mode from this directory:

```sh
pnpm dev
```

`mcp-use dev` owns the local socket and calls `getHandler()` on this
default-exported server. Before importing the entry, it resolves the actual
local port and, when `MCP_URL` is absent, supplies a scoped trusted local
canonical origin. The shared handler uses `legacy: "stateless"`. Public and
tunnel deployments require `MCP_URL`.

## Verify types

```sh
pnpm typecheck
```
