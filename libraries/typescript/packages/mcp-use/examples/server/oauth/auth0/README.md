# Auth0 OAuth MCP Server Example

A production-ready example of an MCP server with Auth0 OAuth 2.1 authentication, demonstrating how to proxy OAuth flows, implement bearer token authentication, and enforce role-based access control (RBAC).

## Features

- **OAuth 2.1 with PKCE**: Full implementation of Authorization Code Flow with PKCE
- **JWT Verification**: Production-ready JWKS-based token verification using Auth0's public keys
- **Bearer Token Authentication**: Secure MCP endpoints with verified Auth0 access tokens
- **Role-Based Access Control**: Scope-based permissions for granular tool access
- **User Context**: Tools that access authenticated user information
- **MCP Inspector**: Built-in web UI for testing OAuth flows
- **Configurable Security**: Toggle JWT verification for development vs production

## Prerequisites

> **Note**: Auth0's MCP features are currently in Early Access. To join the Early Access program, complete [this form](https://forms.gle/hvJ1ZRLmHr9YjV2a9).

1. **Auth0 Account**: Sign up at [auth0.com](https://auth0.com) (free tier available)
2. **Auth0 CLI**: Install the [Auth0 CLI](https://auth0.github.io/auth0-cli/) for configuration
3. **Node.js**: Version 18 or higher
4. **jq**: JSON processor for CLI scripts ([installation instructions](https://jqlang.org/download/))

## Setup

This example follows Auth0's official MCP setup pattern. For complete details, see [Auth0's MCP Authorization Guide](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server).

### 1. Configure Auth0 Tenant

First, log in to Auth0 CLI with required scopes:

```bash
auth0 login --scopes "read:client_grants,create:client_grants,delete:client_grants,read:clients,create:clients,update:clients,read:resource_servers,create:resource_servers,update:resource_servers,read:roles,create:roles,update:roles,update:tenant_settings,read:connections,update:connections"
```

#### Enable Resource Parameter Compatibility Profile

In the [Auth0 Dashboard](https://manage.auth0.com/dashboard/):
1. Navigate to **Settings** → **Advanced**
2. Enable **Resource Parameter Compatibility Profile** toggle

#### Promote Connections to Domain-Level

To allow third-party clients like MCP Inspector to use your connections:

```bash
# List connections to get their IDs
auth0 api get connections

# Promote specific connections (e.g., username-password database)
auth0 api patch connections/YOUR_CONNECTION_ID --data '{"is_domain_connection": true}'
```

### 2. Create an API to Represent Your MCP Server

Create an API in Auth0 with scopes for tool access:

```bash
auth0 api post resource-servers --data '{
  "identifier": "http://localhost:3001/",
  "name": "MCP Tools API",
  "signing_alg": "RS256",
  "token_dialect": "rfc9068_profile_authz",
  "enforce_policies": true,
  "scopes": [
    {"value": "tool:whoami", "description": "Access user info and profile tools"},
    {"value": "tool:greet", "description": "Access the greeting tool"}
  ]
}'
```

**Note**: The `rfc9068_profile_authz` token dialect includes the `permissions` claim in access tokens, enabling scope-based access control.

### 3. Create Roles and Assign Permissions (Optional)

For role-based access control:

```bash
# Create admin role with all tool permissions
auth0 roles create --name "Tool Administrator" --description "Access to all MCP tools"

# Create basic user role with limited permissions
auth0 roles create --name "Tool User" --description "Access to basic MCP tools"

# Assign permissions to roles (use role IDs from previous commands)
auth0 roles permissions add YOUR_ADMIN_ROLE_ID --api-id "http://localhost:3001/" --permissions "tool:whoami,tool:greet"
auth0 roles permissions add YOUR_USER_ROLE_ID --api-id "http://localhost:3001/" --permissions "tool:whoami"

# Assign roles to users
auth0 users search --query "email:\"user@example.com\""
auth0 users roles assign USER_ID --roles ROLE_ID
```

### 4. Set Environment Variables

Create a `.env` file or export:

```bash
# Required: Your Auth0 tenant domain (from auth0 tenants list)
DOMAIN=$(auth0 tenants list --json | jq -r '.[] | select(.active == true) | .name')
export MCP_USE_OAUTH_AUTH0_DOMAIN="${DOMAIN}"

# Required: API audience (must match the API identifier above)
export MCP_USE_OAUTH_AUTH0_AUDIENCE="http://localhost:3001/"

# Optional: Server port (defaults to 3001)
export PORT=3001

# Optional: Base URL for OAuth redirects
export BASE_URL="http://localhost:3001"

# Optional: Enable/disable JWT verification (defaults to true)
export VERIFY_JWT=true
```

### 5. Install Dependencies

From the workspace root:

```bash
yarn install
```

### 6. Start the Server

```bash
# Development mode with hot reload
yarn workspace auth0-oauth-example dev

# Or from this directory
yarn dev
```

This will start:
- MCP server on port **3001**
- MCP Inspector at http://localhost:3001/inspector

## Usage

### Testing with MCP Inspector

1. Open http://localhost:3001/inspector
2. Connect to the MCP server at `http://localhost:3001/mcp`
3. You'll be prompted to authenticate via OAuth
4. Complete the Auth0 login flow
5. Once authenticated, try the available tools based on your permissions:

   - **`verify-token`** - Check token validity and claims (no permissions required)
   - **`get-user-info`** - View user details from JWT (requires `tool:whoami`)
   - **`get-auth0-user-profile`** - Fetch full profile from Auth0 (requires `tool:whoami`)
   - **`get-user-greeting`** - Get personalized greeting (requires `tool:greet`)

For detailed testing instructions, see [Testing Your MCP Server with MCP Inspector](https://auth0.com/ai/docs/mcp/guides/test-your-mcp-server-with-mcp-inspector).

### OAuth Flow Details

The server implements the complete OAuth 2.1 flow:

1. **Authorization Request**: Client redirects to `/authorize`
2. **Proxy to Auth0**: Server forwards to Auth0's authorization endpoint
3. **User Authentication**: User logs in via Auth0's login page
4. **Authorization Code**: Auth0 redirects back with code
5. **Token Exchange**: Client exchanges code for access token at `/token`
6. **Bearer Token**: Client includes token in MCP requests via `Authorization: Bearer <token>` header

### OAuth Endpoints

- **Authorization**: `http://localhost:3001/authorize`
- **Token Exchange**: `http://localhost:3001/token`
- **Server Metadata**: `http://localhost:3001/.well-known/oauth-authorization-server`
- **Resource Metadata**: `http://localhost:3001/.well-known/oauth-protected-resource/mcp`

## Available Tools

### verify-token

**Permissions**: None required (useful for debugging)

Validates the current access token and displays its claims including permissions.

```json
{
  "verified": true,
  "valid": true,
  "issuer": "https://your-tenant.us.auth0.com/",
  "subject": "auth0|123456789",
  "audience": "http://localhost:3001/",
  "permissions": ["tool:whoami", "tool:greet"],
  "expiresAt": "2024-01-01T12:00:00.000Z",
  "expiresInSeconds": 3600,
  "scopes": ["openid", "profile", "email"]
}
```

### get-user-info

**Permissions**: `tool:whoami`

Returns user information extracted from the JWT token.

```json
{
  "userId": "auth0|123456789",
  "email": "user@example.com",
  "name": "John Doe",
  "nickname": "johndoe",
  "picture": "https://...",
  "permissions": ["tool:whoami", "tool:greet"]
}
```

### get-auth0-user-profile

**Permissions**: `tool:whoami`

Fetches the complete user profile from Auth0's userinfo endpoint using the access token.

### get-user-greeting

**Permissions**: `tool:greet`

Returns a personalized greeting based on the authenticated user.

**Parameters**:
- `style` (optional): "formal", "casual", or "enthusiastic"

## Project Structure

```
auth0-oauth/
├── src/
│   └── server.ts              # MCP server with Auth0 OAuth
├── dist/                      # Built files
├── package.json
├── tsconfig.json
└── README.md
```

## Architecture

### Authentication Flow

```
┌─────────┐     ┌─────────────┐     ┌────────┐
│ Client  │────▶│ MCP Server  │────▶│ Auth0  │
│         │     │ (Proxy)     │     │        │
└─────────┘     └─────────────┘     └────────┘
     │                 │                  │
     │  1. /authorize  │                  │
     │────────────────▶│                  │
     │                 │  2. Redirect     │
     │                 │─────────────────▶│
     │                 │                  │
     │                 │  3. Login/Consent│
     │                 │                  │
     │  4. Code        │                  │
     │◀────────────────┴──────────────────│
     │                                    │
     │  5. /token (code + PKCE verifier)  │
     │───────────────────────────────────▶│
     │                                    │
     │  6. Access Token (with permissions)│
     │◀───────────────────────────────────│
     │                                    │
     │  7. MCP Requests (Bearer Token)    │
     │───────────────────────────────────▶│
     │                                    │
     │  8. JWKS Verification              │
     │                 │─────────────────▶│
     │                 │◀─────────────────│
     │                                    │
     │  9. Tool Response (if authorized)  │
     │◀───────────────────────────────────│
```

### Bearer Token Middleware with JWT Verification

All `/mcp/*` routes are protected with bearer authentication:

1. Client includes `Authorization: Bearer <token>` header
2. Middleware validates token format
3. **JWT signature is verified** using Auth0's JWKS endpoint (when `VERIFY_JWT=true`)
4. Token claims are validated (issuer, audience, expiration)
5. User info and permissions are attached to request context
6. Tools check required permissions before execution
7. 403 response if permissions are insufficient

**Security**: This example implements production-ready JWT verification by default. Set `VERIFY_JWT=false` only for development/testing.

## Advanced Topics

### Adding More Tool Scopes

To add new tools with custom permissions:

1. Add the scope to your Auth0 API:

```bash
auth0 api patch resource-servers/YOUR_API_ID --data '{
  "scopes": [
    {"value": "tool:whoami", "description": "Access user info"},
    {"value": "tool:greet", "description": "Access greeting tool"},
    {"value": "tool:custom", "description": "Your new tool scope"}
  ]
}'
```

2. Assign the scope to roles:

```bash
auth0 roles permissions add ROLE_ID --api-id "http://localhost:3001/" --permissions "tool:custom"
```

3. Add permission check in your tool:

```typescript
server.tool({
  name: "my-custom-tool",
  description: "My custom tool (requires tool:custom)",
  cb: async (_args: any, context: any) => {
    const payload = context?.get?.("payload");
    if (!hasPermissions(payload, ["tool:custom"])) {
      return { content: [{ type: "text", text: "Insufficient permissions" }], isError: true };
    }
    // ... tool implementation
  },
});
```

### Token Refresh

Implement refresh token handling for long-lived sessions:

```typescript
server.post("/token", async (c) => {
  const body = await c.req.parseBody();
  
  if (body.grant_type === "refresh_token") {
    // Forward refresh token request to Auth0
  }
  // ... existing code
});
```

### Disabling JWT Verification (Development Only)

For local development without Auth0 configuration:

```bash
export VERIFY_JWT=false
```

**Warning**: Never disable verification in production. This bypasses all security checks.

## Security Considerations

✅ **This example implements production-ready security** including:

1. ✅ **JWT Signature Verification**: Uses Auth0's JWKS endpoint to verify tokens
2. ✅ **Claim Validation**: Validates issuer, audience, and expiration
3. ✅ **Scope-Based Authorization**: Enforces permissions for each tool
4. ✅ **RFC 9068 Tokens**: Uses Auth0's recommended token dialect with permissions

**Additional recommendations for production**:

1. **Use HTTPS**: Always use HTTPS in production (required by OAuth 2.0 spec)
2. **Secure Storage**: Store tokens securely on the client side
3. **Rate Limiting**: Implement rate limiting on OAuth endpoints
4. **CORS Configuration**: Configure CORS appropriately for your domain
5. **Error Handling**: Don't leak sensitive information in error messages
6. **Audit Logging**: Log authentication and authorization events
7. **Token Rotation**: Implement refresh token rotation for enhanced security

## Troubleshooting

### "JWT verification failed"

Common causes:
- **Wrong audience**: Ensure `MCP_USE_OAUTH_AUTH0_AUDIENCE` matches your API identifier exactly (including trailing slash)
- **Wrong issuer**: Verify `MCP_USE_OAUTH_AUTH0_DOMAIN` is correct (without `https://` prefix)
- **Expired token**: Access tokens expire after a configured time (default 1 hour)
- **Invalid signature**: Token may be from a different Auth0 tenant

### "Insufficient permissions"

The user's token doesn't have the required scope:
1. Check token permissions: Call the `verify-token` tool
2. Verify the scope is defined in your Auth0 API
3. Ensure the user's role includes the required permission
4. Re-authenticate to get a new token with updated permissions

### "Invalid Authorization header"

Ensure the client is sending the token in the correct format:
```
Authorization: Bearer <access_token>
```

### "Token expired"

Access tokens have a limited lifetime. Solutions:
- Implement refresh token flow
- Re-authenticate the user
- Adjust token lifetime in Auth0 dashboard (not recommended for security)

### Port Already in Use

If port 3001 is in use, change it:
```bash
export PORT=3002
```

### CORS Errors

If testing from a web browser, add CORS middleware:

```typescript
import { cors } from "hono/cors";
server.use("*", cors());
```

## Learn More

### Auth0 MCP Documentation
- [Authorization for Your MCP Server](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server) - Official setup guide
- [Call Your APIs on a User's Behalf](https://auth0.com/ai/docs/mcp/get-started/call-your-apis-on-users-behalf) - Custom token exchange
- [Testing Your MCP Server](https://auth0.com/ai/docs/mcp/guides/test-your-mcp-server-with-mcp-inspector) - Testing guide

### General Documentation
- [Auth0 Documentation](https://auth0.com/docs)
- [OAuth 2.1 Specification](https://oauth.net/2.1/)
- [RFC 9068: JWT Profile for OAuth 2.0 Access Tokens](https://datatracker.ietf.org/doc/html/rfc9068)
- [MCP Authentication Specification](https://modelcontextprotocol.io/docs/specification/authentication)
- [mcp-use Documentation](https://docs.mcp-use.com)
- [PKCE Flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce)

### Sample Applications
- [auth0-task-vantage](https://github.com/auth0-samples/auth0-task-vantage) - Full-featured Auth0 MCP example
- [auth0-ai-samples](https://github.com/auth0-samples/auth0-ai-samples) - Official Auth0 AI/MCP samples

## License

MIT

