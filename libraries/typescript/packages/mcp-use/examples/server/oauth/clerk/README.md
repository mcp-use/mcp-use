# Clerk OAuth MCP Server Example

A production-ready example of an MCP server with Clerk OAuth 2.1 authentication, demonstrating how to implement bearer token authentication and access Clerk user claims including organization roles and permissions.

## Features

- **OAuth 2.1 with PKCE**: Full Authorization Code Flow with PKCE via Clerk
- **JWT Verification**: Production-ready JWKS-based token verification using Clerk's public keys
- **Bearer Token Authentication**: Secure MCP endpoints with verified Clerk access tokens
- **User Context**: Tools that access authenticated user information from the Clerk JWT
- **Organization Claims**: Access Clerk org_id, org_role, and org_permissions in your tools
- **MCP Inspector**: Built-in web UI for testing OAuth flows
- **Configurable Security**: Toggle JWT verification for development vs production

## Prerequisites

1. **Clerk Account**: Sign up at [clerk.com](https://clerk.com) (free tier available)
2. **Node.js**: Version 18 or higher

## Setup

### 1. Create a Clerk Application

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) and sign in
2. Click **Create application**
3. Give it a name (e.g. `mcp-use-test`) and click **Create**
4. Your application will be assigned a unique domain:
   - Format: `your-app.clerk.accounts.dev`
   - Find it in **Configure → Domains** in the dashboard
5. Create a Clerk application, and make sure that **dynamic client registration** has been toggled on in the dashboard.

### 2. Verify Your Clerk Endpoints

Before running the server, confirm Clerk's OIDC endpoints are live for your domain.
Open these URLs in your browser (replace with your actual domain):

```
# Should return JSON with all endpoint URLs:
https://YOUR-DOMAIN/.well-known/openid-configuration

# Should return JSON with Clerk's public signing keys:
https://YOUR-DOMAIN/.well-known/jwks.json
```

Both must return valid JSON. If they do, your Clerk account is ready.

### 3. Set Environment Variables

Create a `.env` file in this directory:

```bash
# Required: Your Clerk domain (from Configure → Domains in the Clerk dashboard)
MCP_USE_OAUTH_CLERK_DOMAIN=your-app.clerk.accounts.dev
MCP_USE_OAUTH_CLERK_CLIENT_ID=your-client-id
# Optional: Disable JWT verification for local dev only — never in production
# VERIFY_JWT=false
```

Or export directly:

```bash
export MCP_USE_OAUTH_CLERK_DOMAIN=your-app.clerk.accounts.dev
export MCP_USE_OAUTH_CLERK_CLIENT_ID=your-client-id
```

### 4. Install Dependencies

From the workspace root:

```bash
pnpm install
```

### 5. Start the Server

```bash
# Development mode with hot reload
pnpm dev

# Or from the workspace root
pnpm --filter clerk-oauth-example dev
```

This starts the MCP server on port **3000**.

## Usage

### Testing with MCP Inspector

