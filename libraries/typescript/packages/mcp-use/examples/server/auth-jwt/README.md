# JWT Authentication with OIDC

Production-ready JWT authentication for MCP servers using ANY OIDC-compliant provider.

## Overview

This example demonstrates:
- JWT token verification using JWKS (JSON Web Key Sets)
- OpenID Connect Discovery (works with any OIDC provider)
- Support for Auth0, Keycloak, Okta, Azure AD, Google, and more
- Automatic public key retrieval and caching
- User context from JWT claims
- Role-based authorization
- Multi-tenant support

## Auth0 Setup

### 1. Create Auth0 Application

1. Go to [Auth0 Dashboard](https://manage.auth0.com/)
2. Create a new Application → Machine to Machine Application
3. Name it (e.g., "MCP Server")
4. Note down:
   - **Domain**: `your-tenant.auth0.com`
   - **Client ID**: (for your clients)
   - **Client Secret**: (for your clients)

### 2. Configure API

1. Go to Applications → APIs
2. Create new API:
   - **Name**: MCP Server API
   - **Identifier**: `https://mcp.yourapp.com` (your audience)
3. Settings:
   - Enable RBAC
   - Add Permissions in API (optional)

### 3. Get Test Token

```bash
# Replace with your values
curl --request POST \
  --url https://YOUR_DOMAIN.auth0.com/oauth/token \
  --header 'content-type: application/json' \
  --data '{
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "audience": "https://mcp.yourapp.com",
    "grant_type": "client_credentials"
  }'
```

### 4. Environment Variables

```env
# OIDC Configuration (works with Auth0)
OIDC_ISSUER=https://your-tenant.auth0.com
OIDC_AUDIENCE=https://mcp.yourapp.com
PORT=3001
```

## Keycloak Setup

### 1. Install Keycloak

```bash
# Using Docker
docker run -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest start-dev
```

### 2. Create Realm

1. Open http://localhost:8080
2. Login with admin/admin
3. Create new realm (e.g., "mcp")

### 3. Create Client

1. Go to Clients → Create Client
   - **Client ID**: `mcp-server`
   - **Client Protocol**: openid-connect
2. Settings:
   - **Access Type**: confidential
   - **Standard Flow**: Enabled
   - **Direct Access Grants**: Enabled
   - **Service Accounts**: Enabled
3. Save and note **Client Secret**

### 4. Create User

1. Go to Users → Add User
2. Set username, email
3. Go to Credentials → Set password

### 5. Get Test Token

```bash
curl -X POST http://localhost:8080/realms/mcp/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=mcp-server" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "username=YOUR_USERNAME" \
  -d "password=YOUR_PASSWORD"
```

### 6. Environment Variables

```env
# OIDC Configuration (works with Keycloak)
OIDC_ISSUER=http://localhost:8080/realms/mcp
OIDC_AUDIENCE=mcp-server
PORT=3001
```

## Running

1. Install dependencies:
```bash
pnpm install
```

2. Configure environment variables (create `.env`):
```bash
# OIDC Configuration (works with any OIDC provider)
OIDC_ISSUER=https://your-oidc-provider.com
OIDC_AUDIENCE=your-api-identifier

# Examples:
# Auth0: OIDC_ISSUER=https://your-tenant.auth0.com
# Keycloak: OIDC_ISSUER=https://keycloak.example.com/realms/myrealm
# Okta: OIDC_ISSUER=https://your-domain.okta.com/oauth2/default
# Azure AD: OIDC_ISSUER=https://login.microsoftonline.com/{tenant-id}/v2.0
# Google: OIDC_ISSUER=https://accounts.google.com

# Server port
PORT=3001
```

3. Run:
```bash
pnpm dev
```

## Testing

### Get a JWT Token

**Auth0:**
```bash
TOKEN=$(curl -s --request POST \
  --url https://YOUR_DOMAIN.auth0.com/oauth/token \
  --header 'content-type: application/json' \
  --data '{
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "audience": "YOUR_AUDIENCE",
    "grant_type": "client_credentials"
  }' | jq -r '.access_token')
```

**Keycloak:**
```bash
TOKEN=$(curl -s -X POST \
  http://localhost:8080/realms/mcp/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=mcp-server" \
  -d "client_secret=YOUR_SECRET" \
  -d "username=YOUR_USER" \
  -d "password=YOUR_PASS" | jq -r '.access_token')
```

### Test MCP Endpoint

```bash
# List tools
curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  http://localhost:3001/mcp

# Call whoami tool
curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{"name":"whoami","arguments":{}},
    "id":1
  }' \
  http://localhost:3001/mcp
```

## Integration with MCP Client

```typescript
import { BrowserMCPClient } from 'mcp-use';

// Get JWT token from your auth provider
const token = await getJWTToken(); // Your auth logic

const client = new BrowserMCPClient({
  'my-server': {
    url: 'http://localhost:3001/mcp',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
});

await client.connect('my-server');
const result = await client.callTool('my-server', 'whoami', {});
```

## JWT Claims Used

The middleware extracts these claims from the JWT:

**Standard claims:**
- `sub` - User ID
- `email` - User email
- `name` - User name
- `iss` - Token issuer (identifies provider)
- `aud` - Audience
- `exp` - Expiration time

**Auth0 specific:**
- `permissions` - Array of permissions
- `org_id` - Organization ID (for multi-tenant)

**Keycloak specific:**
- `realm_access.roles` - Array of realm roles
- `resource_access.<client>.roles` - Client-specific roles
- `preferred_username` - Username

## Role-Based Authorization

Add roles to JWT and check in tools:

```typescript
server.tool({
  name: 'admin-action',
  cb: async (params, context) => {
    const user = context?.req?.user;
    
    // Auth0
    if (!user?.permissions?.includes('admin:write')) {
      throw new Error('Missing permission: admin:write');
    }
    
    // Keycloak
    if (!user?.realm_access?.roles?.includes('admin')) {
      throw new Error('Missing role: admin');
    }
    
    // Your logic here
  }
});
```

## Multi-Tenant Support

Extract tenant/organization from JWT:

```typescript
server.tool({
  name: 'get-data',
  cb: async (params, context) => {
    const user = context?.req?.user;
    
    // Auth0
    const orgId = user?.org_id;
    
    // Keycloak (custom claim)
    const tenantId = user?.tenant_id;
    
    // Query data for specific tenant
    const data = await db.getData({ tenantId });
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  }
});
```

## Token Refresh

JWT tokens expire. Handle refresh on the client side:

```typescript
class AuthManager {
  private token: string;
  private refreshToken: string;
  
  async getValidToken(): Promise<string> {
    if (this.isTokenExpired(this.token)) {
      this.token = await this.refreshAccessToken();
    }
    return this.token;
  }
  
  async refreshAccessToken(): Promise<string> {
    // Call your auth provider's refresh endpoint
    const response = await fetch('https://your-domain.auth0.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: 'YOUR_CLIENT_ID',
        refresh_token: this.refreshToken
      })
    });
    const { access_token } = await response.json();
    return access_token;
  }
}
```

## Security Best Practices

1. **HTTPS in Production**: Always use HTTPS to protect tokens
2. **Token Expiration**: Set reasonable expiration times (15-60 minutes)
3. **Validate Audience**: Always verify the `aud` claim
4. **Validate Issuer**: Always verify the `iss` claim
5. **JWKS Caching**: Keys are cached automatically by `jwks-rsa`
6. **Rate Limiting**: Prevent token brute force attacks
7. **Logging**: Log authentication events for security auditing

## Troubleshooting

### "Invalid issuer" error

Make sure your `AUTH0_DOMAIN` or `KEYCLOAK_SERVER_URL` exactly matches the `iss` claim in the JWT.

Decode your JWT at [jwt.io](https://jwt.io) to check the `iss` value.

### "Unable to find a signing key" error

The JWKS endpoint might be unreachable or the `kid` in the JWT header doesn't match any keys.

Check the JWKS endpoint manually:
- Auth0: `https://YOUR_DOMAIN.auth0.com/.well-known/jwks.json`
- Keycloak: `http://YOUR_SERVER/realms/YOUR_REALM/protocol/openid-connect/certs`

### "Invalid audience" error

The `aud` claim in the JWT doesn't match your configured audience. Make sure:
- Auth0: `AUTH0_AUDIENCE` matches the API identifier
- Keycloak: `KEYCLOAK_CLIENT_ID` matches the client ID

## Next Steps

- See `auth-oauth` example for full OAuth 2.0 flow
- Read [MCP Protocol Draft Spec](https://modelcontextprotocol.io/specification/draft/changelog)
- Configure roles and permissions in Auth0/Keycloak
- Implement token refresh logic in your clients

