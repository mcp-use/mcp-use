# Clerk OAuth MCP Server Example

A production-ready example of an MCP server with Clerk OAuth 2.1 authentication, demonstrating how to implement bearer token authentication and access Clerk user claims including organization roles and permissions.

## Features

- **OAuth 2.1 with PKCE**: Full Authorization Code Flow with PKCE via Clerk
- **JWT Verification**: Production-ready JWKS-based token verification using Clerk's public keys
- **Bearer Token Authentication**: Secure MCP endpoints with verified Clerk access tokens
- **User Context**: Tools that access authenticated user information from the Clerk JWT
- **Organization Claims**: Access Clerk org_id, org_role, and org_permissions in your tools
- **Dual Token Handling**: Supports both opaque `oat_` tokens (real MCP clients) and JWT session tokens (Inspector)
- **MCP Inspector**: Built-in web UI for testing OAuth flows
- **Configurable Security**: Toggle JWT verification for development vs production

## Prerequisites

1. **Clerk Account**: Sign up at [clerk.com](https://clerk.com) (free tier available)
2. **Node.js**: Version 18 or higher

## Setup

### 1. Create a Clerk Application

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) and sign in
2. Click **Create application**, give it a name, and click **Create**
3. Your application will be assigned a unique domain — find it under **Configure → Domains**
   - Format: `your-app.clerk.accounts.dev`

### 2. Create an OAuth Application

Clerk requires a pre-registered OAuth client for MCP authentication:

1. In the Clerk Dashboard, go to **Configure → SSO → OAuth Applications**
2. Click **Create OAuth Application**
3. Fill in:
   - **Name**: `mcp-use`
   - **Redirect URI**: `http://localhost:3000/oauth/callback`
4. Click **Create**
5. Make sure that dynamic client registration has been toggled on in the OAuth applications Setting.

### 3. Get Your Secret Key

1. In the Clerk Dashboard, go to **API Keys**
2. Copy the **Secret key** — it starts with `sk_test_` (dev) or `sk_live_` (prod)

This is required for `get-clerk-user-profile` to fetch full user profiles when testing with the MCP Inspector. Real MCP clients (Cursor, Claude Code) receive opaque `oat_` tokens which call Clerk's `/oauth/userinfo` endpoint directly without needing a secret key.

### 4. Set Environment Variables

Create a `.env` file in this directory:

```bash
# Required: Your Clerk domain (from Configure → Domains)
MCP_USE_OAUTH_CLERK_DOMAIN=your-app.clerk.accounts.dev

# Required for get-clerk-user-profile in Inspector / browser flows
# Get from: Clerk Dashboard → API Keys
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxx
```

### 5. Install Dependencies

From the workspace root:

```bash
pnpm install
```

### 6. Start the Server

```bash
# Development mode with hot reload
pnpm dev

# Or from the workspace root
pnpm --filter clerk-oauth-example dev
```

This starts the MCP server on port **3000** with the Inspector at http://localhost:3000/inspector.

## Usage

### Testing with MCP Inspector

1. Open [http://localhost:3000/inspector](http://localhost:3000/inspector)
2. Connect to the MCP server at `http://localhost:3000/mcp`
3. You will be prompted to authenticate via OAuth
4. Complete the Clerk login flow
5. Once authenticated, try the available tools:
   - **`get-user-info`** — User details extracted from the Clerk JWT
   - **`get-clerk-user-profile`** — Full profile from Clerk API (requires `CLERK_SECRET_KEY`)
   - **`get-user-greeting`** — Personalized greeting for the authenticated user

## Available Tools

### get-user-info

Returns user information extracted directly from the verified Clerk JWT — no extra network call required. Includes Clerk-specific organization claims.

```json
{
  "userId": "user_2abc123xyz",
  "email": "user@example.com",
  "name": "Jane Doe",
  "picture": "https://img.clerk.com/...",
  "org_id": "org_xyz",
  "org_role": "admin",
  "org_permissions": ["read:documents", "write:documents"],
  "permissions": [],
  "scopes": ["email", "offline_access", "profile"]
}
```

### get-clerk-user-profile

Fetches the complete user profile from Clerk. Handles both Clerk token types automatically:

| Token type | How it works | When issued |
|---|---|---|
| `oat_...` opaque token | Calls Clerk `/oauth/userinfo` directly | Real MCP clients (Cursor, Claude Code) |
| JWT session token | Calls Clerk Backend API `/v1/users/:id` | Inspector / browser flows |

```json
{
  "id": "user_2abc123xyz",
  "email": "user@example.com",
  "email_verified": true,
  "first_name": "Jane",
  "last_name": "Doe",
  "name": "Jane Doe",
  "username": "janedoe",
  "picture": "https://img.clerk.com/...",
  "created_at": "2024-01-01T00:00:00.000Z",
  "last_sign_in": "2024-06-01T12:00:00.000Z",
  "public_metadata": {}
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

## Token Types

Clerk issues two different token types depending on how the client authenticates:

**Opaque tokens (`oat_...`)** are issued to real MCP clients (Cursor, Claude Code, Windsurf). They must be validated by calling Clerk's `/oauth/userinfo` endpoint — they cannot be decoded locally.

**JWT session tokens** are issued in browser-based flows (MCP Inspector). They are signed JWTs verified locally using Clerk's JWKS endpoint. User profile data is fetched from the Clerk Backend API using the user's `sub` claim and a secret key.

The `get-clerk-user-profile` tool handles both cases automatically.

## Project Structure

```
clerk-oauth/
├── src/
│   └── server.ts     # MCP server with Clerk OAuth
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

- Ensure `MCP_USE_OAUTH_CLERK_DOMAIN` does not include `https://` — just the bare domain
- Verify `https://YOUR-DOMAIN/.well-known/jwks.json` returns valid JSON in your browser
- Re-authenticate to get a fresh token if the current one has expired

### "Clerk API request failed: 401 Unauthorized"

- Verify `CLERK_SECRET_KEY` is set in your `.env` file
- Confirm the key starts with `sk_test_` (development) or `sk_live_` (production)
- The secret key must belong to the same Clerk application as your domain

### "Clerk userinfo failed: 401 Unauthorized"

This is expected when testing with the Inspector — Inspector flows issue JWT session tokens, not opaque `oat_` tokens. The tool automatically falls back to the Clerk Backend API. Ensure `CLERK_SECRET_KEY` is set.

### Port already in use

```bash
PORT=3002 pnpm dev
```

## Security Considerations

✅ **This example implements production-ready security** including:

1. ✅ **JWT Signature Verification**: Uses Clerk's JWKS endpoint to verify token signatures
2. ✅ **Claim Validation**: Validates issuer and expiration on every request
3. ✅ **PKCE**: Authorization Code Flow with PKCE prevents code interception attacks

**Additional recommendations for production**:

1. **Use HTTPS**: Always use HTTPS in production
2. **Never disable `verifyJwt`**: The `verifyJwt: false` option is for local dev only
3. **Use `sk_live_` keys**: Switch from `sk_test_` to `sk_live_` in production
4. **Rotate secrets**: Regularly rotate your Clerk API keys

## Learn More

- [GitHub Example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/clerk)
- [Clerk Documentation](https://clerk.com/docs)
- [Clerk JWT Verification](https://clerk.com/docs/backend-requests/handling/manual-jwt)
- [Clerk Organizations](https://clerk.com/docs/organizations/overview)
- [OAuth 2.1 Specification](https://oauth.net/2.1/)
- [MCP Authentication Specification](https://modelcontextprotocol.io/docs/specification/authentication)

## License

MIT