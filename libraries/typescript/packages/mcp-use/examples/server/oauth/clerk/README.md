# Clerk OAuth MCP Server Example

A production-ready example of an MCP server with Clerk OAuth 2.0 authentication, demonstrating how to implement bearer token authentication with Dynamic Client Registration for zero-config MCP client integration.

## Features

- **OAuth 2.0 with Dynamic Client Registration**: MCP clients can self-register without prior configuration
- **JWT Verification**: Production-ready JWKS-based token verification using Clerk's public keys
- **Bearer Token Authentication**: Secure MCP endpoints with verified Clerk access tokens
- **User Context**: Tools that access authenticated user information
- **Organization Support**: Access Clerk organization context (org ID, role, permissions)
- **Zero-Config Integration**: Works seamlessly with Claude Desktop and other MCP clients

## Prerequisites

1. **Clerk Account**: Sign up at [clerk.com](https://clerk.com)
2. **Node.js**: Version 18 or higher
3. **Clerk Application**: Create an application in the [Clerk Dashboard](https://dashboard.clerk.com)

## Setup

### 1. Get Your Clerk Frontend API URL

From the [Clerk Dashboard](https://dashboard.clerk.com):

1. Open your application
2. Go to **Configure** → **API Keys**
3. Copy the **Frontend API URL** (also shown in the `.env.local` quickstart file)
   - Development example: `https://verb-noun-42.clerk.accounts.dev`
   - Production example: `https://clerk.yourdomain.com`

### 2. Enable Dynamic Client Registration

**⚠️ IMPORTANT**: Dynamic Client Registration is **required** for MCP clients to work with Clerk.

1. Go to the [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to **Configure** → **OAuth Applications**
3. Enable **Dynamic Client Registration**
4. Save your changes

### 3. Set Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```bash
# Development
MCP_USE_OAUTH_CLERK_FRONTEND_API_URL=https://verb-noun-42.clerk.accounts.dev

# Production
MCP_USE_OAUTH_CLERK_FRONTEND_API_URL=https://clerk.yourdomain.com
```

### 4. Install Dependencies

```bash
pnpm install
```

### 5. Run the Server

```bash
# Development mode with auto-reload
pnpm dev

# Or build and run
pnpm build
pnpm start
```

## How OAuth Works with MCP

This example uses Clerk's DCR-based OAuth flow. MCP clients communicate directly with Clerk for all OAuth operations. Your MCP server only verifies tokens.

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│             │          │             │          │             │
│ MCP Client  │          │  Your MCP   │          │    Clerk    │
│  (Claude)   │          │   Server    │          │             │
│             │          │             │          │             │
└──────┬──────┘          └──────┬──────┘          └──────┬──────┘
       │                        │                        │
       │  1. Call MCP Tool      │                        │
       ├───────────────────────>│                        │
       │                        │                        │
       │  2. 401 + WWW-Authenticate                      │
       │<───────────────────────┤                        │
       │                        │                        │
       │  3. Fetch Protected Resource Metadata           │
       ├───────────────────────>│                        │
       │<───────────────────────┤                        │
       │                        │                        │
       │  4. Fetch OAuth Metadata (DIRECTLY from Clerk)  │
       ├────────────────────────────────────────────────>│
       │<────────────────────────────────────────────────┤
       │                        │                        │
       │  5. Register Client (DIRECTLY with Clerk DCR)   │
       ├────────────────────────────────────────────────>│
       │<────────────────────────────────────────────────┤
       │                        │                        │
       │  6. User Signs In (DIRECTLY via Clerk)          │
       ├────────────────────────────────────────────────>│
       │<────────────────────────────────────────────────┤
       │                        │                        │
       │  7. Exchange Code for Token (DIRECTLY)          │
       ├────────────────────────────────────────────────>│
       │<────────────────────────────────────────────────┤
       │                        │                        │
       │ 8. Call Tool + Bearer Token                     │
       ├───────────────────────>│                        │
       │                        │                        │
       │                        │  9. Verify JWT (JWKS)  │
       │                        ├───────────────────────>│
       │                        │<───────────────────────┤
       │                        │                        │
       │ 10. Tool Response      │                        │
       │<───────────────────────┤                        │
       │                        │                        │
```

### Clerk OAuth Endpoints

All endpoints are derived from your Frontend API URL:

| Endpoint | URL |
|----------|-----|
| Issuer | `{frontendApiUrl}` |
| Authorization | `{frontendApiUrl}/oauth/authorize` |
| Token | `{frontendApiUrl}/oauth/token` |
| JWKS | `{frontendApiUrl}/.well-known/jwks.json` |
| Metadata | `{frontendApiUrl}/.well-known/oauth-authorization-server` |

## Available Tools

### `get-user-info`

Returns basic information about the authenticated user:

```typescript
{
  userId: "user_2abc...",
  email: "user@example.com",
  name: "Jane Doe"
}
```

### `get-user-permissions`

Shows the user's roles, permissions, and scopes:

```typescript
{
  roles: ["org:admin"],
  permissions: ["org:feature:read", "org:feature:write"],
  scopes: ["openid", "profile", "email"]
}
```

### `get-organization-info`

Returns the active Clerk organization context (requires an organization to be selected):

```typescript
{
  org_id: "org_2abc...",
  org_role: "org:admin",
  org_slug: "acme-corp"
}
```

## JWT Claims

Clerk access tokens include standard OIDC claims plus organization-specific ones:

| Claim | Description |
|-------|-------------|
| `sub` | User ID |
| `iss` | Issuer (your Frontend API URL) |
| `email` | Email address |
| `name` | Full name |
| `picture` | Profile picture URL |
| `org_id` | Active organization ID |
| `org_role` | User's role in the active organization |
| `org_slug` | Active organization slug |
| `org_permissions` | Array of permissions in the active organization |

## Production Considerations

1. **Always verify JWTs in production** — omit `verifyJwt` (defaults to `true`)
2. **Use your production Frontend API URL** — `https://clerk.yourdomain.com`
3. **Enable HTTPS** for your MCP server in production

## Learn More

- [Clerk OAuth Documentation](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)
- [Clerk Organizations](https://clerk.com/docs/organizations/overview)
- [MCP OAuth Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [OAuth 2.0 Dynamic Client Registration (RFC 7591)](https://tools.ietf.org/html/rfc7591)

## Support

For Clerk-specific questions:
- [Clerk Documentation](https://clerk.com/docs)
- [Clerk Discord](https://clerk.com/discord)

For MCP-related questions:
- [MCP Documentation](https://modelcontextprotocol.io)
- [mcp-use GitHub Issues](https://github.com/mcp-use/mcp-use/issues)

## License

MIT
