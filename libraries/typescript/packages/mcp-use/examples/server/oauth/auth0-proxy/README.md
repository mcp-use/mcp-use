# Auth0 OAuth Proxy Example

MCP server using `oauthProxy()` with Auth0. Unlike the `auth0/` DCR-direct example, this works with a standard **Regular Web App** — no Early Access DCR feature required.

The MCP server mediates the OAuth flow: clients register with `/register`, authorize via `/authorize`, and exchange tokens via `/token`. The server injects your pre-registered credentials at token exchange before forwarding to Auth0.

## Auth0 Setup

### 1. Create a Regular Web App

In the [Auth0 Dashboard](https://manage.auth0.com):

1. Go to **Applications → Create Application**
2. Choose **Regular Web Application**
3. Under **Allowed Callback URLs**, add your MCP client's redirect URI, e.g.:
   ```
   http://localhost:3000/inspector/oauth/callback
   ```
4. Save changes and copy the **Client ID** and **Client Secret**

### 2. Create an API

This gives you JWT access tokens (required — opaque tokens can't be verified locally).

1. Go to **APIs → Create API**
2. Set an identifier, e.g. `https://my-mcp-api/`
3. Leave signing algorithm as RS256

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in:

```bash
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=<from Regular Web App>
AUTH0_CLIENT_SECRET=<from Regular Web App>
AUTH0_AUDIENCE=https://my-mcp-api/
```

## Running

```bash
# From the workspace root
pnpm --filter auth0-proxy-example dev

# Or from this directory (after pnpm install)
pnpm dev
```

Server starts on port 3000. Open `http://localhost:3000/inspector` to test the OAuth flow.

## OAuth Flow

```
Client → /register         → receives pre-registered client_id
Client → /authorize        → MCP server redirects to Auth0 /authorize
Auth0  → redirect_uri      → returns authorization code to client
Client → /token            → MCP server injects credentials, forwards to Auth0
Auth0  → access_token (JWT)→ returned to client
Client → /mcp/...          → MCP server verifies JWT via Auth0 JWKS
```

## Available Tools

- **`get-user-info`** — returns user info extracted from the JWT (`userId`, `email`, `name`, `picture`, `scopes`)
- **`get-auth0-user-profile`** — fetches the full profile from Auth0's `/userinfo` endpoint

> **Note:** Auth0 access tokens don't always include `email` or `name` claims. If those are empty, enable the `rfc9068_profile_authz` token dialect on your API or add custom claims via an Auth0 Action.