1. Open [http://localhost:3000/inspector](http://localhost:3000/inspector)
2. Connect to the MCP server at `http://localhost:3000/mcp`
3. You will be prompted to authenticate via OAuth
4. Complete the Clerk login flow
5. Once authenticated, try the available tools:
   - **`get-user-info`** — Returns user details extracted from the Clerk JWT
   - **`get-clerk-user-profile`** — Fetches the full profile from Clerk's userinfo endpoint
   - **`get-user-greeting`** — Returns a personalized greeting for the authenticated user

### Testing with curl

Verify the server correctly rejects unauthenticated requests:

```bash
# Should return 401 Unauthorized
curl http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Test with a valid Clerk token (obtain from the Clerk dashboard → Users → your user → Sessions):

```bash
# Should return the list of available tools
curl http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### OAuth Flow Details

The server implements the complete OAuth 2.1 flow:

1. **Authorization Request**: MCP client discovers the OAuth requirement via `WWW-Authenticate` header
2. **Redirect to Clerk**: Client is redirected to Clerk's login page at `/oauth/authorize`
3. **User Authentication**: User logs in via Clerk's hosted login page
4. **Authorization Code**: Clerk redirects back with a short-lived code
5. **Token Exchange**: Client exchanges the code for an access token at `/oauth/token`
6. **Bearer Token**: Client includes the token on all MCP requests via `Authorization: Bearer <token>`
7. **JWKS Verification**: Server verifies the token signature using Clerk's public keys

## Available Tools

### get-user-info

Returns user information extracted directly from the Clerk JWT — no extra network call required.

```json
{
  "userId": "user_2abc123xyz",
  "email": "user@example.com",
  "name": "Jane Doe",
  "picture": "https://img.clerk.com/...",
  "org_id": "org_xyz",
  "org_role": "admin",
  "org_permissions": ["read", "write"],
  "permissions": [],
  "scopes": ["openid", "profile", "email"]
}
```

### get-clerk-user-profile

Fetches the complete user profile from Clerk's `/oauth/userinfo` endpoint using the access token.

```json
{
  "sub": "user_2abc123xyz",
  "email": "user@example.com",
  "name": "Jane Doe",
  "given_name": "Jane",
  "family_name": "Doe"
}
```

### get-user-greeting

Returns a personalized greeting for the authenticated user.

```json
{
  "greeting": "Hello, Jane Doe! You are authenticated via Clerk.",
  "userId": "user_2abc123xyz"
}
```

## Project Structure

```
clerk-oauth/
├── src/
│   └── server.ts       # MCP server with Clerk OAuth
├── dist/               # Built files
├── package.json
├── tsconfig.json
└── README.md
```

## Key Differences from Auth0

| | Auth0 | Clerk |
|---|---|---|
| Auth endpoint | `/authorize` | `/oauth/authorize` |
| Audience claim | Required | Not used by default |
| Name claim | `name` | `first_name` + `last_name` |
| Avatar claim | `picture` | `image_url` |
| Org support | Roles via permissions | `org_id`, `org_role`, `org_permissions` |
| Config variable | `MCP_USE_OAUTH_AUTH0_DOMAIN` | `MCP_USE_OAUTH_CLERK_DOMAIN` |

## Troubleshooting

### "JWT verification failed"

Common causes:
- **Wrong domain**: Ensure `MCP_USE_OAUTH_CLERK_DOMAIN` does not include `https://` — just the bare domain
- **Expired token**: Clerk access tokens expire quickly. Re-authenticate to get a fresh token
- **JWKS unreachable**: Verify `https://YOUR-DOMAIN/.well-known/jwks.json` returns JSON in your browser

### "Clerk domain not configured"

Ensure `MCP_USE_OAUTH_CLERK_DOMAIN` is set in your `.env` file or exported in your shell before starting the server.

### "401 even with a valid token"

The issuer URL built inside `ClerkOAuthProvider` must exactly match the `iss` claim in your JWT. They should both be `https://YOUR-DOMAIN`. You can decode your JWT at [jwt.io](https://jwt.io) to inspect the `iss` claim and compare.

### Port already in use

```bash
export PORT=3002
```

## Security Considerations

✅ **This example implements production-ready security** including:

1. ✅ **JWT Signature Verification**: Uses Clerk's JWKS endpoint to verify token signatures
2. ✅ **Claim Validation**: Validates issuer and expiration on every request
3. ✅ **PKCE**: Authorization Code Flow with PKCE prevents code interception attacks

**Additional recommendations for production**:

1. **Use HTTPS**: Always use HTTPS in production
2. **Never disable `verifyJwt`**: The `verifyJwt: false` option is for local dev only
3. **Rotate secrets**: Regularly rotate your Clerk API keys
4. **Set token lifetime**: Configure appropriate token expiration in the Clerk dashboard

## Learn More

- [Clerk OIDC Discovery](https://clerk.com/docs/backend-requests/making/jwt-templates#oidc-discovery)
- [Clerk JWT Verification](https://clerk.com/docs/backend-requests/handling/manual-jwt)
- [OAuth 2.1 Specification](https://oauth.net/2.1/)
- [MCP Authentication Specification](https://modelcontextprotocol.io/docs/specification/authentication)
- [mcp-use Documentation](https://mcp-use.com/docs)

## License

MIT