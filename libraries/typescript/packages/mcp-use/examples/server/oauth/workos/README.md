# WorkOS AuthKit OAuth MCP Server Example

A production-ready example of an MCP server with WorkOS AuthKit OAuth 2.0 authentication, demonstrating how to implement bearer token authentication with Dynamic Client Registration for zero-config MCP client integration.

## Features

- **OAuth 2.0 with Dynamic Client Registration**: MCP clients can self-register without prior configuration
- **JWT Verification**: Production-ready JWKS-based token verification using WorkOS's public keys
- **Bearer Token Authentication**: Secure MCP endpoints with verified WorkOS access tokens
- **User Context**: Tools that access authenticated user information
- **Organization Support**: Multi-tenant applications with organization-scoped authentication
- **Zero-Config Integration**: Works seamlessly with Claude Desktop and other MCP clients

## Prerequisites

1. **WorkOS Account**: Sign up at [workos.com](https://workos.com)
2. **Node.js**: Version 18 or higher
3. **AuthKit Setup**: Follow [WorkOS AuthKit Quickstart](https://workos.com/docs/authkit/quickstart) to set up your project

## What is WorkOS AuthKit?

WorkOS AuthKit is a complete authentication solution that handles:

- User authentication (email/password, SSO, social login)
- Session management
- OAuth 2.0 authorization server
- Dynamic Client Registration (required for MCP)

For MCP integration, AuthKit acts as your OAuth authorization server, handling the authentication flow while your MCP server focuses on verifying tokens and serving tools.

## Setup

This example follows WorkOS's official MCP integration pattern. For complete details, see [WorkOS MCP Documentation](https://workos.com/docs/authkit/mcp).

### 1. Get Your WorkOS Credentials

From the [WorkOS Dashboard](https://dashboard.workos.com):

1. Navigate to your project settings
2. Copy your **Client ID** (e.g., `client_01KB5DRXBDDY1VGCBKY108SKJW`)
3. Copy your **API Key** (e.g., `sk_test_...`)
4. Note your **AuthKit subdomain** (visible in the Connect → Configuration section)
   - Example: `imaginative-palm-54-staging.authkit.app`
   - The subdomain is the part before `.authkit.app`

### 2. Enable Dynamic Client Registration

**⚠️ IMPORTANT**: Dynamic Client Registration is **required** for MCP clients to work with WorkOS.

Dynamic Client Registration allows MCP clients to self-register without prior configuration, which is required by the MCP OAuth specification.

In the [WorkOS Dashboard](https://dashboard.workos.com):

1. Go to **Connect** → **Configuration**
2. Enable **Dynamic Client Registration**
3. Save your changes

![Dynamic Client Registration](https://workos.com/docs/images/authkit/dynamic-client-registration.png)

**Note**: Without this setting enabled, MCP clients will fail during the OAuth flow with CORS errors when attempting to register.

### 3. Set Environment Variables

WorkOS supports **two OAuth modes**. Choose the one that fits your use case:

#### Option A: Dynamic Client Registration (DCR) - **Recommended for MCP**

Create a `.env` file with these variables:

```bash
# Your AuthKit subdomain (the part before .authkit.app) - REQUIRED
MCP_USE_OAUTH_WORKOS_SUBDOMAIN=imaginative-palm-54-staging

# Your WorkOS API Key (for making API calls to WorkOS) - OPTIONAL
MCP_USE_OAUTH_WORKOS_API_KEY=sk_test_...
```

**How it works:**

- MCP clients (like Claude Desktop, MCP Inspector) register themselves automatically
- No pre-configuration needed in WorkOS Dashboard
- Each client gets its own `client_id`
- **Must enable DCR** in WorkOS Dashboard → Connect → Configuration

#### Option B: Pre-registered OAuth Client - **For custom setups**

Create a `.env` file with these variables:

```bash
# Your AuthKit subdomain - REQUIRED
MCP_USE_OAUTH_WORKOS_SUBDOMAIN=imaginative-palm-54-staging

# Your pre-registered OAuth client ID - REQUIRED for this mode
MCP_USE_OAUTH_WORKOS_CLIENT_ID=client_01KB5DRXBDDY1VGCBKY108SKJW

# Your WorkOS API Key - OPTIONAL
MCP_USE_OAUTH_WORKOS_API_KEY=sk_test_...
```

**How it works:**

- MCP server proxies OAuth requests and injects your `client_id`
- Must create OAuth Application in WorkOS Dashboard → Connect → OAuth Applications
- Configure redirect URIs to match your MCP client (e.g., `http://localhost:*/callback`)
- Works with standard MCP clients without them needing to know the `client_id`

**Which mode to choose?**

- Use **DCR** (Option A) for most cases - it's simpler and more flexible
- Use **Pre-registered Client** (Option B) if you need tighter control over OAuth clients or have enterprise requirements

### 4. Install Dependencies

```bash
# From this example directory
pnpm install

# Or from the monorepo root
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

This example implements WorkOS's **direct mode** OAuth flow, where MCP clients communicate directly with WorkOS for authentication. Your MCP server only verifies tokens—it doesn't proxy OAuth requests.

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│             │          │             │          │             │
│ MCP Client  │          │  Your MCP   │          │   WorkOS    │
│  (Claude)   │          │   Server    │          │  AuthKit    │
│             │          │             │          │             │
└──────┬──────┘          └──────┬──────┘          └──────┬──────┘
       │                        │                        │
       │  1. Call MCP Tool      │                        │
       ├───────────────────────>│                        │
       │                        │                        │
       │  2. 401 + WWW-Authenticate                      │
       │     (resource_metadata)│                        │
       │<───────────────────────┤                        │
       │                        │                        │
       │  3. Fetch Protected Resource Metadata           │
       ├───────────────────────>│                        │
       │     (points to WorkOS) │                        │
       │<───────────────────────┤                        │
       │                        │                        │
       │  4. Fetch OAuth Metadata (DIRECTLY from WorkOS) │
       ├────────────────────────────────────────────────>│
       │<────────────────────────────────────────────────┤
       │                        │                        │
       │  5. Register Client (DIRECTLY with WorkOS)      │
       ├────────────────────────────────────────────────>│
       │<────────────────────────────────────────────────┤
       │                        │                        │
       │  6. User Signs In (DIRECTLY via WorkOS)         │
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

### Key Points:

1. **Direct Communication**: MCP clients communicate **directly** with WorkOS for all OAuth operations (registration, authorization, token exchange)
2. **Your Server's Role**: Your MCP server only:
   - Provides metadata endpoints for OAuth discovery
   - Verifies JWT tokens using WorkOS's public keys (JWKS)
   - Serves authenticated tool requests
3. **No Proxy**: Your server does NOT proxy OAuth requests—clients talk to WorkOS directly
4. **CORS Handled by WorkOS**: Since clients communicate directly with WorkOS, CORS is handled by WorkOS (no configuration needed on your server)
5. **Zero-Config Discovery**: The `WWW-Authenticate` header enables automatic OAuth discovery
6. **Production Ready**: Uses industry-standard JWKS for token verification

## Available Tools

This example includes three tools demonstrating different aspects of authentication:

### 1. `get-user-info`

Returns basic information about the authenticated user:

```typescript
{
  userId: "user_01H5JQ5Z4...",
  email: "user@example.com",
  name: "John Doe",
  organizationId: "org_01H5JQ5Z4..."
}
```

### 2. `get-user-permissions`

Shows the user's roles, permissions, and scopes:

```typescript
{
  roles: ["admin"],
  permissions: ["read:data", "write:data"],
  scopes: ["openid", "profile", "email"]
}
```

### 3. `get-workos-user`

Demonstrates making authenticated API calls to WorkOS:

```typescript
// Fetches full user profile from WorkOS API
{
  id: "user_01H5JQ5Z4...",
  email: "user@example.com",
  first_name: "John",
  last_name: "Doe",
  // ... additional fields
}
```

### Custom OAuth Endpoints

The provider automatically configures endpoints based on your subdomain:

- Issuer: `https://{subdomain}.authkit.app`
- Authorization: `https://{subdomain}.authkit.app/oauth2/authorize`
- Token: `https://{subdomain}.authkit.app/oauth2/token`
- JWKS: `https://{subdomain}.authkit.app/oauth2/jwks`

## Production Considerations

### Security Best Practices

1. **Always verify JWTs in production** (set `verifyJwt: true` or omit it)
2. **Use environment variables** for sensitive credentials
3. **Enable HTTPS** for production deployments
4. **Rotate API keys regularly** in the WorkOS Dashboard
5. **Monitor authentication logs** in the WorkOS Dashboard

### Multi-Tenant Applications

WorkOS AuthKit supports organizations out of the box. To scope authentication to a specific organization:

1. Configure organization settings in WorkOS Dashboard
2. Access organization ID from the user token:
   ```typescript
   const orgId = auth.user.organization_id;
   ```

### Session Management

WorkOS handles session management automatically through AuthKit. Access tokens have a default expiration, and refresh tokens are supported via the `offline_access` scope.

## Deployment

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

1. Click the button above
2. Set environment variables in Railway dashboard
3. Deploy!

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

### Environment Variables for Production

```bash
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_live_...  # Use production key
WORKOS_SUBDOMAIN=your-production-subdomain
NODE_ENV=production
```

## Troubleshooting

### WorkOS `application_not_found` Error

**Symptom**: Authentication redirects to WorkOS error page with `error=application_not_found`

**Most Common Cause**: `MCP_USE_OAUTH_WORKOS_CLIENT_ID` environment variable is set.

**Solution**:

1. Remove `MCP_USE_OAUTH_WORKOS_CLIENT_ID` from your environment variables
2. Remove `WORKOS_CLIENT_ID` if you have it set
3. Restart your MCP server
4. Retry the OAuth flow

**Why this happens**: With Dynamic Client Registration, MCP clients create their own OAuth client and get a `client_id` from WorkOS dynamically. If you set a static `client_id` via environment variable, it won't match the dynamically registered client, causing WorkOS to return "application not found".

### CORS Errors During Registration

**Symptom**: You see CORS errors when MCP clients try to register with WorkOS.

**Most Common Cause**: Dynamic Client Registration is NOT enabled in WorkOS Dashboard.

**Solution**:

1. Go to [WorkOS Dashboard](https://dashboard.workos.com)
2. Navigate to **Connect** → **Configuration**
3. Enable **Dynamic Client Registration**
4. Save and retry

**Why this happens**: When Dynamic Client Registration is disabled, WorkOS rejects registration requests, which can appear as CORS errors in the browser console.

### Double Popup / Popup Stays Open

**Symptom**: OAuth popup opens twice, or one popup stays open even though authentication succeeds.

**Possible Causes**:

- Browser popup blocker interfering with redirects
- Race condition in OAuth flow handling
- Browser caching old OAuth state

**Solutions**:

1. **Clear browser cache** and cookies for both your MCP server and WorkOS domains
2. **Allow popups** for both `localhost:3001` and `*.authkit.app` in your browser
3. **Try incognito/private mode** to rule out caching issues
4. **Check browser console** for any JavaScript errors during the OAuth flow
5. If using custom MCP Inspector, ensure it's the latest version

### 401 Unauthorized Errors

**Symptom**: All tool calls return 401 even after authentication.

**Solutions**:

- Verify your `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` environment variable is correct (just the subdomain, not the full URL)
- Check that your `WORKOS_API_KEY` is valid and not expired
- Ensure the token is being sent in the `Authorization: Bearer <token>` header

### OAuth Metadata Not Found

**Symptom**: MCP client can't discover OAuth configuration.

**Solutions**:

- Verify your server is running and accessible at the expected URL
- Check the metadata endpoint: `http://localhost:3000/.well-known/oauth-protected-resource`
- Ensure your MCP server base URL is correctly configured

### JWT Verification Failed

**Symptom**: Token verification fails with "Invalid token" error.

**Solutions**:

- Confirm the token is being sent in the `Authorization: Bearer <token>` header
- Verify your subdomain matches your AuthKit instance exactly
- Check that the token hasn't expired (WorkOS tokens typically expire after 1 hour)
- Ensure `verifyJwt: true` is set (or omitted for default verification)

### Dynamic Client Registration Not Working

**Symptom**: MCP client fails during the registration step.

**Solutions**:

- Enable Dynamic Client Registration in WorkOS Dashboard under Connect → Configuration
- Ensure your MCP client supports Dynamic Client Registration (Claude Desktop and MCP Inspector do)
- Check your AuthKit metadata endpoint returns valid JSON: `https://{subdomain}.authkit.app/.well-known/oauth-authorization-server`
- Verify CORS is not blocked (it shouldn't be if DCR is enabled)

## Learn More

- [WorkOS AuthKit Documentation](https://workos.com/docs/authkit)
- [WorkOS MCP Integration Guide](https://workos.com/docs/authkit/mcp)
- [MCP OAuth Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [OAuth 2.0 Dynamic Client Registration (RFC 7591)](https://tools.ietf.org/html/rfc7591)

## Support

For WorkOS-specific questions:

- [WorkOS Support](https://workos.com/support)
- [WorkOS Community](https://community.workos.com)

For MCP-related questions:

- [MCP Documentation](https://modelcontextprotocol.io)
- [mcp-use GitHub Issues](https://github.com/mcp-use/mcp-use/issues)

## License

MIT
